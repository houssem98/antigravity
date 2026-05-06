"""
Gravity Search — PostgreSQL + TimescaleDB (Mock for Windows Fix)
"""
import structlog
logger = structlog.get_logger()

# Dummy objects to satisfy imports
engine = None
async_session = None

async def get_db():
    yield None

async def init_timescaledb():
    pass

async def create_all_tables():
    logger.info("postgres_mock_active", msg="SQLAlchemy async skipped on Windows due to deadlock")

def get_db_pool():
    return None

