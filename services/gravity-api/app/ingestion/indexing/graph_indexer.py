"""
Gravity Search — Graph Indexer (Neo4j)
Creates/updates Knowledge Graph nodes and relationships for indexed documents.
Uses MERGE for idempotency — safe to re-run for the same document.
"""

import structlog

from app.db.neo4j import neo4j_driver
from app.knowledge_graph.queries import (
    UPSERT_COMPANY, UPSERT_FILING, UPSERT_PERSON, UPSERT_THEME,
    LINK_PERSON_TO_COMPANY, LINK_THEME_TO_FILING,
    UPSERT_FINANCIAL_METRIC, LINK_METRIC_TO_COMPANY, LINK_METRIC_TO_FILING,
)

logger = structlog.get_logger()


class GraphIndexer:
    """
    Creates/updates Neo4j Knowledge Graph nodes from processed documents.

    Called by the ingestion pipeline after chunking and before vector indexing.
    All operations use MERGE — idempotent and safe to re-run.
    """

    def __init__(self, driver=None):
        self.driver = driver or neo4j_driver

    def index_document(
        self,
        document_id: str,
        metadata,
        entities: dict,
    ) -> dict:
        """
        Create/update graph nodes for a document.

        Args:
            document_id: UUID of the document
            metadata: From MetadataExtractor (ticker, company_name, filing_type, ...)
            entities: From EntityExtractor (companies, people, themes, ...)

        Returns:
            Node counts: {companies, filings, people, themes}
        """
        counts = {"companies": 0, "filings": 0, "people": 0, "themes": 0}

        # Accept both dict and DocumentMetadata dataclass
        if hasattr(metadata, "__dict__"):
            metadata = vars(metadata)

        ticker = metadata.get("ticker", "")
        filing_date = metadata.get("filing_date", "") or "2000-01-01"

        try:
            with self.driver.session() as session:
                # ── Upsert Company node ──────────────────────────────────
                if ticker:
                    session.run(UPSERT_COMPANY, {
                        "ticker": ticker,
                        "name": metadata.get("company_name", ""),
                        "sector": metadata.get("sector"),
                        "industry": metadata.get("industry"),
                        "country": metadata.get("country"),
                        "market_cap": metadata.get("market_cap"),
                    })
                    counts["companies"] += 1

                # ── Upsert Filing node and link to Company ───────────────
                session.run(UPSERT_FILING, {
                    "filing_id": document_id,
                    "title": f"{ticker} {metadata.get('filing_type', '')} {filing_date}",
                    "filing_type": metadata.get("filing_type", "document"),
                    "filing_date": filing_date,
                    "fiscal_year": metadata.get("fiscal_year", ""),
                    "fiscal_quarter": metadata.get("fiscal_quarter", ""),
                    "source_url": metadata.get("source_url", ""),
                    "ticker": ticker,
                })
                counts["filings"] += 1

                # ── Upsert People and link to company ────────────────────
                for person in entities.get("people", [])[:20]:  # Cap at 20 people/doc
                    name = person.get("name", "").strip()
                    if not name or len(name) < 3:
                        continue
                    session.run(UPSERT_PERSON, {
                        "name": name,
                        "title": person.get("title", ""),
                    })
                    if ticker:
                        session.run(LINK_PERSON_TO_COMPANY, {
                            "person_name": name,
                            "ticker": ticker,
                            "title": person.get("title", "Executive"),
                        })
                    counts["people"] += 1

                # ── Upsert Themes and link to filing ────────────────────
                for theme in entities.get("themes", [])[:30]:  # Cap at 30 themes/doc
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

                # ── Upsert KPI metrics and link to company + filing ──────
                for kpi in entities.get("kpis", [])[:50]:  # Cap at 50 KPIs/doc
                    metric_name = kpi.get("metric", "").strip()
                    if not metric_name or kpi.get("value") is None:
                        continue
                    metric_id = f"{ticker}::{metric_name}::{kpi.get('period', '')}::{kpi.get('segment', '')}"
                    session.run(UPSERT_FINANCIAL_METRIC, {
                        "metric_id": metric_id,
                        "metric": metric_name,
                        "value": float(kpi.get("value", 0)),
                        "currency": "USD" if "USD" in kpi.get("unit", "") else "",
                        "unit": kpi.get("unit", ""),
                        "period": kpi.get("period", ""),
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

        except Exception as e:
            logger.error(
                "graph_indexing_failed",
                document_id=document_id,
                ticker=ticker,
                error=str(e),
            )

        logger.info("graph_indexed", document_id=document_id, **counts)
        return counts
