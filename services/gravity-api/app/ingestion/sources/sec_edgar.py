"""
Gravity Search — SEC EDGAR Filing Source
Polls EDGAR for new 10-K, 10-Q, 8-K filings every 60 seconds.
Uses the `edgartools` library (pip install edgartools) for parsing,
as specified in the build guide Section 3.2 Stage 1.

edgartools docs: https://github.com/dgunning/edgartools
  edgar.set_identity(name_email)  — required before any API call
  edgar.Company(ticker)           — get company by ticker
  company.get_filings(form=...)   — list filings
  filing.document                 — get primary document HTML
  filing.attachments              — all filing attachments

Rate limit: max 10 req/s (EDGAR TOS).
User-Agent: required by EDGAR — must identify application + contact email.
"""

import asyncio
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx
import structlog

logger = structlog.get_logger()

EDGAR_RSS_URL = "https://www.sec.gov/cgi-bin/browse-edgar"
EDGAR_SUBMISSIONS_URL = "https://data.sec.gov/submissions"
EDGAR_FULL_INDEX = "https://www.sec.gov/Archives/edgar/full-index"

# Required by EDGAR — change to your real contact info
USER_AGENT = "GravitySearch/1.0 (gravity@antigravity.ai)"

# Filing types to monitor
WATCHED_FILING_TYPES = ["10-K", "10-Q", "8-K"]

# Rate limiting: 10 req/s max
_REQUEST_SEMAPHORE = asyncio.Semaphore(10)
_POLL_INTERVAL_SECONDS = 60


class SECEdgarSource:
    """
    Monitors SEC EDGAR for new filings and publishes them to the ingestion pipeline.

    Publishing path (preferred when Kafka is running):
        EDGAR RSS → download bytes → DocumentProducer.publish_bytes()
                                   → gravity.raw-documents (Kafka topic)
                                   → ProcessingWorker → IndexingWorker

    Fallback path (no Kafka / dev):
        EDGAR RSS → download bytes → IngestionPipeline.ingest_bytes() (synchronous)

    Usage:
        edgar = SECEdgarSource(producer=DocumentProducer(), redis_client=redis)
        await edgar.start_background_polling()
        await edgar.stop()
    """

    def __init__(self, ingestion_pipeline=None, redis_client=None, producer=None):
        # Support both old (pipeline) and new (producer) calling conventions
        self.pipeline = ingestion_pipeline
        self.redis = redis_client
        self._producer = producer
        self._running = False
        self._task: asyncio.Task | None = None

    def _get_producer(self):
        """Return producer, constructing one with fallback pipeline if needed."""
        if self._producer is not None:
            return self._producer
        from app.ingestion.producer import DocumentProducer
        return DocumentProducer(fallback_pipeline=self.pipeline)

    async def start_background_polling(self):
        """Start the background polling task."""
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("edgar_polling_started", interval=_POLL_INTERVAL_SECONDS)

    async def stop(self):
        """Stop the background polling task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("edgar_polling_stopped")

    async def _poll_loop(self):
        """Main polling loop — runs forever until stopped."""
        while self._running:
            try:
                await self._poll_all_filing_types()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("edgar_poll_error", error=str(e))
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

    async def _poll_all_filing_types(self):
        """Poll EDGAR RSS feeds for all watched filing types."""
        tasks = [
            self._poll_filing_type(filing_type)
            for filing_type in WATCHED_FILING_TYPES
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _poll_filing_type(self, filing_type: str):
        """Poll EDGAR RSS feed for a specific filing type."""
        filings = await self._fetch_rss_feed(filing_type)
        new_count = 0
        for filing in filings:
            accession = filing.get("accession_number", "")
            if not accession:
                continue

            # Redis dedup: skip already-seen filings
            if await self._is_seen(accession):
                continue

            # Ingest the filing
            try:
                await self._ingest_filing(filing)
                await self._mark_seen(accession)
                new_count += 1
            except Exception as e:
                logger.warning(
                    "edgar_ingest_failed",
                    accession=accession,
                    error=str(e),
                )

        if new_count:
            logger.info("edgar_new_filings", filing_type=filing_type, count=new_count)

    async def _fetch_rss_feed(self, filing_type: str) -> list[dict]:
        """Fetch EDGAR RSS feed for a filing type."""
        async with _REQUEST_SEMAPHORE:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    EDGAR_RSS_URL,
                    params={
                        "action": "getcurrent",
                        "type": filing_type,
                        "dateb": "",
                        "owner": "include",
                        "count": "40",
                        "search_text": "",
                        "output": "atom",
                    },
                    headers={"User-Agent": USER_AGENT},
                )
                response.raise_for_status()

        return self._parse_atom_feed(response.text, filing_type)

    def _parse_atom_feed(self, xml_text: str, filing_type: str) -> list[dict]:
        """Parse EDGAR Atom feed XML into filing dicts."""
        filings = []
        try:
            root = ET.fromstring(xml_text)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entries = root.findall("atom:entry", ns)

            for entry in entries:
                title_el = entry.find("atom:title", ns)
                link_el = entry.find("atom:link", ns)
                updated_el = entry.find("atom:updated", ns)
                summary_el = entry.find("atom:summary", ns)

                title = title_el.text if title_el is not None else ""
                url = link_el.get("href", "") if link_el is not None else ""
                updated = updated_el.text if updated_el is not None else ""
                summary = summary_el.text if summary_el is not None else ""

                # Extract ticker and company name from title
                # Format: "10-K - APPLE INC (AAPL) - 2024-10-31"
                ticker = ""
                company_name = ""
                ticker_match = __import__("re").search(r"\(([A-Z]{1,5})\)", title)
                if ticker_match:
                    ticker = ticker_match.group(1)

                # Extract accession number from URL
                accession = self._extract_accession(url)

                # Extract company name (between filing type and ticker)
                name_match = __import__("re").search(
                    r"(?:\d+-\w+)\s*-\s*(.+?)\s*\([A-Z]+\)", title
                )
                if name_match:
                    company_name = name_match.group(1).strip()

                filings.append({
                    "filing_type": filing_type,
                    "ticker": ticker,
                    "company_name": company_name,
                    "url": url,
                    "accession_number": accession,
                    "filing_date": updated[:10] if updated else "",
                    "title": title,
                    "summary": summary,
                })

        except ET.ParseError as e:
            logger.warning("edgar_parse_error", error=str(e))

        return filings

    def _extract_accession(self, url: str) -> str:
        """Extract accession number from EDGAR URL."""
        import re
        match = re.search(r"(\d{10}-\d{2}-\d{6})", url)
        if match:
            return match.group(1)
        # Hash the URL as fallback dedup key
        return hashlib.md5(url.encode()).hexdigest()

    async def _is_seen(self, accession_number: str) -> bool:
        """Check if this filing was already processed (Redis dedup)."""
        if not self.redis:
            return False
        try:
            key = f"edgar:seen:{accession_number}"
            return bool(await self.redis.exists(key))
        except Exception:
            return False

    async def _mark_seen(self, accession_number: str):
        """Mark filing as processed in Redis with 30-day TTL."""
        if not self.redis:
            return
        try:
            key = f"edgar:seen:{accession_number}"
            await self.redis.setex(key, 30 * 24 * 3600, "1")
        except Exception as e:
            logger.warning("edgar_redis_mark_failed", error=str(e))

    async def _ingest_filing(self, filing: dict):
        """Download a filing and publish it to the ingestion pipeline (Kafka or direct)."""
        filing_url = filing.get("url", "")
        if not filing_url:
            return

        # Download the filing document
        content = await self._download_filing(filing_url)
        if not content:
            return

        # Determine content type (EDGAR files are mostly HTML or text)
        content_type = "text/html"
        if filing_url.endswith(".txt"):
            content_type = "text/plain"

        producer = self._get_producer()
        await producer.publish_bytes(
            content=content,
            content_type=content_type,
            filename=f"{filing['ticker']}_{filing['filing_type']}_{filing['filing_date']}.html",
            source="sec_edgar",
            ticker=filing.get("ticker", ""),
            company_name=filing.get("company_name", ""),
            filing_type=filing.get("filing_type", ""),
            filing_date=filing.get("filing_date", ""),
            source_url=filing_url,
        )

    async def _download_filing(self, url: str) -> bytes | None:
        """Download filing content from EDGAR."""
        async with _REQUEST_SEMAPHORE:
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    response = await client.get(
                        url,
                        headers={"User-Agent": USER_AGENT},
                        follow_redirects=True,
                    )
                    response.raise_for_status()
                    return response.content
            except Exception as e:
                logger.warning("edgar_download_failed", url=url, error=str(e))
                return None

    async def fetch_company_filings(
        self,
        ticker: str,
        filing_types: list[str] | None = None,
        max_filings: int = 5,
    ) -> list[dict]:
        """
        Fetch recent filings for a specific company using the edgartools library.
        edgartools provides structured access to EDGAR without manual HTTP/XML parsing.

        Requires: pip install edgartools
        """
        filing_types = filing_types or ["10-K", "10-Q"]

        return await asyncio.get_event_loop().run_in_executor(
            None,
            self._fetch_company_filings_sync,
            ticker,
            filing_types,
            max_filings,
        )

    def _fetch_company_filings_sync(
        self,
        ticker: str,
        filing_types: list[str],
        max_filings: int,
    ) -> list[dict]:
        """
        Synchronous implementation using edgartools.
        Runs in executor to avoid blocking the event loop.
        """
        try:
            import edgar
            edgar.set_identity(USER_AGENT)

            company = edgar.Company(ticker)
            if company is None:
                logger.warning("edgartools_company_not_found", ticker=ticker)
                return []

            filings = []
            for filing_type in filing_types:
                try:
                    company_filings = company.get_filings(form=filing_type)
                    for filing in company_filings[:max_filings]:
                        # edgartools Filing object attributes
                        accession = getattr(filing, "accession_number", "") or ""
                        filing_date = getattr(filing, "filing_date", "") or ""
                        if hasattr(filing_date, "isoformat"):
                            filing_date = filing_date.isoformat()
                        else:
                            filing_date = str(filing_date)

                        # Get primary document URL
                        doc_url = ""
                        try:
                            doc = filing.document
                            if doc and hasattr(doc, "url"):
                                doc_url = doc.url or ""
                        except Exception:
                            doc_url = getattr(filing, "filing_index_url", "") or ""

                        filings.append({
                            "ticker": ticker,
                            "company_name": getattr(company, "name", ticker),
                            "filing_type": filing_type,
                            "filing_date": filing_date[:10] if filing_date else "",
                            "accession_number": str(accession),
                            "url": doc_url,
                        })
                        if len(filings) >= max_filings:
                            break
                except Exception as e:
                    logger.warning("edgartools_filings_error",
                                   ticker=ticker, form=filing_type, error=str(e))

            logger.info("edgar_company_filings", ticker=ticker, count=len(filings))
            return filings

        except ImportError:
            logger.warning("edgartools_not_installed",
                           hint="pip install edgartools",
                           fallback="using raw EDGAR API")
            return self._fetch_company_filings_raw(ticker, filing_types, max_filings)
        except Exception as e:
            logger.warning("edgartools_failed", ticker=ticker, error=str(e))
            return []

    def _fetch_company_filings_raw(
        self,
        ticker: str,
        filing_types: list[str],
        max_filings: int,
    ) -> list[dict]:
        """
        Raw HTTP fallback when edgartools is not installed.
        Uses the EDGAR submissions JSON API directly.
        """
        import requests

        # Look up CIK from company tickers map
        cik = None
        try:
            r = requests.get(
                "https://www.sec.gov/files/company_tickers.json",
                headers={"User-Agent": USER_AGENT},
                timeout=15,
            )
            if r.status_code == 200:
                for entry in r.json().values():
                    if entry.get("ticker", "").upper() == ticker.upper():
                        cik = entry.get("cik_str")
                        break
        except Exception as e:
            logger.warning("cik_lookup_failed", ticker=ticker, error=str(e))
            return []

        if not cik:
            return []

        filings = []
        try:
            padded_cik = str(int(cik)).zfill(10)
            r = requests.get(
                f"{EDGAR_SUBMISSIONS_URL}/CIK{padded_cik}.json",
                headers={"User-Agent": USER_AGENT},
                timeout=30,
            )
            if r.status_code != 200:
                return []
            data = r.json()
            recent = data.get("filings", {}).get("recent", {})
            forms = recent.get("form", [])
            accessions = recent.get("accessionNumber", [])
            dates = recent.get("filingDate", [])
            primary_docs = recent.get("primaryDocument", [])

            for i, form in enumerate(forms):
                if form in filing_types and len(filings) < max_filings:
                    acc = accessions[i] if i < len(accessions) else ""
                    acc_path = acc.replace("-", "")
                    doc = primary_docs[i] if i < len(primary_docs) else ""
                    url = (
                        f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_path}/{doc}"
                        if acc and doc else ""
                    )
                    filings.append({
                        "ticker": ticker,
                        "company_name": data.get("name", ticker),
                        "filing_type": form,
                        "filing_date": dates[i][:10] if i < len(dates) else "",
                        "accession_number": acc,
                        "url": url,
                    })
        except Exception as e:
            logger.warning("raw_edgar_failed", ticker=ticker, error=str(e))

        return filings
