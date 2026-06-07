"""
Standalone SEC EDGAR downloader (corpus builder)
================================================
Inspired by daveebbelaar/document-copilot's `data/download.py`: download the
filing corpus to disk FIRST, index it LATER. This decouples the (free, always
available) download step from the (rate-limited / paid) embed+index step, so a
flaky embedder can never block corpus building — and indexing is fully resumable.

Writes raw filings to:
    <out>/<TICKER>/<YEAR>/<TICKER>_<TYPE>_<DATE>_<ACCESSION>.html
and a manifest at:
    <out>/manifest.json   (one record per filing; used for resume + later indexing)

Usage:
    python scripts/download_sec.py --tickers AAPL MSFT NVDA --types 10-K 10-Q
    python scripts/download_sec.py --tickers AAPL --max-per-ticker 8 --out data/filings
    python scripts/download_sec.py --tickers AAPL --since 2022   # filing_date year >= 2022

No API keys needed — only EDGAR's User-Agent (set in app.ingestion.sources.sec_edgar).
Indexing the result later (once an embedder is live):
    python scripts/index_from_manifest.py --manifest data/filings/manifest.json
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Allow running from services/gravity-api/ as `python scripts/download_sec.py`
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.ingestion.sources.sec_edgar import SECEdgarSource  # noqa: E402


def _load_manifest(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"created": datetime.now(timezone.utc).isoformat(), "filings": {}}


def _save_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest["updated"] = datetime.now(timezone.utc).isoformat()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    tmp.replace(path)  # atomic on same filesystem


def _key(rec: dict) -> str:
    """Stable dedup key: accession if present, else ticker|type|date."""
    acc = (rec.get("accession_number") or "").strip()
    if acc:
        return acc
    return f"{rec.get('ticker','')}|{rec.get('filing_type','')}|{rec.get('filing_date','')}"


def _dest(out: Path, rec: dict) -> Path:
    year = (rec.get("filing_date") or "0000")[:4] or "0000"
    acc = (rec.get("accession_number") or "na").replace("/", "-")
    fname = f"{rec['ticker']}_{rec['filing_type']}_{rec.get('filing_date','')}_{acc}.html"
    return out / rec["ticker"] / year / fname


async def download_ticker(
    src: SECEdgarSource, out: Path, manifest: dict,
    ticker: str, types: list[str], max_per: int, since_year: int | None,
) -> dict:
    stats = {"ticker": ticker, "found": 0, "downloaded": 0, "skipped": 0, "failed": 0, "bytes": 0}
    filings = await src.fetch_company_filings(ticker=ticker, filing_types=types, max_filings=max_per)
    stats["found"] = len(filings)

    for rec in filings:
        if since_year and (rec.get("filing_date") or "")[:4].isdigit():
            if int(rec["filing_date"][:4]) < since_year:
                continue

        k = _key(rec)
        prior = manifest["filings"].get(k)
        dest = _dest(out, rec)
        if prior and prior.get("status") == "downloaded" and Path(prior["path"]).exists():
            stats["skipped"] += 1
            continue

        url = rec.get("url") or ""
        if not url:
            stats["failed"] += 1
            manifest["filings"][k] = {**rec, "status": "no_url"}
            continue

        content = await src._download_filing(url)
        if not content:
            stats["failed"] += 1
            manifest["filings"][k] = {**rec, "status": "download_failed", "url": url}
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
        sha = hashlib.sha256(content).hexdigest()
        manifest["filings"][k] = {
            **rec,
            "path": str(dest),
            "bytes": len(content),
            "sha256": sha,
            "status": "downloaded",
            "downloaded_at": datetime.now(timezone.utc).isoformat(),
        }
        stats["downloaded"] += 1
        stats["bytes"] += len(content)
        _save_manifest(out / "manifest.json", manifest)  # checkpoint after each file
        await asyncio.sleep(0.12)  # be gentle to EDGAR (≤10 req/s)

    return stats


async def main() -> None:
    ap = argparse.ArgumentParser(description="Download SEC filings to disk + manifest (no indexing)")
    ap.add_argument("--tickers", nargs="+", required=True, help="Tickers, e.g. AAPL MSFT NVDA")
    ap.add_argument("--types", nargs="+", default=None,
                    help="Filing types (default: registry defaults). See app/core/filing_types.py")
    ap.add_argument("--all-types", action="store_true",
                    help="Download every supported filing type from the registry")
    ap.add_argument("--max-per-ticker", type=int, default=8, help="Max filings per ticker")
    ap.add_argument("--out", default="data/filings", help="Output dir (manifest.json lives here)")
    ap.add_argument("--since", type=int, default=None, help="Only filing_date year >= this")
    args = ap.parse_args()

    from app.core.filing_types import (
        normalize_filing_types, SUPPORTED_FILING_TYPES,
    )
    if args.all_types:
        types = [f.code for f in SUPPORTED_FILING_TYPES]
    else:
        types, unknown = normalize_filing_types(args.types)
        if unknown:
            print(f"Unsupported filing types: {', '.join(unknown)} "
                  f"(supported: {', '.join(f.code for f in SUPPORTED_FILING_TYPES)})")
            sys.exit(1)

    out = Path(args.out)
    manifest = _load_manifest(out / "manifest.json")
    src = SECEdgarSource()

    print(f"Downloading {args.tickers} | types={types} | max/ticker={args.max_per_ticker} -> {out}")
    t0 = time.time()
    totals = {"found": 0, "downloaded": 0, "skipped": 0, "failed": 0, "bytes": 0}
    for tk in args.tickers:
        s = await download_ticker(src, out, manifest, tk, types, args.max_per_ticker, args.since)
        print(f"  [{tk}] found={s['found']} downloaded={s['downloaded']} "
              f"skipped={s['skipped']} failed={s['failed']} ({s['bytes']/1e6:.1f} MB)")
        for k in totals:
            totals[k] += s[k]

    _save_manifest(out / "manifest.json", manifest)
    print(
        f"\nDONE in {time.time()-t0:.0f}s | downloaded={totals['downloaded']} "
        f"skipped={totals['skipped']} failed={totals['failed']} "
        f"| {totals['bytes']/1e6:.1f} MB | manifest: {out/'manifest.json'} "
        f"| total in manifest: {len(manifest['filings'])}"
    )


if __name__ == "__main__":
    asyncio.run(main())
