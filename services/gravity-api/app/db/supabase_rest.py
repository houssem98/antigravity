"""
Supabase PostgREST helper — table read/write over HTTP with the service-role key.

Lets the backend use Supabase Postgres (a managed DB we already run) without a
direct asyncpg connection (the SQLAlchemy session is a None stub on this deploy,
and we don't hold the Supabase DB password). PostgREST + the service-role key is
enough for the financials exact-facts table: insert during backfill, exact filter
at query time.
"""

import os

import httpx
import structlog

logger = structlog.get_logger()


def _cfg() -> tuple[str, str]:
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def configured() -> bool:
    url, key = _cfg()
    return bool(url and key)


def _headers(key: str, extra: dict | None = None) -> dict:
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


async def sb_insert(table: str, rows: list[dict], on_conflict: str | None = None) -> int:
    """Insert/upsert rows. Returns count attempted (0 on failure / not configured)."""
    url, key = _cfg()
    if not url or not key or not rows:
        return 0
    params: dict = {}
    prefer = "return=minimal"
    if on_conflict:
        params["on_conflict"] = on_conflict
        prefer = "resolution=merge-duplicates,return=minimal"
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                f"{url}/rest/v1/{table}",
                headers=_headers(key, {"Prefer": prefer}),
                params=params,
                json=rows,
            )
        if r.status_code >= 300:
            logger.warning("sb_insert_failed", table=table, status=r.status_code, body=r.text[:200])
            return 0
        return len(rows)
    except Exception as e:
        logger.warning("sb_insert_error", table=table, error=str(e)[:160])
        return 0


async def sb_select(table: str, filters: dict, select: str = "*", limit: int = 10) -> list[dict]:
    """GET rows with PostgREST filters, e.g. {'ticker': 'eq.AAPL', 'metric_name': 'ilike.*revenue*'}."""
    url, key = _cfg()
    if not url or not key:
        return []
    params = dict(filters)
    params["select"] = select
    params["limit"] = str(limit)
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(f"{url}/rest/v1/{table}", headers=_headers(key), params=params)
        if r.status_code >= 300:
            logger.warning("sb_select_failed", table=table, status=r.status_code, body=r.text[:200])
            return []
        return r.json()
    except Exception as e:
        logger.warning("sb_select_error", table=table, error=str(e)[:160])
        return []
