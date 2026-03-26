"""
Gravity Search — Structured Data Search via PostgreSQL/TimescaleDB (Channel 5)
Translates natural language to SQL via Gemini Flash for quantitative questions.
"""

import structlog
from sqlalchemy import text

from app.db.postgres import async_session
from app.core.retrieval.fusion import RetrievalResult
from app.core.reasoning.prompts import NL_TO_SQL_SYSTEM
from app.llm.base import LLMConfig, LLMMessage

logger = structlog.get_logger()


class StructuredSearch:
    """Natural language to SQL for financial data queries."""

    def __init__(self, llm_client):
        self.llm = llm_client  # Gemini Flash for NL-to-SQL

    async def search(
        self,
        query: str,
        entities: dict | None = None,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        """Generate SQL from natural language, execute, return as RetrievalResult."""
        try:
            # Use Gemini Flash to generate SQL
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=NL_TO_SQL_SYSTEM),
                    LLMMessage(role="user", content=query),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=500, json_mode=True),
            )

            import json
            sql_result = json.loads(response.content)
            sql_query = sql_result.get("sql", "")
            params = sql_result.get("params", [])
            description = sql_result.get("description", "")

            if not sql_query:
                return []

            # Execute the SQL query
            async with async_session() as session:
                result = await session.execute(text(sql_query), dict(enumerate(params, 1)))
                rows = result.fetchmany(top_k)
                columns = result.keys() if rows else []

            # Convert to RetrievalResult
            output = []
            for i, row in enumerate(rows):
                row_dict = dict(zip(columns, row))
                text_repr = " | ".join(f"{k}: {v}" for k, v in row_dict.items())
                output.append(RetrievalResult(
                    chunk_id=f"structured_{i}",
                    document_id="structured_data",
                    text=f"[Structured Data] {description}\n{text_repr}",
                    score=1.0,  # Structured data is highly relevant when matched
                    metadata=row_dict,
                    ticker=row_dict.get("ticker", ""),
                ))

            logger.info("structured_search", results=len(output), sql=sql_query[:100])
            return output

        except Exception as e:
            logger.warning("structured_search_failed", error=str(e))
            return []
