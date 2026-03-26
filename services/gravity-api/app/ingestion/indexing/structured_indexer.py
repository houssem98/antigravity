"""
Gravity Search — Structured Indexer (PostgreSQL)
Extracts financial metrics from document text using Gemini Flash,
then inserts them into the financial_statements TimescaleDB table.
"""

import json
import uuid
import structlog

from app.db.models import FinancialStatement
from app.db.postgres import async_session

logger = structlog.get_logger()

FINANCIAL_EXTRACTION_PROMPT = """Extract ALL financial metrics mentioned in this text.
Look for: revenue, earnings, net income, EBITDA, gross profit, operating income,
free cash flow, capex, guidance, margins (gross/operating/net), debt, cash.

Respond ONLY with JSON:
{{
  "metrics": [
    {{
      "metric_name": "revenue",
      "value": 124300000000,
      "currency": "USD",
      "period": "Q4 FY2025",
      "fiscal_year": 2025,
      "fiscal_quarter": "Q4",
      "is_guidance": false
    }}
  ]
}}

Include ONLY metrics with explicit numeric values. Skip vague mentions.
Text:
{text}"""


class StructuredIndexer:
    """
    Extracts and indexes financial metrics into PostgreSQL/TimescaleDB.

    Powered by Gemini Flash (fast, cheap) for NER-like extraction.
    Gracefully skips indexing if no LLM is available.
    """

    def __init__(self, llm_client=None):
        self.llm = llm_client  # GoogleClient (Gemini Flash)

    async def index_document(
        self,
        document_id: str,
        text: str,
        metadata: dict,
    ) -> int:
        """
        Extract financial metrics and insert into the financial_statements table.

        Args:
            document_id: Source document UUID
            text: Document text
            metadata: Dict with ticker, company_name, filing_date, etc.

        Returns:
            Number of metrics inserted.
        """
        if not self.llm:
            logger.debug("structured_indexer_no_llm_skip")
            return 0

        ticker = metadata.get("ticker", "")
        if not ticker:
            return 0

        # Sample key sections (first 6000 chars usually has financials)
        sample = text[:6000]

        try:
            from app.llm.base import LLMConfig, LLMMessage

            response = await self.llm.generate(
                messages=[
                    LLMMessage(
                        role="user",
                        content=FINANCIAL_EXTRACTION_PROMPT.format(text=sample),
                    )
                ],
                config=LLMConfig(temperature=0.0, max_tokens=1500, json_mode=True),
            )

            data = json.loads(response.content)
            metrics = data.get("metrics", [])

        except Exception as e:
            logger.warning("structured_extraction_failed", error=str(e), ticker=ticker)
            return 0

        if not metrics:
            return 0

        # Insert into PostgreSQL
        inserted = 0
        try:
            async with async_session() as session:
                for metric in metrics:
                    # Parse fiscal year
                    try:
                        fy = int(metric.get("fiscal_year") or 0)
                    except (ValueError, TypeError):
                        fy = 0

                    row = FinancialStatement(
                        id=str(uuid.uuid4()),
                        ticker=ticker,
                        metric_name=metric.get("metric_name", ""),
                        value=float(metric.get("value") or 0),
                        currency=metric.get("currency", "USD"),
                        fiscal_year=fy,
                        fiscal_quarter=metric.get("fiscal_quarter", ""),
                        filing_date=metadata.get("filing_date"),
                        source_document_id=document_id,
                    )
                    session.add(row)
                    inserted += 1

                await session.commit()

        except Exception as e:
            logger.error("structured_insert_failed", error=str(e), ticker=ticker)
            return 0

        logger.info("structured_indexed", ticker=ticker, metrics_inserted=inserted)
        return inserted
