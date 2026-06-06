"""
Index downloaded SEC filings from a manifest (resumable)
========================================================
Second half of the download_sec.py -> index pipeline (document-copilot pattern).
Reads the manifest produced by `download_sec.py` and POSTs each downloaded
filing to the WARM gravity-api `/v1/documents/ingest` endpoint, so indexing runs
inside the already-loaded server process (no cold-start OOM) and uses the live
embedder failover chain. Progress is written back to the manifest so it can be
stopped and resumed at any time, and re-runs skip already-indexed filings.

Auth: the endpoint requires a Bearer JWT. Provide one of:
  --token <jwt>                 explicit token
  env GRAVITY_TOKEN=<jwt>       from environment
On the Fly box you can mint one from AUTH_JWT_SECRET (see DEPLOY_RUNBOOK).

Usage:
    python scripts/index_from_manifest.py --manifest data/filings/manifest.json \
        --api https://gravity-api-prod.fly.dev --token "$GRAVITY_TOKEN"

    # only index a subset
    python scripts/index_from_manifest.py --manifest data/filings/manifest.json --tickers AAPL MSFT
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


def _save(manifest_path: Path, manifest: dict) -> None:
    manifest["updated"] = datetime.now(timezone.utc).isoformat()
    tmp = manifest_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    tmp.replace(manifest_path)


def main() -> None:
    ap = argparse.ArgumentParser(description="Index downloaded filings from a manifest via the warm API")
    ap.add_argument("--manifest", required=True, help="Path to manifest.json from download_sec.py")
    ap.add_argument("--api", default="https://gravity-api-prod.fly.dev", help="gravity-api base URL")
    ap.add_argument("--token", default=os.environ.get("GRAVITY_TOKEN", ""), help="Bearer JWT")
    ap.add_argument("--tickers", nargs="+", default=None, help="Only index these tickers")
    ap.add_argument("--limit", type=int, default=None, help="Max filings to index this run")
    ap.add_argument("--timeout", type=float, default=300.0, help="Per-file ingest timeout (s)")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        print(f"Manifest not found: {manifest_path}"); sys.exit(1)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if not args.token:
        print("No token. Pass --token or set GRAVITY_TOKEN."); sys.exit(1)

    headers = {"Authorization": f"Bearer {args.token}"}
    url = f"{args.api.rstrip('/')}/v1/documents/ingest"

    items = [
        (k, r) for k, r in manifest["filings"].items()
        if r.get("status") == "downloaded"
        and (not args.tickers or r.get("ticker") in args.tickers)
    ]
    if args.limit:
        items = items[: args.limit]

    print(f"Indexing {len(items)} downloaded filings -> {url}")
    t0 = time.time()
    done = failed = chunks_total = 0

    with httpx.Client(timeout=args.timeout) as client:
        for k, rec in items:
            fpath = Path(rec["path"])
            if not fpath.exists():
                rec["status"] = "missing_file"; failed += 1; continue
            try:
                with fpath.open("rb") as fh:
                    files = {"file": (fpath.name, fh, "text/html")}
                    data = {"ticker": rec.get("ticker", ""),
                            "company_name": rec.get("company_name", "")}
                    resp = client.post(url, headers=headers, files=files, data=data)
                if resp.status_code != 200:
                    rec["status"] = "index_failed"
                    rec["index_error"] = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    failed += 1
                else:
                    body = resp.json()
                    cc = int(body.get("chunk_count", 0))
                    rec["status"] = "indexed" if cc > 0 else "indexed_zero_chunks"
                    rec["chunk_count"] = cc
                    rec["document_id"] = body.get("document_id", "")
                    rec["indexed_at"] = datetime.now(timezone.utc).isoformat()
                    chunks_total += cc
                    done += 1
                    print(f"  [{rec.get('ticker')}] {fpath.name} -> {cc} chunks")
            except Exception as e:
                rec["status"] = "index_error"; rec["index_error"] = str(e)[:200]; failed += 1
                print(f"  [{rec.get('ticker')}] {fpath.name} -> ERROR {str(e)[:120]}")
            _save(manifest_path, manifest)  # checkpoint after each

    print(f"\nDONE in {time.time()-t0:.0f}s | indexed={done} failed={failed} "
          f"| {chunks_total} chunks total")


if __name__ == "__main__":
    main()
