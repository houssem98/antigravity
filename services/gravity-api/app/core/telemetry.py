"""
Sentry + OpenTelemetry initialization (plan §5.2 / §6.10 / §6.13).

Soft-deps. Initialized once on app startup. No-op if env vars not set.

Sentry:
  SENTRY_DSN — DSN string from Sentry project settings
  SENTRY_TRACES_SAMPLE_RATE — float 0..1, default 0.1
  SENTRY_PROFILES_SAMPLE_RATE — float 0..1, default 0.1
  SENTRY_ENVIRONMENT — defaults to settings.app_env value

OpenTelemetry:
  OTEL_EXPORTER_OTLP_ENDPOINT — Tempo / Jaeger / Honeycomb collector URL
  OTEL_EXPORTER_OTLP_HEADERS — comma-separated key=value pairs (optional)
  OTEL_SERVICE_NAME — defaults to "gravity-api"

Both auto-attach W3C traceparent (interop with §6.13 api.ts client).
"""

from __future__ import annotations

import os

import structlog

logger = structlog.get_logger()


# ─── Sentry ───────────────────────────────────────────────────────────────────

def init_sentry() -> bool:
    """Initialize Sentry if SENTRY_DSN is set. Returns True if initialized."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        logger.info("sentry_skip", reason="no SENTRY_DSN")
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logger.warning("sentry_skip", reason="sentry-sdk not installed")
        return False

    traces_sr = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    profiles_sr = float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.1"))
    env = os.getenv("SENTRY_ENVIRONMENT", os.getenv("APP_ENV", "development"))

    sentry_sdk.init(
        dsn=dsn,
        environment=env,
        traces_sample_rate=traces_sr,
        profiles_sample_rate=profiles_sr,
        send_default_pii=False,        # plan §3.6 / GDPR — no PII to Sentry
        attach_stacktrace=True,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
        ],
    )
    logger.info("sentry_init", env=env, traces=traces_sr, profiles=profiles_sr)
    return True


# ─── OpenTelemetry ────────────────────────────────────────────────────────────

_OTEL_INITIALIZED = False


def init_otel(app=None) -> bool:
    """
    Initialize OpenTelemetry tracer + auto-instrument FastAPI + httpx.
    No-op if OTEL_EXPORTER_OTLP_ENDPOINT not set.

    Pass `app` to instrument FastAPI; safe to call without it.
    """
    global _OTEL_INITIALIZED
    if _OTEL_INITIALIZED:
        return True

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        logger.info("otel_skip", reason="no OTEL_EXPORTER_OTLP_ENDPOINT")
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
    except ImportError:
        logger.warning("otel_skip", reason="opentelemetry-* not installed")
        return False

    service_name = os.getenv("OTEL_SERVICE_NAME", "gravity-api")
    headers_raw = os.getenv("OTEL_EXPORTER_OTLP_HEADERS", "")
    headers = {}
    if headers_raw:
        for part in headers_raw.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                headers[k.strip()] = v.strip()

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    # Auto-instrument FastAPI + httpx (so traceparent flows downstream).
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        HTTPXClientInstrumentor().instrument()
    except Exception as e:
        logger.warning("otel_httpx_instrument_failed", error=str(e))

    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            FastAPIInstrumentor.instrument_app(app)
        except Exception as e:
            logger.warning("otel_fastapi_instrument_failed", error=str(e))

    _OTEL_INITIALIZED = True
    logger.info("otel_init", service=service_name, endpoint=endpoint[:60])
    return True


def init_telemetry(app=None) -> dict:
    """Initialize both Sentry and OTEL. Returns a status dict."""
    sentry_on = init_sentry()
    otel_on = init_otel(app=app)
    return {"sentry": sentry_on, "otel": otel_on}
