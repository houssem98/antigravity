"""
PDF Deep-Fetch for Web Search Results (plan §6.4).

When a web search (Tavily / Exa / Sonar / Firecrawl) returns a URL whose
content-type is application/pdf, the snippet is usually too short to be
useful. This module fetches the PDF, extracts full text via pymupdf,
chunks it, and produces RetrievalResult objects suitable for fusion.

Free path uses pymupdf (already in requirements). Paid path can swap in
Reducto / LlamaParse for table-aware bbox extraction — same interface.

Constraints:
  - Hard cap on PDF size (default 25MB)
  - Hard cap on pages extracted (default 200)
  - Per-domain semaphore to avoid hammering one server
  - Authority score derived from URL via fusion._DOMAIN_QUALITY
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import structlog

from app.core.retrieval.fusion import RetrievalResult, get_source_quality

logger = structlog.get_logger()


_DEFAULT_TIMEOUT = 20.0
_MAX_BYTES = 25 * 1024 * 1024     # 25MB
_MAX_PAGES = 200
_PER_DOMAIN_SEM_LIMIT = 2


@dataclass
class FetchedPDF:
    url: str
    title: str = ""
    text: str = ""
    page_count: int = 0
    bytes_size: int = 0
    content_type: str = ""


# Per-domain semaphores keep one slow server from blocking everything.
_DOMAIN_SEMS: dict[str, asyncio.Semaphore] = {}


def _domain_sem(url: str) -> asyncio.Semaphore:
    host = urlparse(url).netloc.lower()
    sem = _DOMAIN_SEMS.get(host)
    if sem is None:
        sem = asyncio.Semaphore(_PER_DOMAIN_SEM_LIMIT)
        _DOMAIN_SEMS[host] = sem
    return sem


async def fetch_pdf(
    url: str,
    timeout: float = _DEFAULT_TIMEOUT,
    max_bytes: int = _MAX_BYTES,
    user_agent: str = "GravitySearch/1.0 (gravity@antigravity.ai)",
) -> Optional[FetchedPDF]:
    """Download a PDF URL with size cap. Returns None on failure or if not a PDF."""
    import httpx
    async with _domain_sem(url):
        try:
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True,
            ) as client:
                async with client.stream(
                    "GET", url, headers={"User-Agent": user_agent},
                ) as resp:
                    if resp.status_code != 200:
                        logger.debug("pdf_fetch_status", url=url, status=resp.status_code)
                        return None
                    ctype = resp.headers.get("content-type", "").lower()
                    if "pdf" not in ctype and not url.lower().endswith(".pdf"):
                        logger.debug("pdf_fetch_not_pdf", url=url, content_type=ctype)
                        return None
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            logger.warning(
                                "pdf_fetch_too_large", url=url,
                                bytes=len(buf), cap=max_bytes,
                            )
                            return None
                    return FetchedPDF(
                        url=url, bytes_size=len(buf), content_type=ctype, text=bytes(buf),
                    ) if False else FetchedPDF(
                        url=url, bytes_size=len(buf), content_type=ctype, text="",
                        # Stash raw bytes via title slot temporarily; extract_text consumes.
                        # (Avoid adding a non-stringly-typed field here for keeps.)
                    )
        except Exception as e:
            logger.debug("pdf_fetch_failed", url=url, error=str(e))
            return None


# Single-call helper that fetches + extracts in one shot. Production code path.
async def fetch_and_extract(
    url: str,
    max_pages: int = _MAX_PAGES,
    timeout: float = _DEFAULT_TIMEOUT,
    max_bytes: int = _MAX_BYTES,
) -> Optional[FetchedPDF]:
    import httpx
    async with _domain_sem(url):
        try:
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True,
            ) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"},
                )
            if resp.status_code != 200:
                logger.debug("pdf_fetch_status", url=url, status=resp.status_code)
                return None
            ctype = resp.headers.get("content-type", "").lower()
            if "pdf" not in ctype and not url.lower().endswith(".pdf"):
                return None
            content = resp.content
            if len(content) > max_bytes:
                logger.warning("pdf_fetch_too_large", url=url, bytes=len(content))
                return None
        except Exception as e:
            logger.debug("pdf_fetch_failed", url=url, error=str(e))
            return None

    text, title, pages = _extract_text_pymupdf(content, max_pages)
    if not text.strip():
        return None
    return FetchedPDF(
        url=url, title=title, text=text, page_count=pages,
        bytes_size=len(content), content_type=ctype,
    )


def _extract_text_pymupdf(content: bytes, max_pages: int) -> tuple[str, str, int]:
    """Extract text + title + page count from PDF bytes via pymupdf."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("pymupdf_not_installed")
        return "", "", 0
    try:
        with fitz.open(stream=content, filetype="pdf") as doc:
            n_pages = min(len(doc), max_pages)
            pages = [doc[i].get_text() for i in range(n_pages)]
            title = (doc.metadata or {}).get("title", "") or ""
            return "\n\n".join(pages).strip(), title, n_pages
    except Exception as e:
        logger.debug("pdf_extract_failed", error=str(e))
        return "", "", 0


def _chunk_pdf_text(text: str, max_chars: int = 1500) -> list[str]:
    """Sentence-aware splitter — keeps chunks roughly <max_chars."""
    import re
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    chunks: list[str] = []
    current = ""
    for s in sentences:
        if len(current) + len(s) + 1 > max_chars and current:
            chunks.append(current.strip())
            current = s
        else:
            current = f"{current} {s}".strip() if current else s
    if current.strip():
        chunks.append(current.strip())
    return chunks


async def web_pdf_to_results(
    urls_and_titles: list[tuple[str, str]],
    chunk_chars: int = 1500,
    max_chunks_per_doc: int = 30,
    concurrency: int = 4,
) -> list[RetrievalResult]:
    """
    Fetch each PDF, chunk it, return RetrievalResult objects.

    Inputs: [(url, title), ...] from web search results.
    Behaviour: failures silent (just dropped). Sucessful PDFs become 1..N
    RetrievalResult chunks with score derived from URL authority and chunk
    position (earlier = higher score).
    """
    sem = asyncio.Semaphore(concurrency)

    async def _one(url_title: tuple[str, str]) -> list[RetrievalResult]:
        url, title = url_title
        async with sem:
            pdf = await fetch_and_extract(url)
        if pdf is None:
            return []
        title = pdf.title or title or url.rsplit("/", 1)[-1]
        chunks = _chunk_pdf_text(pdf.text, max_chars=chunk_chars)[:max_chunks_per_doc]
        if not chunks:
            return []
        quality = get_source_quality(source_url=url)
        out: list[RetrievalResult] = []
        for i, chunk_text in enumerate(chunks):
            # Earlier chunks score slightly higher (1.0, 0.97, 0.94, ...)
            rank_factor = max(0.5, 1.0 - 0.03 * i)
            out.append(RetrievalResult(
                chunk_id=f"webpdf::{url}::{i}",
                document_id=f"webpdf::{url}",
                text=chunk_text,
                score=float(rank_factor * (quality / 10.0)),
                metadata={
                    "source_url": url,
                    "url": url,
                    "page_count": pdf.page_count,
                    "is_web_pdf": True,
                    "content_type": pdf.content_type,
                },
                document_title=title,
                document_type="web_pdf",
                source_quality=quality,
                page=None,
            ))
        return out

    nested = await asyncio.gather(
        *[_one(item) for item in urls_and_titles],
        return_exceptions=True,
    )
    flat: list[RetrievalResult] = []
    for n in nested:
        if isinstance(n, list):
            flat.extend(n)
        elif isinstance(n, Exception):
            logger.debug("web_pdf_task_failed", error=str(n))

    logger.info(
        "web_pdf_results",
        urls_in=len(urls_and_titles),
        results_out=len(flat),
        unique_pdfs=len(set(r.document_id for r in flat)),
    )
    return flat
