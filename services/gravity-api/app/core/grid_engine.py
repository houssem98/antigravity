"""
Generative Grid Engine — AlphaSense Generative Grid competitor
==============================================================
Executes N questions × M documents in parallel, producing a structured
table of answers with explicit NOT_FOUND signals and source citations.

Key design decisions:
  - Each cell is an independent RAG call (asyncio.gather for parallelism)
  - NOT_FOUND is explicit (never hallucinated) — returned when confidence < threshold
  - Cells include confidence score + source citations + page references
  - Columnar normalization: same question across all docs uses same answer schema
  - Supports numeric, boolean, text, date, and list answer types
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import structlog

logger = structlog.get_logger()


# ── Enums ──────────────────────────────────────────────────────────────────────

class AnswerType(str, Enum):
    TEXT = "text"
    NUMERIC = "numeric"
    BOOLEAN = "boolean"
    DATE = "date"
    LIST = "list"
    NOT_FOUND = "not_found"


class CellStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETE = "complete"
    NOT_FOUND = "not_found"
    ERROR = "error"


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class GridQuestion:
    """A column definition: one question to answer across all documents."""
    question_id: str
    question: str
    answer_type: AnswerType = AnswerType.TEXT
    unit: str = ""                    # e.g. "USD millions", "%", "ratio"
    time_period: str = ""             # e.g. "FY2023", "Q3 2024", "LTM"
    normalize: bool = True            # normalize numeric answers to same unit


@dataclass
class GridDocument:
    """A row definition: one document/company to query."""
    document_id: str
    ticker: str
    company_name: str
    filing_type: str = ""             # 10-K, 10-Q, earnings transcript
    filing_date: str = ""
    display_label: str = ""           # e.g. "AAPL FY2023 10-K"

    def __post_init__(self):
        if not self.display_label:
            self.display_label = f"{self.ticker} {self.filing_type} {self.filing_date}".strip()


@dataclass
class GridCitation:
    """Source citation for a grid cell answer."""
    document_id: str
    ticker: str
    page: int | None = None
    section: str = ""
    breadcrumb_path: str = ""
    excerpt: str = ""


@dataclass
class GridCell:
    """Single cell result: answer to one question for one document."""
    question_id: str
    document_id: str
    status: CellStatus = CellStatus.PENDING
    answer: Any = None                # typed by answer_type
    answer_type: AnswerType = AnswerType.TEXT
    confidence: float = 0.0           # 0.0–1.0
    citations: list[GridCitation] = field(default_factory=list)
    raw_text: str = ""                # LLM's verbatim extraction
    normalized_value: Any = None      # post-processed (e.g. float for numeric)
    unit: str = ""
    error: str = ""
    latency_ms: float = 0.0


@dataclass
class GridRequest:
    """Input to the grid engine."""
    questions: list[GridQuestion]
    documents: list[GridDocument]
    max_concurrency: int = 10
    confidence_threshold: float = 0.4   # below this → NOT_FOUND
    include_excerpts: bool = True
    timeout_per_cell: float = 8.0


@dataclass
class GridResult:
    """Full grid output: cells[document_id][question_id] = GridCell."""
    cells: dict[str, dict[str, GridCell]] = field(default_factory=dict)
    questions: list[GridQuestion] = field(default_factory=list)
    documents: list[GridDocument] = field(default_factory=list)
    total_cells: int = 0
    completed_cells: int = 0
    not_found_cells: int = 0
    error_cells: int = 0
    latency_ms: float = 0.0

    def get_cell(self, document_id: str, question_id: str) -> GridCell | None:
        return self.cells.get(document_id, {}).get(question_id)

    def to_table(self) -> list[dict]:
        """Export as list of row dicts (one per document) for JSON serialization."""
        rows = []
        for doc in self.documents:
            row = {
                "document_id": doc.document_id,
                "ticker": doc.ticker,
                "display_label": doc.display_label,
            }
            for q in self.questions:
                cell = self.get_cell(doc.document_id, q.question_id)
                if cell:
                    row[q.question_id] = {
                        "answer": cell.answer,
                        "status": cell.status.value,
                        "confidence": round(cell.confidence, 2),
                        "unit": cell.unit,
                        "citations": [
                            {"ticker": c.ticker, "page": c.page, "section": c.section}
                            for c in cell.citations
                        ],
                    }
                else:
                    row[q.question_id] = {"answer": None, "status": "pending"}
            rows.append(row)
        return rows


# ── Grid Engine ────────────────────────────────────────────────────────────────

class GridEngine:
    """
    Executes a Generative Grid: N questions × M documents → structured table.

    Usage:
        engine = GridEngine(search_pipeline=pipeline, page_index_indexer=pii)
        result = await engine.execute(grid_request)
    """

    # Prompt template for cell extraction
    _CELL_PROMPT = """You are a financial data extraction assistant. Extract the answer to the question from the provided document excerpts.

Question: {question}
Document: {display_label}
Time Period: {time_period}

Document excerpts:
{excerpts}

Instructions:
1. Answer ONLY from the provided excerpts. Do NOT use external knowledge.
2. If the answer is not found in the excerpts, respond with exactly: NOT_FOUND
3. For numeric answers, provide the number with units (e.g. "$1.23B", "15.4%", "3.2x")
4. Be precise and concise. No explanation needed.
5. Include the page number or section where you found the answer if visible.

Response format:
ANSWER: <your answer or NOT_FOUND>
CONFIDENCE: <0.0-1.0>
SOURCE: <page number or section name>
EXCERPT: <verbatim quote from the document, max 100 chars>"""

    def __init__(self, search_pipeline=None, page_index_indexer=None):
        self.pipeline = search_pipeline
        self.pii = page_index_indexer  # PageIndexIndexer

    async def execute(self, request: GridRequest) -> GridResult:
        """Execute the full grid with parallel cell resolution."""
        start = time.time()
        result = GridResult(
            questions=request.questions,
            documents=request.documents,
            total_cells=len(request.questions) * len(request.documents),
        )

        # Initialize empty cells
        for doc in request.documents:
            result.cells[doc.document_id] = {}
            for q in request.questions:
                result.cells[doc.document_id][q.question_id] = GridCell(
                    question_id=q.question_id,
                    document_id=doc.document_id,
                    answer_type=q.answer_type,
                    unit=q.unit,
                )

        # Build task list
        semaphore = asyncio.Semaphore(request.max_concurrency)
        tasks = []
        for doc in request.documents:
            for q in request.questions:
                tasks.append(
                    self._execute_cell_with_semaphore(
                        semaphore=semaphore,
                        question=q,
                        document=doc,
                        request=request,
                        cell=result.cells[doc.document_id][q.question_id],
                    )
                )

        await asyncio.gather(*tasks, return_exceptions=True)

        # Aggregate stats
        for doc in request.documents:
            for q in request.questions:
                cell = result.cells[doc.document_id][q.question_id]
                if cell.status == CellStatus.COMPLETE:
                    result.completed_cells += 1
                elif cell.status == CellStatus.NOT_FOUND:
                    result.not_found_cells += 1
                elif cell.status == CellStatus.ERROR:
                    result.error_cells += 1

        result.latency_ms = (time.time() - start) * 1000
        logger.info(
            "grid_executed",
            total=result.total_cells,
            completed=result.completed_cells,
            not_found=result.not_found_cells,
            errors=result.error_cells,
            latency_ms=round(result.latency_ms, 1),
        )
        return result

    async def _execute_cell_with_semaphore(
        self,
        semaphore: asyncio.Semaphore,
        question: GridQuestion,
        document: GridDocument,
        request: GridRequest,
        cell: GridCell,
    ):
        async with semaphore:
            cell.status = CellStatus.RUNNING
            try:
                await asyncio.wait_for(
                    self._execute_cell(question, document, request, cell),
                    timeout=request.timeout_per_cell,
                )
            except asyncio.TimeoutError:
                cell.status = CellStatus.ERROR
                cell.error = "timeout"
            except Exception as e:
                cell.status = CellStatus.ERROR
                cell.error = str(e)
                logger.warning("grid_cell_error", doc=document.ticker, q=question.question_id, error=str(e))

    async def _execute_cell(
        self,
        question: GridQuestion,
        document: GridDocument,
        request: GridRequest,
        cell: GridCell,
    ):
        start = time.time()

        # Step 1: Retrieve relevant excerpts
        excerpts = await self._retrieve_excerpts(question, document, request)

        if not excerpts:
            cell.status = CellStatus.NOT_FOUND
            cell.answer = None
            cell.answer_type = AnswerType.NOT_FOUND
            cell.latency_ms = (time.time() - start) * 1000
            return

        # Step 2: Call LLM to extract answer
        prompt = self._CELL_PROMPT.format(
            question=question.question,
            display_label=document.display_label,
            time_period=question.time_period or "most recent available",
            excerpts=self._format_excerpts(excerpts),
        )

        raw_response = await self._call_llm(prompt)
        cell.raw_text = raw_response

        # Step 3: Parse response
        parsed = self._parse_cell_response(raw_response, question, document)
        cell.answer = parsed["answer"]
        cell.confidence = parsed["confidence"]

        # Step 4: Apply NOT_FOUND threshold
        if parsed["answer"] == "NOT_FOUND" or cell.confidence < request.confidence_threshold:
            cell.status = CellStatus.NOT_FOUND
            cell.answer = None
            cell.answer_type = AnswerType.NOT_FOUND
        else:
            cell.status = CellStatus.COMPLETE
            cell.normalized_value = self._normalize(parsed["answer"], question.answer_type, question.unit)
            # Build citations
            if parsed.get("source"):
                cell.citations.append(GridCitation(
                    document_id=document.document_id,
                    ticker=document.ticker,
                    section=parsed.get("source", ""),
                    excerpt=parsed.get("excerpt", ""),
                ))

        cell.latency_ms = (time.time() - start) * 1000

    async def _retrieve_excerpts(
        self,
        question: GridQuestion,
        document: GridDocument,
        request: GridRequest,
    ) -> list[dict]:
        """Retrieve relevant text chunks for a document/question pair."""
        if self.pipeline is None:
            return []

        try:
            # Build a targeted query with document filter
            query = question.question
            if question.time_period:
                query = f"{query} {question.time_period}"

            # Use dense search with document_id filter
            from app.core.retrieval.dense_search import DenseSearch
            if hasattr(self.pipeline, 'retrieval_orchestrator'):
                orch = self.pipeline.retrieval_orchestrator
                if hasattr(orch, 'dense_search') and orch.dense_search:
                    results = await orch.dense_search.search(
                        query=query,
                        top_k=5,
                        filters={"document_id": document.document_id},
                    )
                    return [{"text": r.text, "score": r.score, "metadata": r.metadata} for r in results]
        except Exception as e:
            logger.warning("grid_retrieval_failed", error=str(e))

        return []

    def _format_excerpts(self, excerpts: list[dict]) -> str:
        lines = []
        for i, exc in enumerate(excerpts, 1):
            meta = exc.get("metadata", {})
            page = meta.get("page_number", "")
            section = meta.get("section_name", "")
            header = f"[Excerpt {i}"
            if section:
                header += f" | {section}"
            if page:
                header += f" | p.{page}"
            header += "]"
            lines.append(f"{header}\n{exc['text']}")
        return "\n\n".join(lines)

    async def _call_llm(self, prompt: str) -> str:
        """Call the fast LLM for cell extraction."""
        if self.pipeline is None:
            return "NOT_FOUND\nCONFIDENCE: 0.0"

        try:
            router = self.pipeline.llm_router
            client = router.get_fast_client()
            response = await client.complete(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                temperature=0.0,
            )
            return response.content if hasattr(response, 'content') else str(response)
        except Exception as e:
            logger.warning("grid_llm_failed", error=str(e))
            return "NOT_FOUND\nCONFIDENCE: 0.0"

    def _parse_cell_response(
        self,
        raw: str,
        question: GridQuestion,
        document: GridDocument,
    ) -> dict:
        """Parse LLM response into structured cell data."""
        result = {
            "answer": "NOT_FOUND",
            "confidence": 0.0,
            "source": "",
            "excerpt": "",
        }

        for line in raw.strip().split("\n"):
            line = line.strip()
            if line.startswith("ANSWER:"):
                result["answer"] = line[7:].strip()
            elif line.startswith("CONFIDENCE:"):
                try:
                    result["confidence"] = float(line[11:].strip())
                except ValueError:
                    result["confidence"] = 0.5
            elif line.startswith("SOURCE:"):
                result["source"] = line[7:].strip()
            elif line.startswith("EXCERPT:"):
                result["excerpt"] = line[8:].strip()

        # Handle plain NOT_FOUND response
        if "NOT_FOUND" in raw.strip().upper() and result["answer"] == "NOT_FOUND":
            result["confidence"] = 0.0

        return result

    def _normalize(self, value: str, answer_type: AnswerType, unit: str) -> Any:
        """Attempt to normalize the answer to a typed value."""
        if answer_type == AnswerType.NUMERIC:
            return self._parse_numeric(value)
        elif answer_type == AnswerType.BOOLEAN:
            return value.lower() in ("yes", "true", "1", "confirmed")
        return value

    def _parse_numeric(self, value: str) -> float | None:
        """Extract float from strings like '$1.23B', '15.4%', '3.2x'."""
        import re
        multipliers = {"B": 1e9, "M": 1e6, "K": 1e3, "T": 1e12}
        clean = re.sub(r"[$,\s]", "", value.upper())
        match = re.search(r"(-?[\d.]+)([BMKT]?)", clean)
        if not match:
            return None
        try:
            num = float(match.group(1))
            suffix = match.group(2)
            return num * multipliers.get(suffix, 1.0)
        except ValueError:
            return None


# ── Streaming Grid Engine ──────────────────────────────────────────────────────

class StreamingGridEngine(GridEngine):
    """
    Grid engine variant that yields cell results as they complete.
    Used by the WebSocket endpoint for progressive rendering.
    """

    async def execute_streaming(self, request: GridRequest):
        """
        Async generator that yields GridCell objects as they complete.
        Also yields a final GridResult summary at the end.
        """
        start = time.time()
        result = GridResult(
            questions=request.questions,
            documents=request.documents,
            total_cells=len(request.questions) * len(request.documents),
        )

        for doc in request.documents:
            result.cells[doc.document_id] = {}
            for q in request.questions:
                result.cells[doc.document_id][q.question_id] = GridCell(
                    question_id=q.question_id,
                    document_id=doc.document_id,
                    answer_type=q.answer_type,
                    unit=q.unit,
                )

        semaphore = asyncio.Semaphore(request.max_concurrency)
        queue: asyncio.Queue = asyncio.Queue()

        async def run_cell_and_enqueue(question, document, cell):
            async with semaphore:
                cell.status = CellStatus.RUNNING
                try:
                    await asyncio.wait_for(
                        self._execute_cell(question, document, request, cell),
                        timeout=request.timeout_per_cell,
                    )
                except asyncio.TimeoutError:
                    cell.status = CellStatus.ERROR
                    cell.error = "timeout"
                except Exception as e:
                    cell.status = CellStatus.ERROR
                    cell.error = str(e)
                await queue.put(cell)

        tasks = []
        for doc in request.documents:
            for q in request.questions:
                cell = result.cells[doc.document_id][q.question_id]
                tasks.append(asyncio.create_task(run_cell_and_enqueue(q, doc, cell)))

        completed = 0
        total = len(tasks)

        while completed < total:
            cell = await queue.get()
            completed += 1
            yield {"type": "cell", "cell": cell, "progress": completed / total}

        await asyncio.gather(*tasks, return_exceptions=True)

        result.latency_ms = (time.time() - start) * 1000
        yield {"type": "result", "result": result}
