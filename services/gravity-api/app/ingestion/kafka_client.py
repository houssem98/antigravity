"""
Gravity Search — Kafka Client Factory
Thin async wrappers around aiokafka for producing and consuming messages.

Producer: singleton per process, flushed on shutdown.
Consumer: created fresh per worker, with consumer-group semantics for at-least-once delivery.

Env vars (all optional — Kafka disabled when KAFKA_BOOTSTRAP_SERVERS is unset):
  KAFKA_BOOTSTRAP_SERVERS  e.g. "localhost:9093" or "kafka:9092"
  KAFKA_SECURITY_PROTOCOL  PLAINTEXT (default) | SSL | SASL_SSL
  KAFKA_SASL_MECHANISM     PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512 (optional)
  KAFKA_SASL_USERNAME      (optional)
  KAFKA_SASL_PASSWORD      (optional)
"""

from __future__ import annotations

import json
import os
import structlog
from typing import AsyncIterator, Type, TypeVar

from pydantic import BaseModel

logger = structlog.get_logger()

T = TypeVar("T", bound=BaseModel)

# Kafka is optional — missing aiokafka degrades gracefully
try:
    from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
    from aiokafka.errors import KafkaConnectionError, KafkaTimeoutError
    _KAFKA_AVAILABLE = True
except ImportError:
    _KAFKA_AVAILABLE = False
    logger.warning("aiokafka not installed — Kafka integration disabled. pip install aiokafka")


def _bootstrap_servers() -> str | None:
    return os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip() or None


def _is_enabled() -> bool:
    return _KAFKA_AVAILABLE and bool(_bootstrap_servers())


def _common_kwargs() -> dict:
    """Build aiokafka kwargs from env vars, including SASL if configured."""
    servers = _bootstrap_servers()
    if not servers:
        return {}
    kwargs: dict = {
        "bootstrap_servers": servers,
        "security_protocol": os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
    }
    mechanism = os.getenv("KAFKA_SASL_MECHANISM", "")
    if mechanism:
        kwargs["sasl_mechanism"] = mechanism
        kwargs["sasl_plain_username"] = os.getenv("KAFKA_SASL_USERNAME", "")
        kwargs["sasl_plain_password"] = os.getenv("KAFKA_SASL_PASSWORD", "")
    return kwargs


# ── Producer ─────────────────────────────────────────────────────────────

_producer: "AIOKafkaProducer | None" = None


async def get_producer() -> "AIOKafkaProducer | None":
    """Return (and lazily start) the module-level singleton producer."""
    global _producer
    if not _is_enabled():
        return None
    if _producer is None:
        _producer = AIOKafkaProducer(
            **_common_kwargs(),
            value_serializer=lambda v: json.dumps(v).encode(),
            key_serializer=lambda k: k.encode() if k else None,
            compression_type="gzip",
            acks="all",                 # wait for all in-sync replicas
            enable_idempotence=True,    # exactly-once producer semantics
            request_timeout_ms=30_000,
            max_request_size=10_485_760,  # 10 MB
        )
        await _producer.start()
        logger.info("kafka_producer_started", brokers=_bootstrap_servers())
    return _producer


async def close_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
        logger.info("kafka_producer_stopped")


async def publish(
    topic: str,
    message: BaseModel,
    key: str | None = None,
) -> bool:
    """
    Publish a Pydantic model to a Kafka topic.

    Args:
        topic:   Kafka topic name (e.g. "gravity.raw-documents")
        message: Any Pydantic model — serialised to JSON
        key:     Optional partition key (ticker, source, …)

    Returns True on success, False if Kafka is unavailable.
    """
    producer = await get_producer()
    if producer is None:
        logger.debug("kafka_publish_skipped_no_producer", topic=topic)
        return False
    try:
        await producer.send_and_wait(
            topic,
            value=message.model_dump(),
            key=key,
        )
        logger.debug("kafka_published", topic=topic, key=key, msg_type=type(message).__name__)
        return True
    except Exception as e:
        logger.warning("kafka_publish_failed", topic=topic, error=str(e))
        return False


# ── Consumer factory ──────────────────────────────────────────────────────

def make_consumer(
    topics: list[str],
    group_id: str,
    auto_offset_reset: str = "earliest",
) -> "AIOKafkaConsumer | None":
    """
    Create a new AIOKafkaConsumer for the given topics and consumer group.
    Returns None if Kafka is not available.

    The caller is responsible for starting, running, and stopping the consumer.
    """
    if not _is_enabled():
        return None
    consumer = AIOKafkaConsumer(
        *topics,
        **_common_kwargs(),
        group_id=group_id,
        auto_offset_reset=auto_offset_reset,
        enable_auto_commit=False,           # manual commit after processing
        max_poll_records=10,
        fetch_max_bytes=52_428_800,         # 50 MB
        value_deserializer=lambda raw: json.loads(raw.decode()),
    )
    return consumer


async def consume_messages(
    consumer: "AIOKafkaConsumer",
    message_class: Type[T],
    batch_size: int = 10,
) -> AsyncIterator[list[T]]:
    """
    Async generator that yields batches of typed Pydantic messages.
    Commits offsets only after each batch is successfully yielded.

    Usage:
        async for batch in consume_messages(consumer, RawDocumentMessage):
            for msg in batch:
                await process(msg)
    """
    await consumer.start()
    try:
        while True:
            batch_raw = await consumer.getmany(timeout_ms=500, max_records=batch_size)
            if not batch_raw:
                continue
            parsed: list[T] = []
            for tp, records in batch_raw.items():
                for record in records:
                    try:
                        parsed.append(message_class.model_validate(record.value))
                    except Exception as e:
                        logger.warning(
                            "kafka_parse_error",
                            topic=tp.topic,
                            partition=tp.partition,
                            offset=record.offset,
                            error=str(e),
                        )
            if parsed:
                yield parsed
            await consumer.commit()
    finally:
        await consumer.stop()
