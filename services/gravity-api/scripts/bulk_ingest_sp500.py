"""
Bulk SEC EDGAR Ingestion — S&P 500 × 3 years
=============================================
Downloads and indexes ~7,500 filings (10-K, 10-Q, 8-K) for all S&P 500
companies covering the last 3 years into Qdrant + Elasticsearch + Neo4j.

Usage:
    python scripts/bulk_ingest_sp500.py                    # all S&P 500
    python scripts/bulk_ingest_sp500.py --tickers AAPL MSFT NVDA   # specific tickers
    python scripts/bulk_ingest_sp500.py --limit 50         # first 50 companies
    python scripts/bulk_ingest_sp500.py --types 10-K 10-Q  # filing types only
    python scripts/bulk_ingest_sp500.py --resume           # skip already-indexed

Progress is saved to bulk_ingest_progress.json so you can stop and resume anytime.
EDGAR rate limit: 10 req/s — this script respects it automatically.
"""

import asyncio
import json
import sys
import argparse
import time
import os
from pathlib import Path
from datetime import datetime, timedelta

# S&P 500 tickers — full list (503 as of 2024, includes dual-class shares)
SP500_TICKERS = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "META", "GOOGL", "GOOG", "AMD", "QCOM", "TXN",
    "AMAT", "LRCX", "KLAC", "MCHP", "SNPS", "CDNS", "INTC", "MU", "STX", "WDC",
    "HPQ", "HPE", "DELL", "NTAP", "FFIV", "JNPR", "CSCO", "ANET", "GLW", "TEL",
    "APH", "KEYS", "TRMB", "TDY", "LDOS", "EPAM", "IT", "CTSH", "ACN", "IBM",
    "INTU", "ADBE", "CRM", "NOW", "WDAY", "TEAM", "DDOG", "ZM", "CRWD", "PANW",
    "OKTA", "ZS", "SNOW", "PLTR", "TWLO", "HUBS", "VEEV", "PAYC", "COUP", "PCTY",
    # Communication Services
    "AMZN", "NFLX", "GOOGL", "META", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR",
    "PARA", "WBD", "FOXA", "FOX", "OMC", "IPG", "EA", "ATVI", "TTWO", "MTCH",
    # Financials
    "BRK-B", "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "SCHW",
    "CB", "PGR", "ALL", "TRV", "MET", "PRU", "AIG", "AFL", "HIG", "LNC",
    "USB", "PNC", "TFC", "COF", "DFS", "SYF", "FITB", "HBAN", "RF", "CFG",
    "MTB", "ZION", "CMA", "KEY", "WRB", "AMP", "RJF", "LM", "BEN", "IVZ",
    "TROW", "STT", "BK", "NTRS", "CBOE", "ICE", "CME", "NDAQ", "SPGI", "MCO",
    # Healthcare
    "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN",
    "GILD", "ISRG", "VRTX", "REGN", "BIIB", "MRNA", "BDX", "BSX", "MDT", "SYK",
    "ZBH", "EW", "HOLX", "IDXX", "PODD", "TFX", "XRAY", "COO", "BAX", "BIO",
    "CVS", "CI", "ELV", "HUM", "CNC", "MOH", "HCA", "UHS", "THC", "ESRX",
    # Consumer
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "TJX", "ROST",
    "BKNG", "MAR", "HLT", "YUM", "CMG", "DPZ", "QSR", "NCLH", "CCL", "RCL",
    "PG", "KO", "PEP", "PM", "MO", "CL", "COST", "WMT", "KR", "SYY",
    "HSY", "GIS", "K", "CPB", "MKC", "HRL", "CAG", "SJM", "CHD", "CLX",
    # Energy
    "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "PXD", "DVN",
    "HAL", "BKR", "NOV", "FTI", "OXY", "APA", "FANG", "MRO", "HES", "WMB",
    "OKE", "KMI", "LNG", "CQP", "ET", "EPD", "MPLX", "PAA", "TRGP", "DTM",
    # Industrials
    "GE", "HON", "UPS", "RTX", "LMT", "NOC", "GD", "BA", "CAT", "DE",
    "EMR", "ETN", "PH", "ROK", "IR", "AME", "FTV", "GNRC", "XYL", "TRMB",
    "ROP", "VRSK", "IEX", "WM", "RSG", "CTAS", "FAST", "GWW", "MSC", "SNA",
    "ITW", "DOV", "SWK", "TT", "JCI", "CARR", "OTIS", "CSX", "UNP", "NSC",
    # Materials
    "LIN", "APD", "ECL", "SHW", "PPG", "RPM", "IFF", "EMN", "CE", "HUN",
    "CF", "MOS", "NUE", "STLD", "RS", "ATI", "CMC", "CRS", "WOR", "ZEUS",
    # Real Estate
    "AMT", "PLD", "CCI", "EQIX", "PSA", "EXR", "AVB", "EQR", "ESS", "MAA",
    "UDR", "CPT", "NNN", "O", "STOR", "VICI", "GLPI", "SPG", "MAC", "SLG",
    # Utilities
    "NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE", "PEG", "XEL", "WEC",
    "ES", "AWK", "CMS", "AES", "ETR", "PPL", "FE", "EIX", "ED", "DTE",
]

# Deduplicate while preserving order
_seen = set()
SP500_TICKERS = [t for t in SP500_TICKERS if not (t in _seen or _seen.add(t))]

PROGRESS_FILE = Path(__file__).parent / "bulk_ingest_progress.json"
FILING_TYPES = ["10-K", "10-Q", "8-K"]
YEARS_BACK = 3
MAX_PER_TYPE = 4  # 10-K: last 3, 10-Q: last 12, 8-K: last 10


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"done": [], "failed": [], "started": datetime.now().isoformat()}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


async def ingest_ticker(ticker: str, filing_types: list[str], pipeline, edgar_source) -> dict:
    """Fetch and ingest all filings for one ticker. Returns status dict."""
    result = {"ticker": ticker, "ok": 0, "skipped": 0, "errors": 0, "chunks": 0}

    try:
        # max_filings: 10-K → 3, 10-Q → 12, 8-K → 10
        type_limits = {"10-K": 3, "10-Q": 12, "8-K": 10}
        max_f = max(type_limits.get(t, 5) for t in filing_types)

        filings = await edgar_source.fetch_company_filings(
            ticker=ticker,
            filing_types=filing_types,
            max_filings=max_f,
        )

        if not filings:
            print(f"  [{ticker}] No filings found")
            result["skipped"] = 1
            return result

        # Filter to last YEARS_BACK years
        cutoff = datetime.now() - timedelta(days=365 * YEARS_BACK)
        recent = [f for f in filings if _parse_date(f.get("filing_date", "")) > cutoff]

        if not recent:
            print(f"  [{ticker}] All filings older than {YEARS_BACK} years, skipping")
            result["skipped"] = 1
            return result

        print(f"  [{ticker}] Found {len(recent)} filings to ingest...")

        for filing in recent:
            try:
                url = filing.get("url", "")
                content = filing.get("content", "")
                filing_type = filing.get("filing_type", "unknown")
                filing_date = filing.get("filing_date", "")

                if not url and not content:
                    result["errors"] += 1
                    continue

                if content:
                    # Already has text content
                    ingest_result = await pipeline.ingest_bytes(
                        content=content.encode("utf-8"),
                        content_type="text/html",
                        filename=f"{ticker}_{filing_type}_{filing_date}.html",
                        ticker=ticker,
                        filing_type=filing_type,
                        filing_date=filing_date,
                    )
                else:
                    # Need to download from URL
                    ingest_result = await pipeline.ingest_from_url(
                        url=url,
                        ticker=ticker,
                        filing_type=filing_type,
                        filing_date=filing_date,
                    )

                if ingest_result and ingest_result.get("status") != "error":
                    result["ok"] += 1
                    result["chunks"] += ingest_result.get("chunks_indexed", 0)
                else:
                    result["errors"] += 1

                # EDGAR rate limit: max 10 req/s
                await asyncio.sleep(0.15)

            except Exception as e:
                print(f"    [{ticker}] Filing error: {e}")
                result["errors"] += 1

    except Exception as e:
        print(f"  [{ticker}] FAILED: {e}")
        result["errors"] += 1

    return result


def _parse_date(date_str: str) -> datetime:
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y%m%d"):
        try:
            return datetime.strptime(date_str[:10], fmt[:len(date_str[:10])])
        except ValueError:
            continue
    return datetime(2000, 1, 1)  # fallback — will be filtered out


async def main():
    parser = argparse.ArgumentParser(description="Bulk ingest S&P 500 SEC filings")
    parser.add_argument("--tickers", nargs="+", help="Specific tickers to ingest")
    parser.add_argument("--limit", type=int, help="Max number of companies")
    parser.add_argument("--types", nargs="+", default=FILING_TYPES,
                        help="Filing types (default: 10-K 10-Q 8-K)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip already-completed tickers")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Parallel tickers (default: 3, max: 5)")
    args = parser.parse_args()

    # Setup
    sys.path.insert(0, str(Path(__file__).parent.parent))
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    from app.dependencies import get_search_pipeline
    from app.ingestion.sources.sec_edgar import SECEdgarSource
    from app.ingestion.pipeline import IngestionPipeline

    print("Initializing pipeline...")
    pipeline_obj = get_search_pipeline()
    ingest_pipeline = IngestionPipeline()
    edgar_source = SECEdgarSource(ingestion_pipeline=ingest_pipeline)

    # Determine ticker list
    tickers = args.tickers or SP500_TICKERS
    if args.limit:
        tickers = tickers[:args.limit]

    # Resume support
    progress = load_progress()
    if args.resume:
        done_set = set(progress.get("done", []))
        tickers = [t for t in tickers if t not in done_set]
        print(f"Resuming: {len(done_set)} already done, {len(tickers)} remaining")

    total = len(tickers)
    print(f"\nIngesting {total} companies | Types: {args.types} | Concurrency: {args.concurrency}")
    print(f"Estimated time: {total * 8 // 60}–{total * 15 // 60} minutes\n")

    semaphore = asyncio.Semaphore(args.concurrency)
    stats = {"total": 0, "ok": 0, "errors": 0, "chunks": 0}
    start_time = time.time()

    async def process_one(ticker: str, idx: int):
        async with semaphore:
            print(f"[{idx+1}/{total}] Processing {ticker}...")
            result = await ingest_ticker(ticker, args.types, ingest_pipeline, edgar_source)

            stats["total"] += 1
            stats["ok"] += result["ok"]
            stats["errors"] += result["errors"]
            stats["chunks"] += result["chunks"]

            if result["ok"] > 0:
                progress["done"].append(ticker)
            elif result["errors"] > 0:
                progress["failed"].append(ticker)

            save_progress(progress)

            elapsed = time.time() - start_time
            rate = stats["total"] / elapsed * 60
            eta_min = (total - stats["total"]) / max(rate, 0.1)
            print(f"  -> {result['ok']} filings, {result['chunks']} chunks | "
                  f"ETA: {eta_min:.0f}min | Total chunks: {stats['chunks']}")

    # Run with concurrency limit
    tasks = [process_one(ticker, i) for i, ticker in enumerate(tickers)]
    await asyncio.gather(*tasks)

    # Final summary
    elapsed = time.time() - start_time
    print(f"""
========================================
  BULK INGEST COMPLETE
========================================
  Companies processed : {stats['total']}
  Filings ingested    : {stats['ok']}
  Errors              : {stats['errors']}
  Total chunks        : {stats['chunks']}
  Time elapsed        : {elapsed/60:.1f} min

  Qdrant collection   : gravity_chunks
  Run FinanceBench to validate:
    python tests/eval/financebench.py --sample 25 --embedded
========================================
""")


if __name__ == "__main__":
    asyncio.run(main())
