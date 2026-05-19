"""
Gravity Search — PostgreSQL pool (asyncpg).

On Linux/Fly: creates a real asyncpg pool from DATABASE_URL.
Windows dev: returns None everywhere to avoid asyncpg deadlock with uvicorn.
"""
import os
import platform
import structlog

logger = structlog.get_logger()

# SQLAlchemy ORM stubs (not used by auth_store — kept for compatibility)
engine = None
async_session = None

_pool = None  # asyncpg pool, set during lifespan startup

_IS_WINDOWS = platform.system() == "Windows"


async def init_pool() -> None:
    """Create asyncpg pool from DATABASE_URL. Call once during lifespan startup."""
    global _pool
    if _IS_WINDOWS:
        logger.info("postgres_mock_active", msg="asyncpg skipped on Windows")
        return
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        logger.warning("postgres_no_url", msg="DATABASE_URL not set — using in-memory store")
        return
    try:
        import asyncpg  # type: ignore
        # Fly attaches with sslmode=disable (internal Flycast network — no TLS needed).
        # asyncpg uses ssl= kwarg, not query param, so strip the param and pass ssl=False.
        no_ssl = "sslmode=disable" in db_url
        dsn = db_url.replace("?sslmode=disable", "").replace("&sslmode=disable", "")
        _pool = await asyncpg.create_pool(
            dsn, min_size=1, max_size=5, command_timeout=30,
            ssl=False if no_ssl else None,
        )
        logger.info("postgres_pool_ready", dsn=dsn[:40] + "...")
    except Exception as e:
        logger.warning("postgres_pool_failed", error=str(e))


def get_db_pool():
    return _pool


async def get_db():
    yield None


async def create_all_tables():
    if _IS_WINDOWS:
        logger.info("postgres_mock_active", msg="SQLAlchemy async skipped on Windows due to deadlock")


async def init_timescaledb():
    pass
