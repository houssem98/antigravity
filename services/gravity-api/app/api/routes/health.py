"""
Gravity Search — Health & Readiness Routes
Real dependency checks on all downstream services.
"""

import asyncio
import time

import structlog
from fastapi import APIRouter

from app.config import settings
from app.db.qdrant import qdrant_client
from app.db.elasticsearch import es_client
from app.db.neo4j import neo4j_driver
from app.db.redis import redis_client

logger = structlog.get_logger()
router = APIRouter()


async def _check_redis() -> dict:
    t = time.perf_counter()
    try:
        await redis_client.ping()
        return {"status": "ok", "latency_ms": round((time.perf_counter() - t) * 1000, 1)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_elasticsearch() -> dict:
    t = time.perf_counter()
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=5) as _client:
            resp = await _client.get("http://localhost:9200/_cluster/health")
            info = resp.json()
        return {
            "status": "ok" if info.get("status") in ("green", "yellow") else "degraded",
            "cluster_status": info.get("status", "unknown"),
            "latency_ms": round((time.perf_counter() - t) * 1000, 1),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_qdrant() -> dict:
    t = time.perf_counter()
    try:
        collections = await qdrant_client.get_collections()
        return {
            "status": "ok",
            "collections": len(collections.collections),
            "latency_ms": round((time.perf_counter() - t) * 1000, 1),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_neo4j() -> dict:
    t = time.perf_counter()
    try:
        with neo4j_driver.session() as session:
            session.run("RETURN 1")
        return {"status": "ok", "latency_ms": round((time.perf_counter() - t) * 1000, 1)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/health")
async def health():
    """Liveness probe — always returns 200 if the process is alive."""
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "env": settings.app_env,
    }


@router.get("/status")
async def status_page():
    """
    Public status page (A8). Component-level health for status pages and
    monitoring. Returns 200 always; status is in the body so probes don't
    auto-trip on degraded subsystems.

    Recommended polling: Statuspage / Better Uptime / UptimeRobot every 60s.
    Caches for 30s on the response.
    """
    start = time.perf_counter()
    redis_s, es_s, qdrant_s, neo4j_s = await asyncio.gather(
        _check_redis(), _check_elasticsearch(), _check_qdrant(), _check_neo4j(),
        return_exceptions=True,
    )

    def _safe(r):
        if isinstance(r, Exception):
            return {"status": "error", "error": str(r)}
        return r

    components = {
        "redis":          _safe(redis_s),
        "elasticsearch":  _safe(es_s),
        "qdrant":         _safe(qdrant_s),
        "neo4j":          _safe(neo4j_s),
    }
    overall = "operational"
    if any(v.get("status") == "error" for v in components.values()):
        overall = "major_outage"
    elif any(v.get("status") == "degraded" for v in components.values()):
        overall = "degraded"

    from fastapi.responses import JSONResponse
    body = {
        "status": overall,
        "service": settings.app_name,
        "version": settings.app_version,
        "components": components,
        "checked_at": time.time(),
        "duration_ms": round((time.perf_counter() - start) * 1000, 1),
    }
    return JSONResponse(content=body, status_code=200,
                        headers={"Cache-Control": "public, max-age=30"})


@router.get("/_internal/sentry-ping")
async def sentry_ping():
    """Trigger a captured exception in Sentry — verify alerts wired."""
    import os
    if not os.getenv("SENTRY_DSN"):
        return {"status": "skipped", "reason": "no SENTRY_DSN"}
    try:
        import sentry_sdk
        sentry_sdk.capture_message(
            "gravity_api_sentry_ping (health check)", level="info",
        )
        return {"status": "sent"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@router.get("/ready")
async def readiness():
    """
    Readiness probe — checks all critical downstream dependencies.
    Returns 200 only when all services are reachable.
    Returns 503 if any critical service is down.
    """
    start = time.perf_counter()

    # Run all checks in parallel
    redis_status, es_status, qdrant_status, neo4j_status = await asyncio.gather(
        _check_redis(),
        _check_elasticsearch(),
        _check_qdrant(),
        _check_neo4j(),
        return_exceptions=True,
    )

    def _safe(result) -> dict:
        if isinstance(result, Exception):
            return {"status": "error", "error": str(result)}
        return result

    checks = {
        "redis":         _safe(redis_status),
        "elasticsearch": _safe(es_status),
        "qdrant":        _safe(qdrant_status),
        "neo4j":         _safe(neo4j_status),
    }

    all_ok = all(v.get("status") in ("ok", "degraded") for v in checks.values())
    total_ms = round((time.perf_counter() - start) * 1000, 1)

    from fastapi.responses import JSONResponse
    body = {
        "status": "ready" if all_ok else "not_ready",
        "checks": checks,
        "total_ms": total_ms,
    }
    return JSONResponse(content=body, status_code=200 if all_ok else 503)
