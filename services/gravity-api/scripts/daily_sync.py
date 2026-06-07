"""
Daily SEC corpus sync (reconciliation safety-net)
=================================================
Belt-and-suspenders for the live EDGAR poller. The poller (EDGAR_POLLING_ENABLED)
ingests new filings within minutes; this script is a daily catch-up that
guarantees nothing is missed (poller downtime, deploys, rate-limit gaps).

It chains the existing, resumable scripts:
    1. download_sec.py        — fetch any NEW filings for the tracked tickers
    2. index_from_manifest.py — index whatever is downloaded-but-not-indexed

Both are idempotent (manifest-keyed), so re-running is cheap and safe.

Run daily via OS scheduler:
  - Windows Task Scheduler:  python scripts\\daily_sync.py --tickers-file tickers.txt --token <jwt>
  - cron:                    0 6 * * *  python scripts/daily_sync.py ...
  - Fly scheduled machine / external cron hitting a wrapper.

Usage:
    python scripts/daily_sync.py --tickers AAPL MSFT NVDA --token "$GRAVITY_TOKEN"
    python scripts/daily_sync.py --tickers-file watchlist.txt --out data/filings \
        --api https://gravity-api-prod.fly.dev --token "$GRAVITY_TOKEN"
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PY = sys.executable


def _tickers(args) -> list[str]:
    if args.tickers_file:
        text = Path(args.tickers_file).read_text(encoding="utf-8")
        return [t for t in text.replace(",", " ").split() if t]
    if args.tickers:
        return args.tickers
    # Fall back to EDGAR_WATCHLIST env (same list the live poller uses)
    return [t.strip() for t in os.environ.get("EDGAR_WATCHLIST", "").split(",") if t.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description="Daily SEC corpus sync (download + index)")
    ap.add_argument("--tickers", nargs="+", default=None)
    ap.add_argument("--tickers-file", default=None, help="File of tickers (comma/space/newline separated)")
    ap.add_argument("--types", nargs="+", default=["10-K", "10-Q", "8-K"])
    ap.add_argument("--max-per-ticker", type=int, default=4, help="Recent filings to check per ticker")
    ap.add_argument("--out", default="data/filings")
    ap.add_argument("--api", default="https://gravity-api-prod.fly.dev")
    ap.add_argument("--token", default=os.environ.get("GRAVITY_TOKEN", ""))
    args = ap.parse_args()

    tickers = _tickers(args)
    if not tickers:
        print("No tickers (pass --tickers, --tickers-file, or set EDGAR_WATCHLIST)."); return 1
    manifest = str(Path(args.out) / "manifest.json")

    print(f"[daily_sync] {len(tickers)} tickers | types={args.types} | out={args.out}")

    # Step 1 — download new filings (resumable; skips already-downloaded)
    dl = subprocess.run(
        [PY, str(HERE / "download_sec.py"),
         "--tickers", *tickers, "--types", *args.types,
         "--max-per-ticker", str(args.max_per_ticker), "--out", args.out],
        cwd=str(HERE.parent),
    )
    if dl.returncode != 0:
        print("[daily_sync] download step failed"); return dl.returncode

    # Step 2 — index downloaded-but-not-indexed filings (needs token + live embedder)
    if not args.token:
        print("[daily_sync] no --token/GRAVITY_TOKEN; skipping index step "
              "(download done — index later or rely on the live poller).")
        return 0

    ix = subprocess.run(
        [PY, str(HERE / "index_from_manifest.py"),
         "--manifest", manifest, "--api", args.api, "--token", args.token,
         "--tickers", *tickers],
        cwd=str(HERE.parent),
    )
    print(f"[daily_sync] done (index rc={ix.returncode})")
    return ix.returncode


if __name__ == "__main__":
    raise SystemExit(main())
