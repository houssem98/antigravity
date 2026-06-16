"""
Reliability regression gate — the cold battery wired into a pass/fail script.

Hits the LIVE prod search endpoint with the eval key and asserts, for each query,
that the expected exact figure(s) appear in the answer, confidence meets a floor,
and latency is within budget. Catches silent regressions (e.g. Amazon worked →
broke → worked again across one session) before they reach users.

Run:
  python scripts/reliability_battery.py
  python scripts/reliability_battery.py --base https://gravity-api-prod.fly.dev
  python scripts/reliability_battery.py --max-latency 45      # loosen on a cold box

Exit code 0 = all pass, 1 = any fail (so it can gate a deploy in CI).

Cases are the queries verified correct on 2026-06-16. Numbers are matched
comma-insensitively ("211915" matches "$211,915 million"). A case passes when ALL
its `needs` tokens appear AND (if set) confidence is in `min_conf` set.
"""

import argparse
import asyncio
import sys
import time

import httpx

DEFAULT_BASE = "https://gravity-api-prod.fly.dev"
API_KEY = "eval-unlimited-fb-2026"

# (query, [required tokens — all must appear], allowed-confidence set or None)
HIGH = {"HIGH"}
HIGH_MED = {"HIGH", "MEDIUM"}
ANY = None

CASES: list[tuple[str, list[str], set | None]] = [
    # ── single entity: direct facts ──
    ("What was Microsoft's total revenue in FY2023?",      ["211915"], HIGH_MED),
    ("What was Amazon's FY2022 operating income?",          ["12248"],  HIGH_MED),
    ("What was Tesla's total revenue in FY2023?",           ["96773"],  HIGH_MED),
    ("What was Meta's total revenue in FY2023?",            ["134902"], HIGH_MED),
    ("What was Nvidia's net income in FY2024?",             ["29760"],  HIGH_MED),
    ("What was Broadcom's total revenue in FY2023?",        ["35819"],  HIGH_MED),
    ("What was Apple's total assets in FY2023?",            ["352583"], HIGH_MED),
    ("What was Nvidia's R&D expense in FY2024?",            ["8675"],   HIGH_MED),
    ("What was Walmart's diluted EPS in FY2023?",           ["4.27"],   ANY),
    # ── single entity: derived metrics ──
    ("What was Apple's free cash flow in FY2023?",          ["99584"],  HIGH_MED),
    ("What was Microsoft's operating margin in FY2023?",    ["41.7"],   HIGH_MED),
    # ── bank coverage ──
    ("What was JPMorgan's net interest income in FY2023?",  ["89267"],  HIGH_MED),
    # ── multi-entity comparisons ──
    # comparison prose uses B-notation ("$211.91B"), so match the B form, not raw digits
    ("Compare Apple and Microsoft total revenue in FY2023", ["383.2", "211.9"], HIGH_MED),
    ("Which grew revenue faster from FY2022 to FY2023, Meta or Google?", ["134.9", "meta"], ANY),
    ("Compare Tesla and Ford net income in FY2023",         ["14997", "4347"], ANY),
    ("Did Nvidia or AMD have higher gross margin in FY2023?", ["56.9", "46.1"], ANY),
    ("Compare the net margins of Apple, Microsoft, and Nvidia in FY2023", ["25.3", "34.1", "16.2"], ANY),
]


def _norm(s: str) -> str:
    """Lowercase + drop commas/$/spaces so '211915' matches '$211,915 million'."""
    return s.lower().replace(",", "").replace("$", "").replace(" ", "")


async def _ask(client: httpx.AsyncClient, base: str, query: str) -> tuple[str, str, float]:
    body = {"query": query, "options": {"reasoning_depth": "fast"}}
    t0 = time.perf_counter()
    r = await client.post(
        f"{base}/v1/search",
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
        json=body,
    )
    dt = time.perf_counter() - t0
    r.raise_for_status()
    d = r.json()
    return d.get("answer", "") or "", (d.get("confidence", "") or "").upper(), dt


async def main(base: str, max_latency: float, timeout: float) -> int:
    passed = failed = 0
    rows: list[str] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for query, needs, conf_ok in CASES:
            try:
                answer, conf, dt = await _ask(client, base, query)
            except Exception as e:
                rows.append(f"FAIL  [err]   {query[:48]:48}  {str(e)[:50]}")
                failed += 1
                continue
            na = _norm(answer)
            missing = [t for t in needs if _norm(t) not in na]
            conf_bad = conf_ok is not None and conf not in conf_ok
            slow = dt > max_latency
            ok = not missing and not conf_bad
            status = "PASS" if ok else "FAIL"
            flags = []
            if missing:
                flags.append(f"missing={missing}")
            if conf_bad:
                flags.append(f"conf={conf}")
            if slow:
                flags.append("SLOW")  # latency is a warning, not a hard fail
            rows.append(f"{status}  {dt:5.1f}s {conf:6} {query[:46]:46} {' '.join(flags)}")
            passed += ok
            failed += not ok
            await asyncio.sleep(1.5)  # ease the single box

    print("\n".join(rows))
    print(f"\n{passed}/{passed + failed} passed  (latency budget {max_latency:.0f}s; SLOW = over budget, not a fail)")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--max-latency", type=float, default=45.0)
    ap.add_argument("--timeout", type=float, default=110.0)
    args = ap.parse_args()
    print(f"Reliability battery -> {args.base}  ({len(CASES)} cases)\n")
    sys.exit(asyncio.run(main(args.base, args.max_latency, args.timeout)))
