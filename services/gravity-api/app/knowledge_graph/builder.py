"""
Gravity Search — Knowledge Graph Builder
High-level orchestrator: takes processed document metadata + extracted entities
and builds/updates the Nexus Knowledge Graph in Neo4j.

All operations are idempotent (MERGE, not CREATE).
Safe to run multiple times for the same document.
"""

import structlog

from app.db.neo4j import neo4j_driver
from app.knowledge_graph.queries import (
    UPSERT_COMPANY, UPSERT_FILING, UPSERT_PERSON, UPSERT_THEME,
    UPSERT_FINANCIAL_METRIC, UPSERT_ANALYST,
    LINK_PERSON_TO_COMPANY, LINK_THEME_TO_FILING,
    LINK_METRIC_TO_COMPANY, LINK_METRIC_TO_FILING,
    LINK_ANALYST_TO_COMPANY,
)

logger = structlog.get_logger()


class KnowledgeGraphBuilder:
    """
    Builds/updates the Knowledge Graph from processed documents.

    Usage:
        builder = KnowledgeGraphBuilder()
        counts = await builder.build_from_document(document_id, metadata, entities)
    """

    def __init__(self):
        self.driver = neo4j_driver

    async def build_from_document(
        self,
        document_id: str,
        metadata: dict,
        entities: dict,
    ) -> dict:
        """
        Main entry point. Builds all nodes and relationships for one document.

        Args:
            document_id: UUID of the processed document
            metadata: Dict with keys: ticker, company_name, filing_type,
                      filing_date, fiscal_year, fiscal_quarter, source_url
            entities: Dict from EntityExtractor with keys:
                      companies, people, metrics, events, dates, themes

        Returns:
            Counts of created/updated nodes per type.
        """
        counts = {"companies": 0, "filings": 0, "people": 0, "themes": 0, "metrics": 0, "analysts": 0}

        ticker = metadata.get("ticker", "")
        company_name = metadata.get("company_name", "")
        filing_type = metadata.get("filing_type", "")
        filing_date = metadata.get("filing_date", "") or "2000-01-01"
        fiscal_year = metadata.get("fiscal_year", "")
        fiscal_quarter = metadata.get("fiscal_quarter", "")
        source_url = metadata.get("source_url", "")

        try:
            with self.driver.session() as session:
                # ── 1. Upsert the Company node ──────────────────────────
                if ticker:
                    session.run(UPSERT_COMPANY, {
                        "ticker": ticker,
                        "name": company_name,
                        "sector": metadata.get("sector"),
                        "industry": metadata.get("industry"),
                        "country": metadata.get("country"),
                        "market_cap": metadata.get("market_cap"),
                    })
                    counts["companies"] += 1

                # ── 2. Upsert the Filing node and link to Company ───────
                session.run(UPSERT_FILING, {
                    "filing_id": document_id,
                    "title": f"{ticker} {filing_type} {filing_date}",
                    "filing_type": filing_type,
                    "filing_date": filing_date,
                    "fiscal_year": fiscal_year,
                    "fiscal_quarter": fiscal_quarter,
                    "source_url": source_url,
                    "ticker": ticker,
                })
                counts["filings"] += 1

                # ── 3. Upsert extracted people and link to company ──────
                for person in entities.get("people", []):
                    name = person.get("name", "").strip()
                    if not name or len(name) < 2:
                        continue
                    session.run(UPSERT_PERSON, {
                        "name": name,
                        "title": person.get("title", "Executive"),
                    })
                    if ticker:
                        session.run(LINK_PERSON_TO_COMPANY, {
                            "person_name": name,
                            "ticker": ticker,
                            "title": person.get("title", "Executive"),
                        })
                    counts["people"] += 1

                # ── 4. Upsert themes and link to filing ─────────────────
                for theme in entities.get("themes", []):
                    if not theme or not isinstance(theme, str):
                        continue
                    theme = theme.strip().lower()
                    if len(theme) < 3:
                        continue
                    session.run(UPSERT_THEME, {"theme": theme})
                    session.run(LINK_THEME_TO_FILING, {
                        "theme": theme,
                        "filing_id": document_id,
                    })
                    counts["themes"] += 1

                # ── 5. Upsert financial metrics and link to company + filing
                for metric in entities.get("metrics", [])[:30]:
                    m_name = metric.get("metric", "") or metric.get("name", "")
                    m_value = metric.get("value")
                    if not m_name or m_value is None:
                        continue
                    period = metric.get("period", fiscal_quarter or fiscal_year or "")
                    metric_id = f"{ticker}_{m_name}_{period}".replace(" ", "_").lower()

                    session.run(UPSERT_FINANCIAL_METRIC, {
                        "metric_id": metric_id,
                        "metric": m_name,
                        "value": float(m_value),
                        "currency": metric.get("currency", "USD"),
                        "unit": metric.get("unit"),
                        "period": period,
                    })
                    if ticker:
                        session.run(LINK_METRIC_TO_COMPANY, {
                            "metric_id": metric_id,
                            "ticker": ticker,
                        })
                    session.run(LINK_METRIC_TO_FILING, {
                        "metric_id": metric_id,
                        "filing_id": document_id,
                    })
                    counts["metrics"] += 1

                # ── 6. Upsert analysts and link to company ──────────────
                for analyst in entities.get("analysts", [])[:10]:
                    a_name = analyst.get("name", "").strip()
                    a_firm = analyst.get("firm", "").strip()
                    if not a_name or not a_firm:
                        continue
                    session.run(UPSERT_ANALYST, {
                        "name": a_name,
                        "firm": a_firm,
                    })
                    if ticker:
                        session.run(LINK_ANALYST_TO_COMPANY, {
                            "name": a_name,
                            "firm": a_firm,
                            "ticker": ticker,
                        })
                    counts["analysts"] += 1

        except Exception as e:
            logger.error(
                "knowledge_graph_build_failed",
                document_id=document_id,
                ticker=ticker,
                error=str(e),
            )
            # Don't re-raise — graph build failure should not block indexing

        logger.info(
            "knowledge_graph_built",
            document_id=document_id,
            ticker=ticker,
            **counts,
        )
        return counts

