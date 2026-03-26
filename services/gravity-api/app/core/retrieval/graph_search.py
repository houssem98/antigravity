"""
Gravity Search — Knowledge Graph Search via Neo4j (Channel 4)
For entity-relationship queries like "Who are TSMC's top customers?"
Graph results are converted to document references and merged into the retrieval pool.
"""

import asyncio
import functools
import structlog
from app.db.neo4j import neo4j_driver
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


# Pre-defined Cypher query templates
CYPHER_TEMPLATES = {
    "company_filings": """
        MATCH (c:Company {ticker: $ticker})-[:FILED]->(f:Filing)
        RETURN f.id AS id, f.title AS title, f.filing_type AS type, f.filing_date AS date
        ORDER BY f.filing_date DESC LIMIT $limit
    """,
    "company_relationships": """
        MATCH (c:Company {ticker: $ticker})-[r]->(target)
        RETURN type(r) AS relationship, labels(target) AS target_type,
               target.name AS target_name, target.ticker AS target_ticker
        LIMIT $limit
    """,
    "supply_chain": """
        MATCH (c:Company {ticker: $ticker})-[:SUPPLIES_TO|SUPPLIED_BY*1..2]-(related:Company)
        RETURN DISTINCT related.name AS name, related.ticker AS ticker, related.sector AS sector
        LIMIT $limit
    """,
    "executive_info": """
        MATCH (p:Person)-[:CEO_OF|CFO_OF|BOARD_MEMBER_OF]->(c:Company {ticker: $ticker})
        RETURN p.name AS name, p.title AS title, type(r) AS role
    """,
    "theme_mentions": """
        MATCH (t:Theme {name: $theme})-[:MENTIONED_IN]->(f:Filing)-[:FILED_BY]->(c:Company)
        RETURN c.name AS company, c.ticker AS ticker, f.filing_type AS type,
               f.filing_date AS date, f.id AS filing_id
        ORDER BY f.filing_date DESC LIMIT $limit
    """,
}


class GraphSearch:
    """Knowledge graph traversal via Neo4j Cypher queries."""

    async def search(
        self,
        query: str,
        entities: dict | None = None,
        top_k: int = 20,
    ) -> list[RetrievalResult]:
        """Execute relevant graph queries based on extracted entities."""
        if not entities:
            return []

        results = []

        # Company-based queries
        companies = entities.get("companies", [])
        for company in companies:
            ticker = company.get("ticker", "")
            if not ticker:
                continue

            # Get related filings
            filings = await self._run_query(
                CYPHER_TEMPLATES["company_filings"],
                {"ticker": ticker, "limit": top_k},
            )
            for f in filings:
                results.append(RetrievalResult(
                    chunk_id=f.get("id", ""),
                    document_id=f.get("id", ""),
                    text=f"Filing: {f.get('title', '')} ({f.get('type', '')}) - {f.get('date', '')}",
                    score=0.5,
                    ticker=ticker,
                    document_title=f.get("title", ""),
                    filing_date=str(f.get("date", "")),
                ))

            # Get relationships (supply chain, competitors)
            rels = await self._run_query(
                CYPHER_TEMPLATES["company_relationships"],
                {"ticker": ticker, "limit": top_k},
            )
            for r in rels:
                results.append(RetrievalResult(
                    chunk_id=f"graph_{ticker}_{r.get('target_ticker', '')}",
                    document_id="",
                    text=f"{ticker} {r.get('relationship', '')} {r.get('target_name', '')} ({r.get('target_ticker', '')})",
                    score=0.3,
                    ticker=ticker,
                ))

        # Theme-based queries
        themes = entities.get("themes", [])
        for theme in themes:
            mentions = await self._run_query(
                CYPHER_TEMPLATES["theme_mentions"],
                {"theme": theme, "limit": top_k},
            )
            for m in mentions:
                results.append(RetrievalResult(
                    chunk_id=m.get("filing_id", ""),
                    document_id=m.get("filing_id", ""),
                    text=f"{m.get('company', '')} ({m.get('ticker', '')}) mentioned '{theme}' in {m.get('type', '')} ({m.get('date', '')})",
                    score=0.4,
                    ticker=m.get("ticker", ""),
                    filing_date=str(m.get("date", "")),
                ))

        logger.info("graph_search", results=len(results))
        return results

    async def _run_query(self, cypher: str, params: dict) -> list[dict]:
        """Execute a Cypher query non-blockingly via a thread-pool executor."""
        loop = asyncio.get_event_loop()
        fn = functools.partial(self._run_query_sync, cypher, params)
        return await loop.run_in_executor(None, fn)

    def _run_query_sync(self, cypher: str, params: dict) -> list[dict]:
        """Synchronous Cypher execution (called from executor thread)."""
        try:
            with neo4j_driver.session() as session:
                result = session.run(cypher, params)
                return [dict(record) for record in result]
        except Exception as e:
            logger.warning("graph_query_failed", error=str(e))
            return []
