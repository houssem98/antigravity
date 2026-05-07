"""
Gravity Search — Earnings Call Transcript Source

Source priority:
  1. EDGAR 8-K exhibits — earnings press releases (free, no auth, ~100% coverage for US)
  2. Quartr API — live call transcripts (paid; QUARTR_API_KEY required)
  3. Alpha Vantage fallback (key required, limited history)
  4. Motley Fool public transcripts (rate-limited scrape)

EDGAR 8-K path:
  - Fetches CIK from SEC company_tickers.json for the given ticker
  - Lists 8-K filings via EDGAR full-text search
  - Filters exhibits with description matching "earnings" / "press release"
  - Returns plain text (no HTML parsing needed for .htm exhibits)

Quartr path (when QUARTR_API_KEY set):
  - REST v1 API: GET /events?ticker=AAPL&limit=10
  - Returns transcript segments with speaker diarisation
"""

from __future__ import annotations

import re
import asyncio
import structlog
from datetime import datetime, timezone
from typing import Optional

logger = structlog.get_logger()

ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
_SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_EDGAR_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik}.json"
_EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{filename}"
_EDGAR_HEADERS = {"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"}

# Module-level CIK cache (ticker → 10-digit CIK string)
_cik_cache: dict[str, str] = {}


async def _resolve_cik(ticker: str) -> Optional[str]:
    """Resolve ticker → CIK using SEC company_tickers.json (cached in memory)."""
    global _cik_cache
    t = ticker.upper()
    if t in _cik_cache:
        return _cik_cache[t]

    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_SEC_TICKERS_URL, headers=_EDGAR_HEADERS)
            resp.raise_for_status()
            data = resp.json()
        for _, entry in data.items():
            _cik_cache[str(entry.get("ticker", "")).upper()] = str(entry.get("cik_str", "")).zfill(10)
        return _cik_cache.get(t)
    except Exception as e:
        logger.warning("cik_resolve_failed", ticker=ticker, error=str(e))
        return None


async def _fetch_edgar_8k_transcript(
    ticker: str,
    quarter: str = "",
    max_filings: int = 5,
) -> Optional[dict]:
    """
    Fetch earnings transcript/press release from EDGAR 8-K exhibits.

    Looks for the most recent 8-K with form items 2.02 (Results of Operations)
    and an exhibit 99.x with description matching 'earnings' / 'press release'.
    Returns the plain text of the first matching exhibit.
    """
    import httpx

    cik = await _resolve_cik(ticker)
    if not cik:
        logger.warning("edgar_8k_no_cik", ticker=ticker)
        return None

    submissions_url = _EDGAR_SUBMISSIONS.format(cik=cik)
    try:
        async with httpx.AsyncClient(timeout=15, headers=_EDGAR_HEADERS) as client:
            resp = await client.get(submissions_url)
            resp.raise_for_status()
            subs = resp.json()
    except Exception as e:
        logger.warning("edgar_submissions_failed", ticker=ticker, cik=cik, error=str(e))
        return None

    filings = subs.get("filings", {}).get("recent", {})
    forms = filings.get("form", [])
    accessions = filings.get("accessionNumber", [])
    dates = filings.get("filingDate", [])
    primary_docs = filings.get("primaryDocument", [])

    # Find most recent 8-K filings (up to max_filings)
    candidates = [
        (acc, date, doc)
        for form, acc, date, doc in zip(forms, accessions, dates, primary_docs)
        if form == "8-K"
    ][:max_filings]

    if not candidates:
        logger.debug("edgar_no_8k", ticker=ticker)
        return None

    # Apply quarter filter if provided (e.g. "Q3 2024" → look for filings in Oct-Nov 2024)
    if quarter:
        q_match = re.match(r"Q(\d)\s+(\d{4})", quarter.strip())
        if q_match:
            q_num = int(q_match.group(1))
            q_year = int(q_match.group(2))
            # Earnings typically filed 2-6 weeks after quarter end
            # Q1 ends Mar → filed Apr-May; Q2 ends Jun → filed Jul-Aug; etc.
            month_map = {1: (4, 5), 2: (7, 8), 3: (10, 11), 4: (1, 2)}
            months, _ = month_map.get(q_num, (1, 12))
            year = q_year if q_num < 4 else q_year + 1
            candidates = [
                (acc, date, doc) for acc, date, doc in candidates
                if date[:4] == str(year) and int(date[5:7]) in range(months, months + 3)
            ] or candidates  # fall back to all if filter leaves nothing

    async with httpx.AsyncClient(timeout=20, headers=_EDGAR_HEADERS) as client:
        for accession, date, _primary_doc in candidates:
            acc_clean = accession.replace("-", "")
            index_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/{accession}-index.htm"

            try:
                idx_resp = await client.get(index_url)
                if idx_resp.status_code != 200:
                    continue

                # Find exhibit 99.x with earnings-related description
                ex_pattern = re.compile(
                    r'<tr[^>]*>.*?<td[^>]*>(ex-?99[^<]*|EX-?99[^<]*)</td>'
                    r'.*?<td[^>]*>([^<]*(?:earn|press\s+rel|result|financial)[^<]*)</td>'
                    r'.*?href="([^"]+\.(htm|txt|pdf))"',
                    re.IGNORECASE | re.DOTALL,
                )
                # Also try simple pattern: any ex-99 exhibit file
                fallback_pattern = re.compile(
                    r'href="(/Archives/edgar/data/[^"]+/[^"]*(?:ex-?99[^"]*|press[^"]*|earn[^"]*)\.(htm|txt))"',
                    re.IGNORECASE,
                )

                exhibit_url = None
                for m in ex_pattern.finditer(idx_resp.text):
                    path = m.group(3)
                    if not path.startswith("http"):
                        path = f"https://www.sec.gov{path}" if path.startswith("/") else \
                               f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/{path}"
                    exhibit_url = path
                    break

                if not exhibit_url:
                    for m in fallback_pattern.finditer(idx_resp.text):
                        exhibit_url = f"https://www.sec.gov{m.group(1)}"
                        break

                if not exhibit_url:
                    continue

                # Fetch the exhibit
                ex_resp = await client.get(exhibit_url)
                if ex_resp.status_code != 200:
                    continue

                # Strip HTML if needed
                text = ex_resp.text
                if "<html" in text.lower() or "<body" in text.lower():
                    try:
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(text, "html.parser")
                        for tag in soup(["script", "style"]):
                            tag.decompose()
                        text = soup.get_text(separator="\n", strip=True)
                    except ImportError:
                        text = re.sub(r"<[^>]+>", " ", text)
                        text = re.sub(r"\s+", " ", text).strip()

                if len(text) < 200:
                    continue

                # Detect quarter from text if not provided
                detected_quarter = quarter
                if not detected_quarter:
                    q_match_text = re.search(
                        r"(first|second|third|fourth|Q[1-4])\s+(quarter|fiscal)\s+(quarter\s+)?(?:of\s+)?(\d{4})",
                        text, re.IGNORECASE,
                    )
                    if q_match_text:
                        qword = q_match_text.group(1).upper()
                        qmap = {"FIRST": "Q1", "SECOND": "Q2", "THIRD": "Q3", "FOURTH": "Q4"}
                        detected_quarter = f"{qmap.get(qword, qword)} {q_match_text.group(4)}"

                # Build speaker turns from press release (flat — no diarisation in 8-K)
                sections = _split_press_release_sections(text)
                speakers = [{"speaker": ticker, "role": "Company", "text": text, "turn_index": 0}]

                logger.info("edgar_8k_fetched", ticker=ticker, accession=accession, chars=len(text))
                return {
                    "ticker": ticker,
                    "company_name": subs.get("name", ticker),
                    "quarter": detected_quarter or "",
                    "date": date,
                    "speakers": speakers,
                    "full_text": text,
                    "sections": sections,
                    "source": "edgar_8k",
                    "source_url": exhibit_url,
                    "accession": accession,
                }
            except Exception as e:
                logger.debug("edgar_8k_exhibit_failed", accession=accession, error=str(e))
                continue

    return None


async def _fetch_quartr(
    ticker: str,
    quarter: str = "",
    api_key: str = "",
) -> Optional[dict]:
    """
    Fetch transcript from Quartr API (paid; QUARTR_API_KEY required).
    Docs: https://docs.quartr.com/api/v1
    """
    if not api_key:
        return None

    import httpx

    params: dict = {"ticker": ticker, "limit": 5, "type": "earnings"}
    if quarter:
        q_m = re.match(r"Q(\d)\s+(\d{4})", quarter.strip())
        if q_m:
            params["year"] = q_m.group(2)
            params["quarter"] = q_m.group(1)

    try:
        async with httpx.AsyncClient(
            timeout=20,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        ) as client:
            resp = await client.get("https://api.quartr.com/public/v1/events", params=params)
            resp.raise_for_status()
            data = resp.json()

        events = data.get("data", [])
        if not events:
            return None

        event = events[0]
        transcript_url = event.get("transcriptUrl") or event.get("transcript_url")
        if not transcript_url:
            # Try to get transcript segments from event id
            event_id = event.get("id")
            if not event_id:
                return None
            async with httpx.AsyncClient(
                timeout=20,
                headers={"Authorization": f"Bearer {api_key}"},
            ) as client:
                tr_resp = await client.get(f"https://api.quartr.com/public/v1/events/{event_id}/transcript")
                tr_resp.raise_for_status()
                tr_data = tr_resp.json()
            segments = tr_data.get("data", {}).get("segments", [])
        else:
            async with httpx.AsyncClient(timeout=20) as client:
                tr_resp = await client.get(transcript_url)
                tr_resp.raise_for_status()
            segments = tr_resp.json().get("segments", [])

        if not segments:
            return None

        speakers = []
        for i, seg in enumerate(segments):
            speakers.append({
                "speaker": seg.get("speaker", {}).get("name", "Unknown"),
                "role": seg.get("speaker", {}).get("title", ""),
                "text": seg.get("text", ""),
                "turn_index": i,
            })

        full_text = _build_full_text(speakers)
        sections = _split_sections(full_text)
        quarter_str = f"Q{event.get('quarter', '')} {event.get('year', '')}" if event.get("quarter") else quarter

        logger.info("quartr_fetched", ticker=ticker, turns=len(speakers))
        return {
            "ticker": ticker,
            "company_name": event.get("company", {}).get("name", ticker),
            "quarter": quarter_str,
            "date": event.get("date", "")[:10],
            "speakers": speakers,
            "full_text": full_text,
            "sections": sections,
            "source": "quartr",
        }
    except Exception as e:
        logger.warning("quartr_failed", ticker=ticker, error=str(e))
        return None


def _split_press_release_sections(text: str) -> dict:
    """Split press release into financial highlights, narrative, and tables."""
    highlights_pattern = re.compile(
        r"(?i)(financial\s+highlights?|key\s+highlights?|selected\s+financial)",
    )
    split_pos = len(text)
    m = highlights_pattern.search(text)
    if m:
        split_pos = m.start()

    return {
        "prepared_remarks": text[:split_pos].strip(),
        "qa_session": "",
        "financial_highlights": text[split_pos:].strip(),
    }


def _build_full_text(speakers: list[dict]) -> str:
    parts = []
    for turn in speakers:
        speaker_line = turn["speaker"]
        if turn.get("role"):
            speaker_line += f" ({turn['role']})"
        parts.append(f"{speaker_line}:\n{turn['text']}")
    return "\n\n".join(parts)


def _split_sections(full_text: str) -> dict:
    qa_patterns = [
        r"(?i)question[\s-]+and[\s-]+answer",
        r"(?i)q\s*&\s*a\s+session",
        r"(?i)questions\s+and\s+answers",
        r"(?i)operator.*please\s+go\s+ahead",
        r"(?i)we\s+will\s+now\s+(begin|open|take)\s+(the\s+)?q",
    ]
    split_pos = len(full_text)
    for pattern in qa_patterns:
        match = re.search(pattern, full_text)
        if match:
            split_pos = min(split_pos, match.start())
    return {
        "prepared_remarks": full_text[:split_pos].strip(),
        "qa_session": full_text[split_pos:].strip(),
    }


class EarningsTranscriptSource:
    """
    Fetches earnings call transcripts / press releases.

    Source priority:
      1. EDGAR 8-K (free, reliable for US companies)
      2. Quartr API (paid; best transcript quality)
      3. Alpha Vantage (paid key required)
      4. Motley Fool (rate-limited scrape, fallback)
    """

    def __init__(
        self,
        alpha_vantage_key: str = "",
        quartr_api_key: str = "",
    ):
        self.alpha_vantage_key = alpha_vantage_key
        self.quartr_api_key = quartr_api_key

    async def fetch_transcript(
        self,
        ticker: str,
        company_name: str,
        quarter: str = "",
    ) -> dict:
        """
        Fetch the most recent earnings transcript for a company.

        Returns:
            {
                "ticker": str,
                "company_name": str,
                "quarter": str,
                "date": str,
                "speakers": list[dict],
                "full_text": str,
                "sections": {"prepared_remarks": str, "qa_session": str},
                "source": str,  # "edgar_8k" | "quartr" | "alpha_vantage" | "motley_fool"
            }
        """
        # 1. EDGAR 8-K (always try first — free and authoritative)
        result = await _fetch_edgar_8k_transcript(ticker, quarter)
        if result:
            return result

        # 2. Quartr API (paid; best quality)
        if self.quartr_api_key:
            result = await _fetch_quartr(ticker, quarter, self.quartr_api_key)
            if result:
                return result

        # 3. Alpha Vantage
        if self.alpha_vantage_key:
            try:
                result = await self._fetch_alpha_vantage(ticker, quarter)
                if result:
                    return result
            except Exception as e:
                logger.warning("alpha_vantage_failed", ticker=ticker, error=str(e))

        # 4. Motley Fool (scrape fallback)
        try:
            result = await self._fetch_motley_fool(ticker, company_name, quarter)
            if result:
                return result
        except Exception as e:
            logger.warning("motley_fool_failed", ticker=ticker, error=str(e))

        logger.warning("earnings_all_sources_failed", ticker=ticker)
        return {
            "ticker": ticker,
            "company_name": company_name,
            "quarter": quarter,
            "date": "",
            "speakers": [],
            "full_text": "",
            "sections": {"prepared_remarks": "", "qa_session": ""},
            "source": "none",
        }

    async def fetch_transcripts_bulk(
        self,
        tickers: list[str],
        quarter: str = "",
        concurrency: int = 5,
    ) -> list[dict]:
        """Fetch transcripts for multiple tickers with bounded concurrency."""
        sem = asyncio.Semaphore(concurrency)

        async def _fetch_one(ticker: str) -> dict:
            async with sem:
                return await self.fetch_transcript(ticker, ticker, quarter)

        return await asyncio.gather(*[_fetch_one(t) for t in tickers])

    async def _fetch_alpha_vantage(self, ticker: str, quarter: str) -> Optional[dict]:
        import httpx
        params = {
            "function": "EARNINGS_CALL_TRANSCRIPT",
            "symbol": ticker,
            "apikey": self.alpha_vantage_key,
        }
        if quarter:
            match = re.match(r"Q(\d)\s+(\d{4})", quarter)
            if match:
                params["quarter"] = match.group(1)
                params["year"] = match.group(2)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(ALPHA_VANTAGE_URL, params=params)
            response.raise_for_status()
            data = response.json()

        if "transcript" not in data:
            return None

        speakers = []
        for i, entry in enumerate(data["transcript"]):
            speakers.append({
                "speaker": entry.get("speaker", "Unknown"),
                "role": entry.get("title", ""),
                "text": entry.get("content", ""),
                "turn_index": i,
            })

        full_text = _build_full_text(speakers)
        sections = _split_sections(full_text)
        logger.info("alpha_vantage_fetched", ticker=ticker, turns=len(speakers))
        return {
            "ticker": ticker,
            "company_name": data.get("symbol", ticker),
            "quarter": data.get("quarter", quarter),
            "date": data.get("date", ""),
            "speakers": speakers,
            "full_text": full_text,
            "sections": sections,
            "source": "alpha_vantage",
        }

    async def _fetch_motley_fool(
        self, ticker: str, company_name: str, quarter: str
    ) -> Optional[dict]:
        import httpx
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": "GravitySearch/1.0 (financial research tool)",
            "Accept": "text/html,application/xhtml+xml",
        }
        year = quarter.split()[-1] if quarter else datetime.now(timezone.utc).strftime("%Y")
        q_num = quarter.split()[0].lower() if quarter else "q4"

        base = "https://www.fool.com/earnings/call-transcripts/"
        direct_url = f"{base}{ticker.lower()}-{q_num}-{year}-earnings-call-transcript"
        search_url = f"https://www.fool.com/search/solr.aspx?q={ticker}+earnings+call+transcript&site=fool"

        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for url in [direct_url, search_url]:
                try:
                    resp = await client.get(url, headers=headers)
                    if resp.status_code != 200:
                        continue
                    if "search" in url:
                        soup = BeautifulSoup(resp.text, "html.parser")
                        links = soup.find_all("a", href=re.compile(r"earnings-call-transcript"))
                        if not links:
                            continue
                        transcript_url = "https://www.fool.com" + links[0]["href"]
                        resp = await client.get(transcript_url, headers=headers)
                        if resp.status_code != 200:
                            continue
                    result = _parse_motley_fool_html(resp.text, ticker, company_name, quarter)
                    if result:
                        return result
                except Exception:
                    continue
        return None


def _parse_motley_fool_html(html: str, ticker: str, company_name: str, quarter: str) -> Optional[dict]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    article = soup.find("article") or soup.find("div", class_="article-body")
    if not article:
        return None

    date_tag = soup.find("time")
    date_str = date_tag.get("datetime", "") if date_tag else ""

    title_tag = soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else ""
    if not quarter and title:
        q_m = re.search(r"(Q[1-4]\s+\d{4})", title)
        if q_m:
            quarter = q_m.group(1)

    speakers = []
    turn_index = 0
    current_speaker = ""
    current_role = ""
    current_text_parts: list[str] = []

    for p in article.find_all("p"):
        bold = p.find("strong") or p.find("b")
        if bold:
            if current_speaker and current_text_parts:
                speakers.append({
                    "speaker": current_speaker,
                    "role": current_role,
                    "text": " ".join(current_text_parts).strip(),
                    "turn_index": turn_index,
                })
                turn_index += 1
                current_text_parts = []
            speaker_text = bold.get_text(strip=True)
            if " -- " in speaker_text:
                parts = speaker_text.split(" -- ", 1)
                current_speaker = parts[0].strip()
                current_role = parts[1].strip()
            else:
                current_speaker = speaker_text
                current_role = ""
            bold.decompose()
            remaining = p.get_text(strip=True)
            if remaining:
                current_text_parts.append(remaining)
        else:
            text = p.get_text(strip=True)
            if text and current_speaker:
                current_text_parts.append(text)

    if current_speaker and current_text_parts:
        speakers.append({
            "speaker": current_speaker,
            "role": current_role,
            "text": " ".join(current_text_parts).strip(),
            "turn_index": turn_index,
        })

    if not speakers:
        return None

    full_text = _build_full_text(speakers)
    sections = _split_sections(full_text)
    logger.info("motley_fool_parsed", ticker=ticker, turns=len(speakers))
    return {
        "ticker": ticker,
        "company_name": company_name,
        "quarter": quarter,
        "date": date_str,
        "speakers": speakers,
        "full_text": full_text,
        "sections": sections,
        "source": "motley_fool",
    }
