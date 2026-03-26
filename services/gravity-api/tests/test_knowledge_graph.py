"""Tests for the Knowledge Graph layer."""

import pytest
import datetime
from unittest.mock import MagicMock, patch

from app.knowledge_graph.models import CompanyNode, FinancialMetricNode, Relationship
from app.knowledge_graph.builder import KnowledgeGraphBuilder
from app.ingestion.indexing.graph_indexer import GraphIndexer
from app.core.retrieval.graph_search import GraphSearch


def test_models():
    """Verify Pydantic models serialize correctly."""
    company = CompanyNode(ticker="AAPL", name="Apple Inc.", market_cap=3e12)
    assert company.ticker == "AAPL"
    
    metric = FinancialMetricNode(
        id="aapl_rev_2025", 
        metric="Revenue", 
        value=120.5, 
        unit="B", 
        period="Q1 2025",
        ticker="AAPL"
    )
    assert metric.value == 120.5 


@pytest.mark.asyncio
async def test_builder_runs_without_crashing():
    """Verify the builder handles valid input and executes Cypher without errors."""
    builder = KnowledgeGraphBuilder()
    
    metadata = {
        "ticker": "NVDA",
        "company_name": "NVIDIA",
        "filing_type": "10-Q",
        "fiscal_year": "2025",
    }
    
    entities = {
        "people": [{"name": "Jensen", "title": "CEO"}],
        "themes": ["GPU demand"],
        "metrics": [{"name": "Data Center Rev", "value": 22.0, "unit": "B"}],
        "analysts": [{"name": "Vivek", "firm": "BofA"}],
    }
    
    # We aren't testing the actual DB insertion here (it uses the mock driver if Neo4j is down),
    # but we are testing that the Cypher queries are syntactically valid and don't raise Python errors.
    counts = await builder.build_from_document("doc-123", metadata, entities)
    
    assert counts["companies"] == 1
    assert counts["filings"] == 1
    assert counts["people"] == 1
    assert counts["themes"] == 1
    assert counts["metrics"] == 1
    assert counts["analysts"] == 1


@pytest.mark.asyncio
async def test_graph_search_yields_results():
    """Verify GraphSearch translates entities into retrieval results."""
    searcher = GraphSearch()
    
    # Patch the _run_query method so we don't need a real DB for the unit test
    with patch.object(searcher, "_run_query") as mock_run:
        # Mock responses for the queries
        mock_run.side_effect = [
            [{"id": "doc1", "title": "AAPL 10-K", "type": "10-K", "date": "2025-01-01"}], # company_filings
            [{"relationship": "COMPETES_WITH", "target_type": ["Company"], "target_name": "Microsoft", "target_ticker": "MSFT"}], # company_relationships
            [{"company": "AAPL", "ticker": "AAPL", "type": "10-K", "date": "2025-01-01", "filing_id": "doc1"}], # theme_mentions
        ]
        
        entities = {
            "companies": [{"ticker": "AAPL"}],
            "themes": ["AI"],
        }
        
        results = await searcher.search("query", entities=entities)
        
        assert len(results) == 3
        # Filing result
        assert results[0].ticker == "AAPL"
        assert results[0].score == 0.5
        # Relationship result
        assert "MSFT" in results[1].text
        # Theme result
        assert "AAPL" in results[2].text
        assert "AI" in results[2].text
