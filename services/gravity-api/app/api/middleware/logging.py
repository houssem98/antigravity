"""
Gravity Search — Request Logging Middleware
Structured per-request logging with trace ID propagation.
Logs to stdout (structlog) and optionally to the SearchLog PostgreSQL audit table.
"""

import time
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = structlog.get_logger()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Logs every HTTP request with timing, status, and trace ID.
    Skips health/readiness probes to reduce noise.

    Note: Trace ID injection is already handled in main.py's add_trace_id_and_timing.
    This middleware adds structured logging of completed requests to stdout.
    """

    SKIP_PATHS = {"/health", "/ready", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        start = time.perf_counter()
        trace_id = request.headers.get("X-Trace-ID", "")

        response = await call_next(request)

        latency_ms = round((time.perf_counter() - start) * 1000, 1)

        logger.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            latency_ms=latency_ms,
            trace_id=trace_id,
            client_ip=request.client.host if request.client else "unknown",
        )

        return response
