"""
Backfill the Supabase `financials` table with SEC XBRL exact facts.

Proven (FinanceBench): 90% of numeric questions have their gold answer in us-gaap
tagged facts, vs 13.5% from prod dense retrieval. This populates the structured
exact-facts channel with CLEAN tagged values (not the noisy table-scrape that
regressed accuracy 40->20). Source: app/ingestion/sources/sec_xbrl.py.

Run ON FLY (has SUPABASE_SERVICE_ROLE_KEY; SEC is public):
  fly ssh console -a gravity-api-prod -C "python scripts/backfill_xbrl_financials.py --sp500"
  fly ssh console -a gravity-api-prod -C "python scripts/backfill_xbrl_financials.py --tickers AAPL,MSFT,KO --years 5"

Idempotent: upsert by deterministic id. Re-enable the channel afterward with
STRUCTURED_FACTS_ENABLED=true once verified.
"""

import argparse
import asyncio
import sys
from datetime import datetime

from app.ingestion.sources.sec_xbrl import SECXBRLClient, CORE_CONCEPTS
from app.db import supabase_rest


def _rows_for(ticker: str, company: str, facts: dict, years: list[int]) -> list[dict]:
    rows = SECXBRLClient.extract_facts(facts, years, CORE_CONCEPTS)
    out = []
    for r in rows:
        val = r.get("value")
        try:
            vf = float(val)
        except (TypeError, ValueError):
            continue
        period = f"FY{r['fy']}"
        out.append({
            "id": f"{ticker}_{r['concept']}_{period}_xbrl"[:200],
            "ticker": ticker.upper(),
            "company": company,
            "filing_type": r.get("form", "XBRL") or "XBRL",
            "filing_date": r.get("end", "") or None,
            "document_id": f"xbrl:{ticker.upper()}",
            "metric_name": r.get("label", r["concept"]),
            "period": period,
            "value_raw": str(val),
            "value_float": vf,
            "unit": r.get("unit", "USD"),
            "source_section": "xbrl_companyfacts",
            "caption": r["concept"],
        })
    # dedupe by id within this company (avoid PG 21000 on-conflict dup-in-batch)
    return list({r["id"]: r for r in out}.values())


async def backfill(tickers: list[str], years_back: int) -> int:
    if not supabase_rest.configured():
        print("SUPABASE not configured"); return 0
    sec = SECXBRLClient()
    this_fy = datetime.utcnow().year
    years = list(range(this_fy - years_back, this_fy + 1))

    total = 0
    for i, tk in enumerate(tickers):
        try:
            cik = await sec.resolve_cik(ticker=tk, company=tk)
            if not cik:
                print(f"  [{i+1}/{len(tickers)}] {tk}: no CIK"); continue
            facts = await sec.get_company_facts(cik)
            company = facts.get("entityName", tk)
            rows = _rows_for(tk, company, facts, years)
            if not rows:
                print(f"  [{i+1}/{len(tickers)}] {tk}: 0 rows"); continue
            n = 0
            for j in range(0, len(rows), 500):
                n += await supabase_rest.sb_insert("financials", rows[j:j+500], on_conflict="id")
            total += n
            print(f"  [{i+1}/{len(tickers)}] {tk} (CIK {cik}): {n} facts", flush=True)
        except Exception as e:
            print(f"  [{i+1}/{len(tickers)}] {tk}: ERR {str(e)[:100]}", flush=True)
        await asyncio.sleep(0.2)  # be gentle to SEC
    print(f"DONE total facts written: {total}")
    return total


def _sp500() -> list[str]:
    try:
        import httpx
        r = httpx.get("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
                      timeout=30, follow_redirects=True)
        lines = r.text.strip().splitlines()[1:]
        return [ln.split(",")[0].strip() for ln in lines if ln]
    except Exception as e:
        print("sp500 fetch failed:", e); return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", type=str, default="", help="comma-separated tickers")
    ap.add_argument("--sp500", action="store_true", help="backfill the full S&P 500")
    ap.add_argument("--years", type=int, default=5, help="fiscal years back to include")
    args = ap.parse_args()

    if args.sp500:
        tickers = _sp500()
    else:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    if not tickers:
        print("no tickers (use --tickers or --sp500)"); sys.exit(1)

    print(f"XBRL backfill: {len(tickers)} tickers, {args.years}y back")
    asyncio.run(backfill(tickers, args.years))


if __name__ == "__main__":
    main()
