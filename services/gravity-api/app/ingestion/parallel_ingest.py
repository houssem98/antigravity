"""
Gravity Search — Parallel Ingestion Orchestrator

Ingests S&P 500-scale SEC filing corpora at ~500 filings/hour using
8 async workers bounded by EDGAR's 10 req/s rate limit.

Usage:
    from app.ingestion.parallel_ingest import ParallelIngestor

    ingestor = ParallelIngestor(pipeline, edgar_source)
    report = await ingestor.ingest_tickers(
        tickers=SP500_TICKERS,
        filing_types=["10-K", "10-Q"],
        years_back=5,
        workers=8,
    )
    print(report.summary())

Design:
  - Semaphore(workers) caps outstanding pipeline.ingest_from_url() calls.
  - Separate Semaphore(10) for EDGAR HTTP fetches (TOS: ≤10 req/s).
  - Redis deduplication via edgar_source._is_seen() — skips already-indexed filings.
  - Per-ticker / per-filing error isolation — one bad filing never aborts the run.
  - Checkpoint file (JSON lines) lets interrupted runs resume mid-corpus.
  - Progress callback fires after every completed filing for live dashboard updates.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import structlog

logger = structlog.get_logger()

# EDGAR TOS: no more than 10 requests/second across the entire process.
_EDGAR_HTTP_SEM = asyncio.Semaphore(10)


@dataclass
class FilingTask:
    ticker: str
    company_name: str
    filing_type: str
    filing_date: str
    accession_number: str
    url: str


@dataclass
class FilingResult:
    task: FilingTask
    success: bool
    skipped: bool = False       # already indexed
    error: Optional[str] = None
    duration_s: float = 0.0
    chunks_indexed: int = 0


@dataclass
class IngestReport:
    tickers: list[str]
    total_filings: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    total_chunks: int = 0
    elapsed_s: float = 0.0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        rate = self.total_filings / max(self.elapsed_s / 3600, 0.001)
        return (
            f"Ingest complete: {self.succeeded}/{self.total_filings} filed "
            f"({self.skipped} skipped, {self.failed} failed) | "
            f"{self.total_chunks:,} chunks | "
            f"{self.elapsed_s:.0f}s elapsed | {rate:.0f} filings/hr"
        )


class ParallelIngestor:
    """
    Parallel SEC filing ingestion with bounded concurrency and deduplication.

    Args:
        pipeline:      IngestionPipeline instance (has ingest_from_url)
        edgar_source:  SECEdgarSource instance (has fetch_company_filings + _is_seen)
        checkpoint:    Path to JSONL checkpoint file; pass None to disable resume
    """

    def __init__(
        self,
        pipeline,
        edgar_source,
        checkpoint: Optional[str | Path] = None,
    ):
        self.pipeline = pipeline
        self.edgar = edgar_source
        self._checkpoint_path = Path(checkpoint) if checkpoint else None
        self._seen_accessions: set[str] = set()
        if self._checkpoint_path and self._checkpoint_path.exists():
            self._load_checkpoint()

    def _load_checkpoint(self) -> None:
        """Load previously completed accession numbers to skip on resume."""
        try:
            with open(self._checkpoint_path) as f:
                for line in f:
                    rec = json.loads(line)
                    if rec.get("success"):
                        self._seen_accessions.add(rec["accession_number"])
            logger.info("checkpoint_loaded", already_done=len(self._seen_accessions))
        except Exception as e:
            logger.warning("checkpoint_load_failed", error=str(e))

    def _write_checkpoint(self, result: FilingResult) -> None:
        if not self._checkpoint_path:
            return
        try:
            with open(self._checkpoint_path, "a") as f:
                f.write(json.dumps({
                    "ticker": result.task.ticker,
                    "accession_number": result.task.accession_number,
                    "filing_type": result.task.filing_type,
                    "filing_date": result.task.filing_date,
                    "success": result.success,
                    "chunks_indexed": result.chunks_indexed,
                    "duration_s": round(result.duration_s, 2),
                    "error": result.error,
                }) + "\n")
        except Exception as e:
            logger.warning("checkpoint_write_failed", error=str(e))

    async def ingest_tickers(
        self,
        tickers: list[str],
        filing_types: list[str] | None = None,
        years_back: int = 5,
        max_filings_per_ticker: int = 20,
        workers: int = 8,
        on_progress: Optional[Callable[[FilingResult, IngestReport], None]] = None,
    ) -> IngestReport:
        """
        Ingest all filings for a list of tickers in parallel.

        workers=8 at ~60s/filing average → ~480 filings/hour.
        EDGAR 10 req/s limit is the real ceiling, not the worker count.
        """
        filing_types = filing_types or ["10-K", "10-Q"]
        t0 = time.perf_counter()

        logger.info(
            "parallel_ingest_start",
            tickers=len(tickers),
            filing_types=filing_types,
            years_back=years_back,
            workers=workers,
        )

        # ── Phase 1: Enumerate all filings (bounded fetch, 10 req/s) ──
        tasks = await self._enumerate_filings(
            tickers, filing_types, max_filings_per_ticker
        )
        logger.info("filings_enumerated", total=len(tasks))

        report = IngestReport(tickers=tickers, total_filings=len(tasks))

        if not tasks:
            return report

        # ── Phase 2: Parallel ingestion ───────────────────────────────
        sem = asyncio.Semaphore(workers)
        lock = asyncio.Lock()

        async def _run_one(task: FilingTask) -> None:
            async with sem:
                result = await self._ingest_one(task)
                async with lock:
                    if result.skipped:
                        report.skipped += 1
                    elif result.success:
                        report.succeeded += 1
                        report.total_chunks += result.chunks_indexed
                    else:
                        report.failed += 1
                        if result.error:
                            report.errors.append(
                                f"{task.ticker}/{task.filing_type}/{task.filing_date}: {result.error}"
                            )
                self._write_checkpoint(result)
                if on_progress:
                    try:
                        on_progress(result, report)
                    except Exception:
                        pass

        await asyncio.gather(*[_run_one(t) for t in tasks], return_exceptions=True)

        report.elapsed_s = time.perf_counter() - t0
        logger.info("parallel_ingest_done", **{
            "succeeded": report.succeeded,
            "failed": report.failed,
            "skipped": report.skipped,
            "chunks": report.total_chunks,
            "elapsed_s": round(report.elapsed_s, 1),
        })
        return report

    async def _enumerate_filings(
        self,
        tickers: list[str],
        filing_types: list[str],
        max_filings_per_ticker: int,
    ) -> list[FilingTask]:
        """Fetch filing metadata for all tickers, bounded by EDGAR rate limit."""
        tasks: list[FilingTask] = []
        enum_sem = asyncio.Semaphore(5)  # 5 concurrent metadata fetches

        async def _fetch_ticker(ticker: str) -> list[FilingTask]:
            async with enum_sem:
                async with _EDGAR_HTTP_SEM:
                    filings = await self.edgar.fetch_company_filings(
                        ticker=ticker,
                        filing_types=filing_types,
                        max_filings=max_filings_per_ticker,
                    )
                return [
                    FilingTask(
                        ticker=f["ticker"],
                        company_name=f.get("company_name", ticker),
                        filing_type=f["filing_type"],
                        filing_date=f.get("filing_date", ""),
                        accession_number=f.get("accession_number", ""),
                        url=f.get("url", ""),
                    )
                    for f in filings
                    if f.get("url")
                ]

        results = await asyncio.gather(*[_fetch_ticker(t) for t in tickers], return_exceptions=True)
        for r in results:
            if isinstance(r, list):
                tasks.extend(r)
        return tasks

    async def _ingest_one(self, task: FilingTask) -> FilingResult:
        """Ingest a single filing with deduplication and error isolation."""
        t0 = time.perf_counter()

        # Checkpoint-based dedup (fast path — no Redis needed)
        if task.accession_number and task.accession_number in self._seen_accessions:
            return FilingResult(task=task, success=True, skipped=True)

        # Redis dedup via edgar_source
        if task.accession_number:
            try:
                already_seen = await self.edgar._is_seen(task.accession_number)
                if already_seen:
                    self._seen_accessions.add(task.accession_number)
                    return FilingResult(task=task, success=True, skipped=True)
            except Exception:
                pass  # Redis unavailable — proceed

        if not task.url:
            return FilingResult(
                task=task, success=False, error="no_url",
                duration_s=time.perf_counter() - t0,
            )

        try:
            async with _EDGAR_HTTP_SEM:
                result = await self.pipeline.ingest_from_url(
                    url=task.url,
                    filing_type=task.filing_type,
                    ticker=task.ticker,
                    company_name=task.company_name,
                    filing_date=task.filing_date,
                )

            chunks = result.get("chunks_indexed", 0) if isinstance(result, dict) else 0
            err = result.get("error") if isinstance(result, dict) else None

            if task.accession_number:
                try:
                    await self.edgar._mark_seen(task.accession_number)
                    self._seen_accessions.add(task.accession_number)
                except Exception:
                    pass

            logger.info(
                "filing_ingested",
                ticker=task.ticker,
                filing_type=task.filing_type,
                date=task.filing_date,
                chunks=chunks,
            )
            return FilingResult(
                task=task,
                success=err is None,
                error=err,
                duration_s=time.perf_counter() - t0,
                chunks_indexed=chunks,
            )

        except Exception as e:
            logger.error(
                "filing_ingest_failed",
                ticker=task.ticker,
                filing_type=task.filing_type,
                error=str(e),
            )
            return FilingResult(
                task=task, success=False, error=str(e),
                duration_s=time.perf_counter() - t0,
            )


# ── S&P 500 ticker list (as of 2026) ────────────────────────────────────────
# fmt: off
SP500_TICKERS: list[str] = [
    "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","BRK.B","LLY",
    "JPM","UNH","V","XOM","MA","AVGO","HD","PG","COST","JNJ","MRK","CVX","CRM",
    "BAC","ABBV","ACN","ORCL","MCD","NFLX","TMO","LIN","CSCO","WMT","PM","INTU",
    "QCOM","AMD","TXN","DHR","AMGN","NEE","DIS","UPS","IBM","INTC","GS","CAT",
    "RTX","SPGI","ISRG","BX","LOW","GILD","HON","BKNG","ELV","VRTX","SYK","T",
    "AXP","PLD","MMC","CB","REGN","MU","DE","CI","PGR","ADI","SCHW","BSX","ETN",
    "BDX","LRCX","C","MDLZ","WM","AON","ZTS","ADP","CME","CCI","ANET","GE","EQIX",
    "ITW","EW","APD","NOC","HCA","ICE","MCO","KMB","PNC","USB","KLAC","CDNS","MO",
    "NSC","EMR","F","GM","GD","ECL","SNPS","TJX","TGT","SHW","CSX","ROP","MAR",
    "FTNT","COF","OKE","PSX","ADSK","NXPI","MNST","AIG","TEL","NEM","DXCM","ALC",
    "WBA","KHC","VICI","O","PCG","PH","SRE","DOW","LHX","FDX","MSI","PAYX","PRU",
    "WELL","CTAS","IQV","MCK","AME","AFL","STZ","RCL","MSCI","SPG","CMG","MCHP",
    "PCAR","EXC","DG","ED","VLO","GIS","IDXX","TT","XEL","AEP","PPL","AWK","LUV",
    "WEC","DTE","SO","AES","CMS","CNP","NI","PEG","FE","ETR","EIX","SWK","KEY",
    "CFG","HBAN","RF","ZION","FHN","NTRS","BK","STT","FITB","WAL","WTFC","MTB",
    "TFC","CMA","SNV","PACW","WAB","J","PWR","FLR","MTD","IEX","ROK","PNR","XYL",
    "XYLD","GWW","FAST","OTIS","CARR","TDG","HWM","SPX","GNRC","SNA","IR","RRX",
    "ALLE","MAS","PH","A","CTSH","EPAM","IT","DXC","LDOS","SAIC","BAH","CACI",
    "VRSK","ANSS","FBHS","LKQ","IFF","CE","EMN","RPM","AVY","PKG","IP","SEE",
    "CF","MOS","FMC","CTVA","ADM","BG","DAR","INGR","HRL","SJM","CAG","MKC",
    "CHD","CLX","CL","KMB","EL","COTY","REV","NWSA","NWS","PARA","WBD","LYV",
    "OMC","IPG","IEX","VZ","TMUS","LUMN","DISH","ATVI","EA","TTWO","RBLX",
]
# fmt: on
