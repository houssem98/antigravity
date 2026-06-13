#!/usr/bin/env python3
"""
Company-correctness eval — the guardrail the RAG triad misses.

Faithfulness/relevancy can PASS on a wrong-company answer: if retrieval drifts
to Kroger's filings for an "Amazon" query, the answer is faithful to the (wrong)
context it was given. This metric checks the thing that actually matters to a
finance customer: **every cited source belongs to the company the query asked
about.** It directly catches cross-company drift and cache poisoning (the
Amazon→Kroger bug class).

Scoring per query (only queries with a single expected ticker):
  pass        — expected ticker cited, no foreign ticker
  mixed       — expected cited but a foreign company also leaked in
  wrong       — expected ticker absent (answered a different company)
  no_sources  — empty (no-docs path; not a correctness failure)
  error       — request failed

company_correctness = pass / (scored, excl. error & no_sources)

Usage:
  python tests/eval/company_correctness.py --limit 30 --threshold 0.95
  GRAVITY_API_URL=https://gravity-api-prod.fly.dev python tests/eval/company_correctness.py
"""

import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

import httpx

GOLDEN = Path(__file__).parent / "golden_queries.json"


async def get_token(client: httpx.AsyncClient, base_url: str) -> str:
    try:
        r = await client.post(
            f"{base_url}/v1/auth/signup",
            json={
                "email": f"eval-{uuid.uuid4().hex[:10]}@example.com",
                "password": f"Eval!{uuid.uuid4().hex[:8]}aA9",
                "name": "eval",
            },
            timeout=30.0,
        )
        return (r.json() or {}).get("access_token", "") if r.status_code < 500 else ""
    except Exception:
        return ""


async def fetch(client: httpx.AsyncClient, base_url: str, token: str, query: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    # Retry on 429 — the API rate-limits per user/tier; the eval must back off,
    # not record the throttle as a product error.
    for attempt in range(5):
        try:
            r = await client.post(
                f"{base_url}/v1/search",
                headers=headers,
                json={"query": query, "options": {"reasoning_depth": "fast", "stream": False}},
                timeout=200.0,
            )
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After") or min(2 ** attempt, 20))
                await asyncio.sleep(wait + 1)
                continue
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "tickers": []}
            d = r.json()
            cits = d.get("citations") or []
            srcs = d.get("sources") or []
            tks = [str(c.get("ticker", "")).upper() for c in cits if c.get("ticker")]
            if not tks:
                tks = [str(s.get("ticker", "")).upper() for s in srcs if s.get("ticker")]
            return {"error": None, "tickers": tks}
        except Exception as e:
            return {"error": str(e)[:80], "tickers": []}
    return {"error": "HTTP 429 (rate-limited after retries)", "tickers": []}


# Dual-class / renamed tickers that denote the SAME company — not a wrong-company.
_EQUIV = {
    "GOOG": "GOOGL", "GOOGL": "GOOGL",
    "FB": "META", "META": "META",
    "BRK.A": "BRK", "BRK.B": "BRK", "BRK-A": "BRK", "BRK-B": "BRK", "BRKA": "BRK", "BRKB": "BRK",
}


def _canon(t: str) -> str:
    t = (t or "").upper().replace("-", ".")
    return _EQUIV.get(t, t)


def verdict(expected: str, tickers: list[str]) -> str:
    exp = _canon(expected)
    canon = [_canon(t) for t in tickers if t]
    if not canon:
        return "no_sources"
    foreign = [t for t in canon if t != exp]
    if exp in canon and not foreign:
        return "pass"
    if exp in canon and foreign:
        return "mixed"
    return "wrong"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.getenv("GRAVITY_API_URL", "https://gravity-api-prod.fly.dev"))
    ap.add_argument("--limit", type=int, default=0, help="cap number of queries (0 = all)")
    ap.add_argument("--threshold", type=float, default=0.95, help="CI gate: min pass rate")
    ap.add_argument("--delay", type=float, default=3.0, help="seconds between queries (stay under rate limit)")
    ap.add_argument("--output", default="", help="write JSON report to this path")
    args = ap.parse_args()

    data = json.loads(GOLDEN.read_text(encoding="utf-8"))
    # Single-company queries only (skip comparisons/multi-entity with no single ticker).
    qs = [q for q in data["queries"] if (q.get("expected_entities") or {}).get("ticker")]
    if args.limit:
        qs = qs[: args.limit]

    counts = {"pass": 0, "mixed": 0, "wrong": 0, "no_sources": 0, "error": 0}
    results = []
    async with httpx.AsyncClient() as client:
        token = await get_token(client, args.base_url)
        if not token:
            print("WARN: no auth token (prod WS/REST may reject) — continuing unauthenticated")
        for i, q in enumerate(qs, 1):
            exp = q["expected_entities"]["ticker"]
            r = await fetch(client, args.base_url, token, q["query"])
            v = "error" if r["error"] else verdict(exp, r["tickers"])
            counts[v] = counts.get(v, 0) + 1
            results.append({"id": q["id"], "query": q["query"][:70], "expected": exp,
                            "tickers": r["tickers"][:6], "verdict": v, "error": r["error"]})
            print(f"[{i}/{len(qs)}] {q['id']} exp={exp:6} -> {v:10} {r['tickers'][:4]}")
            if args.delay and i < len(qs):
                await asyncio.sleep(args.delay)

    scored = counts["pass"] + counts["mixed"] + counts["wrong"]
    rate = counts["pass"] / scored if scored else 0.0
    print("\n=== COMPANY-CORRECTNESS ===")
    print(f"pass={counts['pass']} mixed={counts['mixed']} wrong={counts['wrong']} "
          f"no_sources={counts['no_sources']} error={counts['error']} / {len(qs)}")
    print(f"company_correctness = {rate:.1%}  (strict pass / scored)")

    failures = [r for r in results if r["verdict"] in ("wrong", "mixed")]
    if failures:
        print("\nWRONG/CONTAMINATED COMPANY:")
        for r in failures[:25]:
            print(f"  {r['id']}: asked {r['expected']} -> cited {r['tickers']} ({r['verdict']})")

    if args.output:
        Path(args.output).write_text(json.dumps(
            {"rate": rate, "counts": counts, "threshold": args.threshold, "results": results},
            indent=2), encoding="utf-8")
        print(f"\nReport → {args.output}")

    if rate < args.threshold:
        print(f"\nGATE FAIL: {rate:.1%} < {args.threshold:.0%}")
        sys.exit(1)
    print(f"\nGATE PASS: {rate:.1%} >= {args.threshold:.0%}")


if __name__ == "__main__":
    asyncio.run(main())
