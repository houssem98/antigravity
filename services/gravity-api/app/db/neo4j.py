"""
Gravity Search — Neo4j Knowledge Graph Driver

Real Neo4j connection with graceful fallback for development.
When Neo4j is unavailable, logs a warning and returns a mock driver
so the app can still start without Docker running.
"""

import structlog
from neo4j import GraphDatabase
from app.config import settings

logger = structlog.get_logger()


# ── Mock fallback (used when Neo4j is unreachable) ───────────────────────────

class _MockResult:
    """Mimics a Neo4j Result that yields nothing."""
    def single(self):
        return None
    def data(self):
        return []
    def __iter__(self):
        return iter([])


class _MockSession:
    """Mimics a Neo4j Session that returns empty results."""
    def __enter__(self):
        return self
    def __exit__(self, *_):
        pass
    def run(self, *args, **kwargs):
        return _MockResult()
    def close(self):
        pass


class _MockDriver:
    """Mimics a Neo4j Driver that always returns a mock session."""
    def session(self, **kwargs):
        return _MockSession()
    def close(self):
        pass
    def verify_connectivity(self):
        raise ConnectionError("Neo4j mock — no real connection")


# ── Real driver initialization ───────────────────────────────────────────────

class Neo4jConnection:
    """
    Lazy Neo4j connection wrapper.

    On first call to .driver, attempts to connect to Neo4j.
    Falls back to a mock if Neo4j is unreachable (dev-friendly).
    """

    def __init__(self):
        self._driver = None
        self._is_mock = False

    @property
    def driver(self):
        if self._driver is None:
            self._connect()
        return self._driver

    def _connect(self):
        """Attempt real connection to Neo4j, fall back to mock."""
        try:
            real_driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password),
                max_connection_lifetime=300,
                connection_timeout=5,
            )
            real_driver.verify_connectivity()
            self._driver = real_driver
            self._is_mock = False
            logger.info(
                "neo4j_connected",
                uri=settings.neo4j_uri,
                user=settings.neo4j_user,
            )
        except Exception as e:
            logger.warning(
                "neo4j_unavailable_using_mock",
                uri=settings.neo4j_uri,
                error=str(e),
            )
            self._driver = _MockDriver()
            self._is_mock = True

    @property
    def is_connected(self) -> bool:
        """True if using a real Neo4j driver (not mock)."""
        if self._driver is None:
            self._connect()
        return not self._is_mock

    def session(self, **kwargs):
        """Create a Neo4j session (or mock session)."""
        return self.driver.session(**kwargs)

    def close(self):
        """Close the driver connection."""
        if self._driver:
            self._driver.close()
            self._driver = None


# ── Module-level singleton ───────────────────────────────────────────────────

neo4j_driver = Neo4jConnection()


def get_neo4j_driver() -> Neo4jConnection:
    """Factory for dependency injection."""
    return neo4j_driver


# ── Schema constraints ──────────────────────────────────────────────────────

async def ensure_constraints():
    """
    Create uniqueness constraints and indexes in Neo4j.
    Uses CREATE ... IF NOT EXISTS — idempotent, safe to run on every startup.
    """
    if not neo4j_driver.is_connected:
        logger.info("neo4j_constraints_skipped", reason="not connected")
        return

    constraints = [
        # Uniqueness constraints
        "CREATE CONSTRAINT company_ticker IF NOT EXISTS FOR (c:Company) REQUIRE c.ticker IS UNIQUE",
        "CREATE CONSTRAINT filing_id IF NOT EXISTS FOR (f:Filing) REQUIRE f.id IS UNIQUE",
        "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE",
        "CREATE CONSTRAINT theme_name IF NOT EXISTS FOR (t:Theme) REQUIRE t.name IS UNIQUE",
        "CREATE CONSTRAINT metric_id IF NOT EXISTS FOR (m:FinancialMetric) REQUIRE m.id IS UNIQUE",
        # Full-text indexes for search
        "CREATE FULLTEXT INDEX company_name_ft IF NOT EXISTS FOR (c:Company) ON EACH [c.name, c.ticker]",
        "CREATE FULLTEXT INDEX person_name_ft IF NOT EXISTS FOR (p:Person) ON EACH [p.name]",
        "CREATE FULLTEXT INDEX theme_name_ft IF NOT EXISTS FOR (t:Theme) ON EACH [t.name]",
    ]

    try:
        with neo4j_driver.session() as session:
            for cypher in constraints:
                try:
                    session.run(cypher)
                except Exception as e:
                    # Some constraints may already exist or not be supported
                    logger.debug("neo4j_constraint_skip", query=cypher[:60], error=str(e))

        logger.info("neo4j_constraints_created", count=len(constraints))
    except Exception as e:
        logger.error("neo4j_constraints_failed", error=str(e))
