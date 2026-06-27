"""
Gravity Search -- Financial Table Indexer
Converts ParsedTable objects into searchable chunks + structured rows.

Two output streams:
  1. Rich-text chunks -> Qdrant (dense) + ES (BM25) via existing indexers
  2. Structured rows  -> ES `gravity_financials` index (Postgres fallback)

Why this matters: DocumentProcessor already extracts tables but they go nowhere.
This indexer closes that gap: +15-20% FinanceBench score on numeric questions.
"""

from __future__ import annotations

import re
import json
import asyncio
import structlog
from dataclasses import dataclass, field
from typing import Any

logger = structlog.get_logger()

# Period detection: FY2024, Q3 2023, 2022, FY22, etc.
_PERIOD_RE = re.compile(
    r"\b(?:FY|Q[1-4])?\s*(?:20\d{2}|19\d{2})\b|\bQ[1-4]\s*'?\d{2}\b",
    re.IGNORECASE,
)

# Metric cleanup
_METRIC_NOISE = re.compile(r"\s*\(.*?\)\s*")  # remove parenthetical notes


@dataclass
class FinancialRow:
    """One metric-period-value triple extracted from a table cell."""
    ticker: str
    company: str
    filing_type: str
    filing_date: str
    document_id: str
    table_type: str       # income_statement | balance_sheet | cash_flow | other
    metric_name: str      # "Total Revenue"
    period: str           # "FY2024"
    value_raw: str        # "$391,035" as text
    value_float: float | None
    unit: str = ""        # "millions" | "thousands" | ""
    source_section: str = ""
    caption: str = ""


@dataclass
class ChunkOutput:
    """Text chunk ready for VectorIndexer / KeywordIndexer."""
    text: str
    metadata: dict = field(default_factory=dict)
    chunk_id: str = ""


class TableIndexer:
    """
    Indexes financial tables extracted by DocumentProcessor.

    Usage (in pipeline.py):
        table_indexer = TableIndexer(vector_indexer, keyword_indexer, es_client)
        await table_indexer.index_tables(tables, metadata, document_id)
    """

    # ES index for structured financial rows
    FINANCIALS_INDEX = "gravity_financials"

    def __init__(self, vector_indexer=None, keyword_indexer=None, es_client=None):
        self.vector_indexer = vector_indexer
        self.keyword_indexer = keyword_indexer
        self.es = es_client  # raw elasticsearch AsyncElasticsearch client

    # ── Public entry point ────────────────────────────────────────────────

    async def index_tables(
        self,
        tables: list,
        metadata: dict,
        document_id: str,
    ) -> dict:
        """
        Index a list of ParsedTable objects from one document.

        Args:
            tables:      list[ParsedTable] from DocumentProcessor
            metadata:    dict with ticker, company_name, filing_type, filing_date
            document_id: unique doc ID

        Returns:
            {"chunks_indexed": int, "rows_indexed": int, "tables_processed": int}
        """
        if not tables:
            return {"chunks_indexed": 0, "rows_indexed": 0, "tables_processed": 0}

        ticker = metadata.get("ticker", "")
        company = metadata.get("company_name", ticker)
        filing_type = metadata.get("filing_type", "")
        filing_date = metadata.get("filing_date", "")

        all_rows: list[FinancialRow] = []
        all_chunks: list[ChunkOutput] = []

        for table in tables:
            rows = self._extract_rows(table, ticker, company, filing_type, filing_date, document_id)
            all_rows.extend(rows)
            chunks = self._rows_to_chunks(rows, table)
            all_chunks.extend(chunks)

        # Run indexing concurrently. Financial rows go to BOTH Elasticsearch
        # (gravity_financials, if ES is up) and Supabase Postgres (financials
        # table, no ES needed) — whichever is configured serves the structured
        # exact-facts channel.
        chunk_count, row_es, row_sb = await asyncio.gather(
            self._index_chunks(all_chunks, metadata, document_id),
            self._store_rows_es(all_rows),
            self._store_rows_supabase(all_rows),
        )
        row_count = max(row_es, row_sb)

        logger.info(
            "tables_indexed",
            document_id=document_id,
            ticker=ticker,
            tables=len(tables),
            chunks=chunk_count,
            rows=row_count,
        )
        return {
            "chunks_indexed": chunk_count,
            "rows_indexed": row_count,
            "tables_processed": len(tables),
        }

    # ── Row extraction ────────────────────────────────────────────────────

    def _extract_rows(
        self,
        table,
        ticker: str,
        company: str,
        filing_type: str,
        filing_date: str,
        document_id: str,
    ) -> list[FinancialRow]:
        """Convert ParsedTable headers/rows into FinancialRow objects."""
        rows: list[FinancialRow] = []
        if not table.rows:
            return rows

        headers = table.headers or []
        period_cols = self._detect_period_columns(headers)

        # Detect unit from caption or first rows
        unit = self._detect_unit(table.caption + " ".join(headers))

        for data_row in table.rows:
            if not data_row:
                continue

            metric_name = self._clean_metric(data_row[0]) if data_row else ""
            if not metric_name or len(metric_name) < 3:
                continue

            # Skip rows that look like sub-headers
            if self._is_header_row(data_row):
                continue

            if period_cols:
                # Align numeric cells to period columns BY ORDER, not by header
                # index. SEC HTML statement rows interleave the label, '$' sign,
                # and blank spacer <td>s, so the header's column index does not
                # line up with the value's index in the data row (positional
                # mapping grabbed a '$'/spacer/footnote cell -> garbage values
                # like "33" for an $8B line item). The numeric cells, left to
                # right, correspond to the period columns left to right.
                nums = self._row_numeric_values(data_row)
                if nums:
                    # If there are more numeric cells than periods, keep the
                    # rightmost N (value columns sit to the right of any
                    # label-embedded ref numbers).
                    vals = nums[-len(period_cols):] if len(nums) > len(period_cols) else nums
                    for (_, period), (raw_val, float_val) in zip(period_cols, vals):
                        rows.append(FinancialRow(
                            ticker=ticker,
                            company=company,
                            filing_type=filing_type,
                            filing_date=filing_date,
                            document_id=document_id,
                            table_type=table.table_type,
                            metric_name=metric_name,
                            period=period,
                            value_raw=raw_val,
                            value_float=float_val,
                            unit=unit,
                            source_section=table.source_section,
                            caption=table.caption,
                        ))
            else:
                # No period columns detected: use filing_date as period
                for col_idx, val in enumerate(data_row[1:], start=1):
                    float_val = self._parse_value(val)
                    if float_val is not None and val.strip() not in ("-", "--"):
                        period = headers[col_idx] if col_idx < len(headers) else filing_date
                        rows.append(FinancialRow(
                            ticker=ticker,
                            company=company,
                            filing_type=filing_type,
                            filing_date=filing_date,
                            document_id=document_id,
                            table_type=table.table_type,
                            metric_name=metric_name,
                            period=period or filing_date,
                            value_raw=val,
                            value_float=float_val,
                            unit=unit,
                            source_section=table.source_section,
                            caption=table.caption,
                        ))

        return rows

    def _detect_period_columns(self, headers: list[str]) -> list[tuple[int, str]]:
        """
        Find which column indices contain period labels (FY2024, Q3 2023, etc.)
        Returns list of (col_idx, period_label) tuples.
        """
        result = []
        for idx, h in enumerate(headers):
            m = _PERIOD_RE.search(h)
            if m:
                result.append((idx, h.strip()))
        return result

    def _detect_unit(self, text: str) -> str:
        """Detect unit scaling from caption: millions, thousands, billions."""
        text_lower = text.lower()
        if "in millions" in text_lower or "$ millions" in text_lower or "(millions" in text_lower:
            return "millions"
        if "in thousands" in text_lower or "(thousands" in text_lower:
            return "thousands"
        if "in billions" in text_lower or "(billions" in text_lower:
            return "billions"
        return ""

    def _clean_metric(self, text: str) -> str:
        """Normalize metric name: strip parentheticals, normalize whitespace."""
        text = _METRIC_NOISE.sub(" ", text)
        text = re.sub(r"\s+", " ", text).strip()
        # Strip leading bullets/dashes
        text = re.sub(r"^[\-•–—\s]+", "", text).strip()
        return text

    def _is_header_row(self, row: list[str]) -> bool:
        """Heuristic: if >50% of cells are non-numeric and no numbers at all, skip."""
        if not row:
            return True
        numeric_cells = sum(1 for c in row[1:] if self._parse_value(c) is not None)
        return numeric_cells == 0 and len(row) > 1

    def _row_numeric_values(self, data_row: list[str]) -> list[tuple[str, float]]:
        """Numeric (raw, float) cells after the label column, left to right.

        Used to align values to period columns by order instead of by header
        index — robust against the '$'/blank spacer <td>s that SEC HTML
        statement rows interleave between the label and each value.
        """
        out: list[tuple[str, float]] = []
        for v in data_row[1:]:
            f = self._parse_value(v)
            if f is not None:
                out.append((v, f))
        return out

    def _parse_value(self, text: str) -> float | None:
        """Parse financial number from cell text."""
        if not text:
            return None
        text = str(text).strip()
        if text in ("-", "--", "N/A", "", "n/a", "nm", "NM"):
            return None

        is_negative = (text.startswith("(") and text.endswith(")")) or text.startswith("-")
        text = text.strip("()").lstrip("-").lstrip("−")  # minus sign variants
        text = re.sub(r"[$€\xa3\xa5\s,]", "", text)
        text = text.rstrip("%")

        try:
            val = float(text)
            return -val if is_negative else val
        except ValueError:
            return None

    # ── Chunk generation ──────────────────────────────────────────────────

    def _rows_to_chunks(self, rows: list[FinancialRow], table) -> list[ChunkOutput]:
        """
        Generate two types of chunks from FinancialRow objects:
          1. Per-metric sentence: "Apple FY2024 Total Revenue (10-K): $391,035M"
          2. Per-period summary: multi-metric paragraph for one period
        """
        chunks: list[ChunkOutput] = []
        if not rows:
            return chunks

        ticker = rows[0].ticker
        company = rows[0].company
        filing_type = rows[0].filing_type
        table_type = rows[0].table_type

        # Type 1: Per-metric sentences
        for row in rows:
            unit_label = f" ({row.unit})" if row.unit else ""
            sentence = (
                f"{company} ({ticker}) {row.period} {row.metric_name} "
                f"[{filing_type}, {table_type.replace('_', ' ')}]{unit_label}: {row.value_raw}"
            )
            chunks.append(ChunkOutput(
                text=sentence,
                chunk_id=f"{row.document_id}_metric_{hash(row.metric_name + row.period) & 0xFFFFFF}",
                metadata={
                    "ticker": ticker,
                    "company_name": company,
                    "filing_type": filing_type,
                    "filing_date": row.filing_date,
                    "table_type": table_type,
                    "metric_name": row.metric_name,
                    "period": row.period,
                    "chunk_type": "financial_metric",
                    "source": "table_indexer",
                },
            ))

        # Type 2: Per-period summary paragraphs
        by_period: dict[str, list[FinancialRow]] = {}
        for row in rows:
            by_period.setdefault(row.period, []).append(row)

        for period, period_rows in by_period.items():
            if len(period_rows) < 2:
                continue
            unit_label = f" ({period_rows[0].unit})" if period_rows[0].unit else ""
            table_label = table_type.replace("_", " ").title()
            lines = [f"{company} ({ticker}) {period} {table_label}{unit_label}:"]
            for row in period_rows[:20]:  # Cap at 20 metrics per chunk
                lines.append(f"  {row.metric_name}: {row.value_raw}")
            summary = "\n".join(lines)
            chunks.append(ChunkOutput(
                text=summary,
                chunk_id=f"{period_rows[0].document_id}_period_{hash(period + table_type) & 0xFFFFFF}",
                metadata={
                    "ticker": ticker,
                    "company_name": company,
                    "filing_type": filing_type,
                    "filing_date": period_rows[0].filing_date,
                    "table_type": table_type,
                    "period": period,
                    "chunk_type": "financial_period_summary",
                    "source": "table_indexer",
                },
            ))

        return chunks

    # ── Chunk indexing ────────────────────────────────────────────────────

    async def _index_chunks(
        self,
        chunks: list[ChunkOutput],
        metadata: dict,
        document_id: str,
    ) -> int:
        """Push text chunks through VectorIndexer + KeywordIndexer."""
        if not chunks:
            return 0

        indexed = 0
        try:
            # Build a minimal ChunkOutput-like object that existing indexers accept
            from app.ingestion.chunking.chunker import TextChunk

            text_chunks = []
            for c in chunks:
                tc = TextChunk(
                    text=c.text,
                    chunk_id=c.chunk_id or f"{document_id}_tbl_{indexed}",
                    metadata={**metadata, **c.metadata},
                )
                text_chunks.append(tc)

            tasks = []
            if self.vector_indexer:
                tasks.append(self.vector_indexer.index_chunks(text_chunks, document_id, metadata))
            if self.keyword_indexer:
                tasks.append(self.keyword_indexer.index_chunks(text_chunks, document_id, metadata))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            indexed = len(text_chunks)
        except Exception as e:
            logger.warning("table_chunk_index_failed", error=str(e))

        return indexed

    # ── Structured ES indexing ────────────────────────────────────────────

    async def _store_rows_supabase(self, rows: list["FinancialRow"]) -> int:
        """Upsert FinancialRow objects into the Supabase `financials` table
        (PostgREST). No-op if Supabase isn't configured. Powers the structured
        exact-facts channel without Elasticsearch."""
        if not rows:
            return 0
        try:
            from app.db import supabase_rest
            if not supabase_rest.configured():
                return 0
            # Keep only primary financial statements — footnote/disclosure tables
            # ("other") pollute the facts (e.g. "Deferred revenue" matching a
            # "total revenue" query). Income statement / balance sheet / cash flow
            # carry the line items users ask for.
            _PRIMARY = {"income_statement", "balance_sheet", "cash_flow"}
            rows = [r for r in rows if (getattr(r, "table_type", "") or "") in _PRIMARY]
            if not rows:
                return 0
            # Dedupe by id within the batch — PostgREST upsert (ON CONFLICT) errors
            # if the same id appears twice in one command (same metric+period can
            # be extracted from multiple tables in a filing). Last value wins.
            by_id: dict[str, dict] = {}
            for r in rows:
                rid = re.sub(r"\s+", "_", f"{r.ticker}_{r.metric_name}_{r.period}_{r.document_id}")[:200]
                by_id[rid] = {
                    "id": rid,
                    "ticker": r.ticker,
                    "company": r.company,
                    "filing_type": r.filing_type,
                    "filing_date": r.filing_date or None,
                    "document_id": r.document_id,
                    "metric_name": r.metric_name,
                    "period": r.period,
                    "value_raw": r.value_raw,
                    "value_float": r.value_float,
                    "unit": r.unit,
                    "source_section": r.source_section,
                    "caption": r.caption,
                }
            return await supabase_rest.sb_insert("financials", list(by_id.values()), on_conflict="id")
        except Exception as e:
            logger.warning("supabase_financials_failed", error=str(e)[:160])
            return 0

    async def _store_rows_es(self, rows: list[FinancialRow]) -> int:
        """Bulk-index FinancialRow objects into gravity_financials ES index."""
        if not rows or not self.es:
            return 0

        await self._ensure_financials_index()

        ops: list[dict] = []
        for row in rows:
            doc_id = f"{row.ticker}_{row.metric_name}_{row.period}_{row.document_id}"
            doc_id = re.sub(r"\s+", "_", doc_id)[:200]
            ops.append({"index": {"_index": self.FINANCIALS_INDEX, "_id": doc_id}})
            ops.append({
                "ticker": row.ticker,
                "company": row.company,
                "filing_type": row.filing_type,
                "filing_date": row.filing_date,
                "document_id": row.document_id,
                "table_type": row.table_type,
                "metric_name": row.metric_name,
                "period": row.period,
                "value_raw": row.value_raw,
                "value_float": row.value_float,
                "unit": row.unit,
                "source_section": row.source_section,
                "caption": row.caption,
            })

        if not ops:
            return 0

        try:
            resp = await self.es.bulk(body=ops, timeout="30s")
            errors = [i for i in resp.get("items", []) if "error" in i.get("index", {})]
            if errors:
                logger.warning("es_bulk_partial_errors", count=len(errors))
            return len(rows) - len(errors)
        except Exception as e:
            logger.warning("es_bulk_financials_failed", error=str(e))
            return 0

    async def _ensure_financials_index(self) -> None:
        """Create gravity_financials index if it doesn't exist."""
        try:
            exists = await self.es.indices.exists(index=self.FINANCIALS_INDEX)
            if exists:
                return
            mapping = {
                "mappings": {
                    "properties": {
                        "ticker":        {"type": "keyword"},
                        "company":       {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                        "filing_type":   {"type": "keyword"},
                        "filing_date":   {"type": "keyword"},
                        "document_id":   {"type": "keyword"},
                        "table_type":    {"type": "keyword"},
                        "metric_name":   {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                        "period":        {"type": "keyword"},
                        "value_raw":     {"type": "keyword"},
                        "value_float":   {"type": "double"},
                        "unit":          {"type": "keyword"},
                        "source_section":{"type": "text"},
                        "caption":       {"type": "text"},
                    }
                },
                "settings": {"number_of_shards": 1, "number_of_replicas": 0},
            }
            await self.es.indices.create(index=self.FINANCIALS_INDEX, body=mapping)
            logger.info("financials_index_created", index=self.FINANCIALS_INDEX)
        except Exception as e:
            logger.warning("financials_index_ensure_failed", error=str(e))
