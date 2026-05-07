"""Gravity Search — Document Routes
POST /v1/documents/ingest  — upload and index a document
GET  /v1/documents/{id}    — fetch document metadata
GET  /v1/documents         — list documents with pagination
"""

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, Response
from typing import Any

from app.api.middleware.auth import require_auth
from app.api.middleware.rate_limit import check_rate_limit

logger = structlog.get_logger()
router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/html",
}
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


async def get_db():
    from app.db.postgres import async_session
    async with async_session() as session:
        yield session


_ingestion_pipeline = None

def get_ingestion_pipeline():
    """Lazy-init the ingestion pipeline (cached after first call)."""
    global _ingestion_pipeline
    if _ingestion_pipeline is None:
        from app.ingestion.pipeline import IngestionPipeline
        _ingestion_pipeline = IngestionPipeline.create()
    return _ingestion_pipeline


@router.post("/documents/ingest")
async def ingest_document(
    response: Response,
    file: UploadFile = File(...),
    ticker: str = Form(default=""),
    company_name: str = Form(default=""),
    auth: dict = Depends(require_auth)
):
    """
    Upload and ingest a document (PDF, DOCX, TXT, HTML).

    Multipart form fields:
      - file: the document file
      - ticker: optional stock ticker (e.g. AAPL)
      - company_name: optional company name override

    Returns:
      {
        "document_id": str,
        "chunk_count": int,
        "ticker": str,
        "filing_type": str,
        "sections_found": int,
        "entities_found": dict,
        "indexing": dict
      }
    """
    # Rate limit check
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    # Validate content type
    content_type = file.content_type or "text/plain"
    base_type = content_type.split(";")[0].strip()
    if base_type not in ALLOWED_CONTENT_TYPES:
        # Allow text/* and application/pdf broadly
        if not (base_type.startswith("text/") or base_type == "application/pdf"):
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type: {content_type}. "
                       f"Supported: PDF, DOCX, TXT, HTML",
            )

    # Read and size-check the file
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content) / 1024 / 1024:.1f} MB). Max: 50 MB",
        )
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    # Reset stream position after reading
    await file.seek(0)

    logger.info(
        "document_ingest_request",
        filename=file.filename,
        content_type=content_type,
        size_bytes=len(content),
        ticker=ticker,
    )

    pipeline = get_ingestion_pipeline()
    result = await pipeline.ingest_bytes(
        content=content,
        content_type=base_type,
        filename=file.filename or "upload.bin",
        ticker=ticker,
        company_name=company_name,
    )

    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])

    return result


@router.post("/transcripts/ingest")
async def ingest_earnings_transcript(
    response: Response,
    ticker: str = Query(..., description="Stock ticker, e.g. AAPL"),
    company_name: str = Query(default="", description="Full company name (optional)"),
    quarter: str = Query(default="", description="Quarter string e.g. 'Q3 2024'"),
    auth: dict = Depends(require_auth),
):
    """
    Fetch and ingest an earnings call transcript for a company.

    Sources tried in order:
      1. Alpha Vantage EARNINGS_CALL_TRANSCRIPT (if ALPHA_VANTAGE_API_KEY is set)
      2. Motley Fool public transcripts (HTML scrape, no key required)

    Returns same schema as /v1/documents/ingest.
    """
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    from app.config import settings
    from app.ingestion.sources.earnings import EarningsTranscriptSource

    source = EarningsTranscriptSource(
        alpha_vantage_key=getattr(settings, "alpha_vantage_api_key", "") or "",
        quartr_api_key=getattr(settings, "quartr_api_key", "") or "",
    )

    logger.info("transcript_ingest_request", ticker=ticker, quarter=quarter)

    transcript = await source.fetch_transcript(
        ticker=ticker.upper(),
        company_name=company_name or ticker.upper(),
        quarter=quarter,
    )

    if not transcript.get("full_text"):
        raise HTTPException(
            status_code=404,
            detail=f"No transcript found for {ticker.upper()} {quarter or '(latest)'}. "
                   "Try providing a quarter like 'Q3 2024'.",
        )

    # Build a well-structured document from the transcript
    period = transcript.get("quarter") or quarter or "Recent"
    date_str = transcript.get("date", "")
    speaker_count = len(transcript.get("speakers", []))

    # Prepend metadata header so the chunker extracts it correctly
    doc_text = (
        f"[Ticker: {ticker.upper()}] [Filing: earnings_transcript] "
        f"[Period: {period}] [Date: {date_str}]\n\n"
        f"{transcript['company_name']} Earnings Call — {period}\n\n"
        f"PREPARED REMARKS:\n{transcript['sections'].get('prepared_remarks', '')}\n\n"
        f"Q&A SESSION:\n{transcript['sections'].get('qa_session', '')}"
    )

    pipeline = get_ingestion_pipeline()
    result = await pipeline.ingest_bytes(
        content=doc_text.encode("utf-8"),
        content_type="text/plain",
        filename=f"{ticker.upper()}_{period.replace(' ', '_')}_earnings_transcript.txt",
        ticker=ticker.upper(),
        company_name=transcript["company_name"],
        filing_type="earnings_transcript",
        filing_date=date_str,
    )

    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])

    return {
        **result,
        "transcript_meta": {
            "ticker": ticker.upper(),
            "company_name": transcript["company_name"],
            "quarter": period,
            "date": date_str,
            "speaker_turns": speaker_count,
            "has_qa": bool(transcript["sections"].get("qa_session")),
            "source": transcript.get("source", "unknown"),
            "source_url": transcript.get("source_url", ""),
        },
    }


@router.get("/documents/kpis/{ticker}")
async def extract_kpis(
    ticker: str,
    max_passages: int = Query(default=20, ge=1, le=50),
    response: Response = None,
    auth: dict = Depends(require_auth),
):
    """
    Extract segment-level KPIs for a ticker from indexed SEC filings.

    Queries the Qdrant vector store for KPI-relevant passages (segment revenue,
    margins, units, subscribers, etc.) and runs LLM extraction over the top hits.

    Returns a KPITable with every value hyperlinked to its source passage.
    """
    from app.dependencies import get_search_pipeline
    from app.core.kpi_extractor import KPIExtractor

    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    if response:
        for k, v in headers.items():
            response.headers[k] = v

    ticker_up = ticker.upper()
    logger.info("kpi_extract_request", ticker=ticker_up)

    # Retrieve KPI-relevant passages from Qdrant
    pipeline = get_search_pipeline()

    kpi_queries = [
        f"{ticker_up} revenue by segment",
        f"{ticker_up} operating income margin segment",
        f"{ticker_up} subscribers units sold active users",
        f"{ticker_up} average selling price ARPU NRR",
        f"{ticker_up} gross profit gross margin segment results",
    ]

    all_passages: list[dict] = []
    try:
        import asyncio
        from app.core.retrieval.dense_search import DenseSearch

        dense: DenseSearch = pipeline.retrieval_orchestrator.dense_search
        results = await asyncio.gather(
            *[
                dense.search(
                    query_text=q,
                    ticker_filter=ticker_up,
                    top_k=8,
                )
                for q in kpi_queries
            ],
            return_exceptions=True,
        )
        seen_ids: set[str] = set()
        for r in results:
            if isinstance(r, list):
                for hit in r:
                    pid = hit.get("id", hit.get("chunk_id", ""))
                    if pid and pid not in seen_ids:
                        seen_ids.add(pid)
                        all_passages.append(hit)
    except Exception as e:
        logger.warning("kpi_retrieval_failed", ticker=ticker_up, error=str(e))

    if not all_passages:
        raise HTTPException(
            status_code=404,
            detail=f"No indexed passages found for {ticker_up}. Run /v1/documents/ingest-sec first.",
        )

    # Extract KPIs with best available LLM
    try:
        from app.dependencies import get_llm_router
        router_llm = get_llm_router()
        llm_client = router_llm.get_fast_client()
    except Exception:
        llm_client = None

    extractor = KPIExtractor(llm_client=llm_client)
    table = await extractor.extract(
        ticker=ticker_up,
        passages=all_passages,
        max_passages=max_passages,
    )

    return table.to_dict()


@router.post("/documents/ingest-sec")
async def ingest_sec_filings(
    response: Response,
    ticker: str = Query(..., description="Stock ticker, e.g. AAPL"),
    filing_types: str = Query(default="10-K,10-Q", description="Comma-separated filing types"),
    max_filings: int = Query(default=10, ge=1, le=100, description="Max filings per type"),
    auth: dict = Depends(require_auth),
):
    """
    Fetch and ingest SEC EDGAR filings for a ticker on demand.
    Useful for historical backfill (2011–now).

    Query params:
      - ticker: stock ticker (e.g. AAPL, TSLA, MSFT)
      - filing_types: comma-separated list (default: 10-K,10-Q)
      - max_filings: how many filings per type to ingest (max 100)

    Returns ingestion summary for each filing found.
    """
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    from app.ingestion.sources.sec_edgar import SECEdgarSource
    from app.db.redis import redis_client

    types = [t.strip().upper() for t in filing_types.split(",") if t.strip()]
    if not types:
        types = ["10-K", "10-Q"]

    logger.info("sec_backfill_request", ticker=ticker, types=types, max_filings=max_filings)

    source = SECEdgarSource(redis_client=redis_client)
    pipeline = get_ingestion_pipeline()

    filings = await source.fetch_company_filings(
        ticker=ticker.upper(),
        filing_types=types,
        max_filings=max_filings,
    )

    if not filings:
        return {
            "ticker": ticker.upper(),
            "filings_found": 0,
            "results": [],
            "message": "No filings found. Check ticker or try edgartools: pip install edgartools",
        }

    results = []
    for filing in filings:
        url = filing.get("url", "")
        if not url:
            results.append({"filing": filing, "status": "skipped", "reason": "no_url"})
            continue
        try:
            result = await pipeline.ingest_from_url(
                url=url,
                filing_type=filing.get("filing_type", ""),
                ticker=filing.get("ticker", ticker.upper()),
                company_name=filing.get("company_name", ""),
                filing_date=filing.get("filing_date", ""),
            )
            results.append({
                "filing_type": filing.get("filing_type"),
                "filing_date": filing.get("filing_date"),
                "accession": filing.get("accession_number"),
                "status": "ok" if "error" not in result else "error",
                "chunk_count": result.get("chunk_count", 0),
                "indexing": result.get("indexing", {}),
            })
        except Exception as e:
            results.append({
                "filing_type": filing.get("filing_type"),
                "filing_date": filing.get("filing_date"),
                "status": "error",
                "error": str(e),
            })

    ingested = sum(1 for r in results if r.get("status") == "ok")
    logger.info("sec_backfill_complete", ticker=ticker, found=len(filings), ingested=ingested)

    return {
        "ticker": ticker.upper(),
        "filings_found": len(filings),
        "ingested": ingested,
        "results": results,
    }


@router.post("/documents/ingest-sec-bulk")
async def ingest_sec_bulk(
    response: Response,
    tickers: str = Query(..., description="Comma-separated tickers, e.g. AAPL,MSFT,NVDA"),
    filing_types: str = Query(default="10-K,10-Q", description="Comma-separated filing types"),
    max_filings_per_ticker: int = Query(default=20, ge=1, le=100),
    workers: int = Query(default=8, ge=1, le=16, description="Parallel worker count"),
    auth: dict = Depends(require_auth),
):
    """
    Bulk-ingest SEC filings for multiple tickers in parallel.

    Uses 8 async workers bounded by EDGAR's 10 req/s rate limit.
    Supports resume: already-indexed filings are skipped automatically.

    Example:
        POST /v1/documents/ingest-sec-bulk?tickers=AAPL,MSFT,NVDA,TSLA&workers=8

    Returns a summary report once all filings are processed.
    """
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    from app.ingestion.sources.sec_edgar import SECEdgarSource
    from app.ingestion.parallel_ingest import ParallelIngestor
    from app.db.redis import redis_client

    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        raise HTTPException(status_code=400, detail="At least one ticker required")

    types = [t.strip().upper() for t in filing_types.split(",") if t.strip()] or ["10-K", "10-Q"]

    logger.info("sec_bulk_ingest_request", tickers=len(ticker_list), types=types, workers=workers)

    source = SECEdgarSource(redis_client=redis_client)
    pipeline = get_ingestion_pipeline()
    ingestor = ParallelIngestor(pipeline=pipeline, edgar_source=source)

    report = await ingestor.ingest_tickers(
        tickers=ticker_list,
        filing_types=types,
        max_filings_per_ticker=max_filings_per_ticker,
        workers=workers,
    )

    return {
        "tickers": ticker_list,
        "total_filings": report.total_filings,
        "succeeded": report.succeeded,
        "failed": report.failed,
        "skipped": report.skipped,
        "total_chunks": report.total_chunks,
        "elapsed_s": round(report.elapsed_s, 1),
        "rate_filings_per_hour": round(report.total_filings / max(report.elapsed_s / 3600, 0.001)),
        "errors": report.errors[:20],
        "summary": report.summary(),
    }


@router.get("/documents/{document_id}")
async def get_document(
    document_id: str,
    response: Response,
    db: Any = Depends(get_db),
    auth: dict = Depends(require_auth)
):
    """
    Retrieve metadata for a specific document by ID.

    Returns document metadata including ticker, filing type, chunk count, status.
    """
    try:
        # Rate limit check
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        for k, v in headers.items():
            response.headers[k] = v

        from app.db.models import Document
        from sqlalchemy import select
        result = await db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail=f"Document {document_id} not found")

        return {
            "id": doc.id,
            "ticker": doc.ticker,
            "company_name": doc.company_name,
            "filing_type": doc.filing_type,
            "filing_date": str(doc.filing_date) if doc.filing_date else None,
            "title": doc.title,
            "source_url": doc.source_url,
            "page_count": doc.page_count,
            "chunk_count": doc.chunk_count,
            "status": doc.status,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("get_document_failed", document_id=document_id, error=str(e))
        raise HTTPException(status_code=503, detail="Database unavailable")


@router.get("/documents")
async def list_documents(
    response: Response,
    ticker: str = Query(default=""),
    filing_type: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Any = Depends(get_db),
    auth: dict = Depends(require_auth)
):
    """
    List ingested documents with optional filtering and pagination.

    Query params:
      - ticker: filter by stock ticker
      - filing_type: filter by type (10-K, 10-Q, 8-K, earnings)
      - limit: page size (1-100, default 20)
      - offset: pagination offset
    """
    try:
        # Rate limit check
        headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
        for k, v in headers.items():
            response.headers[k] = v

        from app.db.models import Document
        from sqlalchemy import and_, select

        filters = []
        if ticker:
            filters.append(Document.ticker == ticker.upper())
        if filing_type:
            filters.append(Document.filing_type == filing_type.upper())

        query = select(Document).order_by(Document.created_at.desc())
        if filters:
            query = query.where(and_(*filters))
        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        docs = result.scalars().all()

        return {
            "documents": [
                {
                    "id": doc.id,
                    "ticker": doc.ticker,
                    "company_name": doc.company_name,
                    "filing_type": doc.filing_type,
                    "filing_date": str(doc.filing_date) if doc.filing_date else None,
                    "title": doc.title,
                    "chunk_count": doc.chunk_count,
                    "status": doc.status,
                    "created_at": doc.created_at.isoformat() if doc.created_at else None,
                }
                for doc in docs
            ],
            "total": len(docs),
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.warning("list_documents_failed", error=str(e))
        raise HTTPException(status_code=503, detail="Database unavailable")
