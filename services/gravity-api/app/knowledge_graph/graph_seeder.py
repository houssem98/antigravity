"""
Gravity Search — Knowledge Graph Seeder
Standalone script to populate local Neo4j with realistic financial entity test data.
Safe to run multiple times (idempotent).

Usage:
    python -m app.knowledge_graph.graph_seeder
"""

import asyncio
import structlog
from datetime import datetime

from app.db.neo4j import get_neo4j_driver
from app.knowledge_graph.builder import KnowledgeGraphBuilder


logger = structlog.get_logger()

# ── Sample Data ─────────────────────────────────────────────────────────────

COMPANIES = [
    {"ticker": "AAPL", "company_name": "Apple Inc.", "sector": "Technology", "market_cap": 3000000000000},
    {"ticker": "TSM", "company_name": "Taiwan Semiconductor", "sector": "Technology", "market_cap": 800000000000},
    {"ticker": "NVDA", "company_name": "NVIDIA Corp.", "sector": "Technology", "market_cap": 2500000000000},
    {"ticker": "JPM", "company_name": "JPMorgan Chase", "sector": "Financials", "market_cap": 500000000000},
    {"ticker": "MSFT", "company_name": "Microsoft Corp.", "sector": "Technology", "market_cap": 3100000000000},
]

PEOPLE = {
    "AAPL": [{"name": "Tim Cook", "title": "CEO"}, {"name": "Luca Maestri", "title": "CFO"}],
    "TSM": [{"name": "C.C. Wei", "title": "CEO"}, {"name": "Wendell Huang", "title": "CFO"}],
    "NVDA": [{"name": "Jensen Huang", "title": "CEO"}, {"name": "Colette Kress", "title": "CFO"}],
}

THEMES = ["AI Capital Expenditure", "Supply Chain Diversification", "Tariff Risk", "Margin Expansion", "GPU Demand"]

METRICS = {
    "AAPL": [{"metric": "Revenue", "value": 119.58, "unit": "B", "period": "Q1 2024"}],
    "NVDA": [{"metric": "Data Center Revenue", "value": 18.4, "unit": "B", "period": "Q4 2024"}],
    "TSM": [{"metric": "Capital Expenditure", "value": 32.0, "unit": "B", "period": "FY 2024"}],
}

ANALYSTS = {
    "AAPL": [{"name": "Erik Woodring", "firm": "Morgan Stanley"}],
    "NVDA": [{"name": "Vivek Arya", "firm": "Bank of America"}],
}

# ── Seeder Logic ────────────────────────────────────────────────────────────

async def seed_graph():
    """Seed the Neo4j Knowledge Graph with realistic test data."""
    logger.info("graph_seed_started")
    driver = get_neo4j_driver()
    if not driver.is_connected:
        logger.error("graph_seed_failed", reason="Neo4j not connected (using mock)")
        return

    builder = KnowledgeGraphBuilder()
    total_nodes = 0

    # 1. Build company-centric subgraphs using the builder
    for i, company in enumerate(COMPANIES):
        ticker = company["ticker"]
        
        metadata = {
            **company,
            "filing_type": "10-K",
            "filing_date": "2024-02-15",
            "fiscal_year": "2024",
            "fiscal_quarter": "Q4",
        }
        
        entities = {
            "people": PEOPLE.get(ticker, []),
            "themes": THEMES[:3] if i % 2 == 0 else THEMES[2:],
            "metrics": METRICS.get(ticker, []),
            "analysts": ANALYSTS.get(ticker, []),
        }

        # Simulate a document processing event
        doc_id = f"seed_doc_{ticker}_10K_2024"
        counts = await builder.build_from_document(doc_id, metadata, entities)
        total_nodes += sum(counts.values())

    # 2. Add cross-company relationships directly via Cypher
    from app.knowledge_graph.queries import LINK_COMPANIES_SUPPLY_CHAIN
    
    supply_chain_links = [
        {"supplier": "TSM", "customer": "AAPL"},
        {"supplier": "TSM", "customer": "NVDA"},
    ]
    
    competitor_links = [
        {"a": "AAPL", "b": "MSFT"},
    ]
    
    with driver.session() as session:
        for link in supply_chain_links:
            session.run(
                LINK_COMPANIES_SUPPLY_CHAIN, 
                {"supplier_ticker": link["supplier"], "customer_ticker": link["customer"]}
            )
            
        for link in competitor_links:
            session.run("""
            MATCH (a:Company {ticker: $ticker_a}), (b:Company {ticker: $ticker_b})
            MERGE (a)-[:COMPETES_WITH]-(b)
            """, {"ticker_a": link["a"], "ticker_b": link["b"]})

    logger.info("graph_seed_completed", estimated_nodes_created=total_nodes)


if __name__ == "__main__":
    asyncio.run(seed_graph())
