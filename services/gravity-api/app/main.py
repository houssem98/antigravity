"""
Gravity Search — FastAPI Application Entry Point
"""

import asyncio
import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.config import settings
from app.api.routes import search, documents, entities, health, usage, workspaces, feedback
from app.api.routes import grid_search, analytics
from app.db.qdrant import qdrant_client
from app.db.elasticsearch import es_client
from app.db.neo4j import neo4j_driver
from app.db.postgres import engine as pg_engine, create_all_tables
from app.db.redis import redis_client

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("Starting Gravity Search", version=settings.app_version, env=settings.app_env)

    # Startup: create tables + enable TimescaleDB hypertable (non-fatal if DB unavailable)
    try:
        await asyncio.wait_for(create_all_tables(), timeout=5.0)
    except Exception as e:
        logger.warning("postgres_startup_skipped", error=str(e))

    # Startup: verify all connections
    await _verify_connections()

    # Pre-warm embedder + pipeline so the first real query doesn't time out
    try:
        from app.dependencies import get_search_pipeline, get_embedder
        get_embedder()  # initialise embedder (loads model into RAM)
        get_search_pipeline()  # wire full pipeline
        # Send one dummy embed to force model weight loading into memory
        embedder = get_embedder()
        await embedder.embed_query("warm up")
        logger.info("pipeline_warmed_up")
    except Exception as _e:
        logger.warning("pipeline_warmup_failed", error=str(_e))

    # Start hourly routing-override recomputation task
    _override_task = asyncio.create_task(_hourly_routing_recompute())

    yield

    _override_task.cancel()

    # Shutdown: close connections
    logger.info("Shutting down Gravity Search")
    try:
        from app.ingestion.kafka_client import close_producer
        await close_producer()
    except Exception:
        pass
    try:
        await redis_client.close()
    except Exception:
        pass
    try:
        neo4j_driver.close()
    except Exception:
        pass
    try:
        await es_client.close()
    except Exception:
        pass
    if pg_engine is not None:
        await pg_engine.dispose()


async def _hourly_routing_recompute():
    """Background task: recompute routing overrides every hour."""
    while True:
        await asyncio.sleep(3600)
        try:
            from app.dependencies import get_feedback_loop
            loop = get_feedback_loop()
            if loop:
                overrides = await loop.recompute_overrides()
                if overrides:
                    logger.info("routing_overrides_recomputed", count=len(overrides))
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("hourly_recompute_failed", error=str(e))


async def _verify_connections():
    """Verify all external services are reachable (concurrent, 3s hard timeout each)."""
    checks = {}

    async def _check_redis():
        try:
            await asyncio.wait_for(redis_client.ping(), timeout=3.0)
            checks["redis"] = "ok"
        except Exception as e:
            checks["redis"] = f"unavailable: {type(e).__name__}"

    async def _check_es():
        try:
            await asyncio.wait_for(es_client.info(request_timeout=2), timeout=3.0)
            checks["elasticsearch"] = "ok"
        except Exception as e:
            checks["elasticsearch"] = f"unavailable: {type(e).__name__}"

    async def _check_qdrant():
        try:
            await asyncio.wait_for(qdrant_client.get_collections(), timeout=3.0)
            checks["qdrant"] = "ok"
        except Exception as e:
            checks["qdrant"] = f"unavailable: {type(e).__name__}"

    await asyncio.gather(_check_redis(), _check_es(), _check_qdrant())
    logger.info("Connection checks", **checks)


# ── Create App ──────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
)

# ── Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_trace_id_and_timing(request: Request, call_next):
    """Add trace ID and request timing to every request."""
    import uuid

    trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4()))
    request.state.trace_id = trace_id
    start = time.perf_counter()

    response = await call_next(request)

    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Trace-ID"] = trace_id
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"

    logger.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        latency_ms=round(elapsed_ms, 1),
        trace_id=trace_id,
    )
    return response


# ── Routes ──────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["Health"])
app.include_router(search.router, prefix="/v1", tags=["Search"])
app.include_router(documents.router, prefix="/v1", tags=["Documents"])
app.include_router(entities.router, prefix="/v1", tags=["Entities"])
app.include_router(usage.router, prefix="/v1", tags=["Usage"])
app.include_router(workspaces.router, prefix="/v1", tags=["Workspaces"])
app.include_router(feedback.router, tags=["Feedback"])
app.include_router(grid_search.router, tags=["Grid"])
app.include_router(analytics.router, tags=["Analytics"])


# ── Prometheus-compatible /metrics endpoint ──────────────────────────────
@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics():
    """
    Basic Prometheus-compatible metrics endpoint.
    Scraped by market-server health poller and any monitoring stack.
    """
    from fastapi.responses import PlainTextResponse
    import gc

    # Basic process stats
    try:
        import psutil, os
        proc = psutil.Process(os.getpid())
        mem_bytes = proc.memory_info().rss
        cpu_pct = proc.cpu_percent(interval=None)
    except ImportError:
        mem_bytes = 0
        cpu_pct = 0.0

    lines = [
        "# HELP gravity_up Service is up (1) or down (0)",
        "# TYPE gravity_up gauge",
        "gravity_up 1",
        "",
        "# HELP gravity_memory_bytes Resident set size in bytes",
        "# TYPE gravity_memory_bytes gauge",
        f"gravity_memory_bytes {mem_bytes}",
        "",
        "# HELP gravity_cpu_percent CPU usage percent",
        "# TYPE gravity_cpu_percent gauge",
        f"gravity_cpu_percent {cpu_pct}",
        "",
        "# HELP python_gc_objects_collected_total Objects collected by GC",
        "# TYPE python_gc_objects_collected_total counter",
        f"python_gc_objects_collected_total {sum(gc.get_count())}",
    ]
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
