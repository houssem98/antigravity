"""
Gravity Search — Base Kafka Worker
Abstract base class for all stream-processing workers.
Implements the run-loop, error handling, dead-letter routing, and metrics.

Worker lifecycle:
  1. setup()   → called once before the consume loop (warm connections, models)
  2. process() → called for every message in the batch (override this)
  3. teardown()→ called on graceful shutdown

Flink conceptual equivalents:
  - Worker class  ↔  Flink StreamExecutionEnvironment
  - batch loop    ↔  Flink DataStream map/flatMap
  - consumer group ↔  Flink Kafka source with consumer group
  - dead-letter   ↔  Flink side output
"""

from __future__ import annotations

import asyncio
import os
import signal
import structlog
from abc import ABC, abstractmethod
from typing import Generic, Type, TypeVar

from pydantic import BaseModel

from app.ingestion.kafka_client import (
    consume_messages,
    make_consumer,
    publish,
)
from app.ingestion.topics import DeadLetterMessage, Topics

logger = structlog.get_logger()

T = TypeVar("T", bound=BaseModel)


class BaseWorker(ABC, Generic[T]):
    """
    Generic Kafka stream worker.

    Subclass and implement:
      - input_topic   : str
      - input_schema  : Type[T]
      - group_id      : str
      - setup()       : async setup (load models, open DB connections)
      - process(msg)  : async process one message
      - teardown()    : async cleanup
    """

    # ── Override in subclass ──────────────────────────────────────────────
    input_topic: str
    input_schema: Type[T]
    group_id: str

    # ── Config (can override) ─────────────────────────────────────────────
    batch_size: int = 10
    max_concurrency: int = 4   # override via WORKER_CONCURRENCY env var

    def __init__(self) -> None:
        self._running = False
        self._sem: asyncio.Semaphore | None = None
        concurrency = int(os.getenv("WORKER_CONCURRENCY", str(self.max_concurrency)))
        self._sem = asyncio.Semaphore(concurrency)

    # ── Lifecycle hooks ───────────────────────────────────────────────────

    async def setup(self) -> None:
        """Override to initialise models, DB connections, etc."""

    async def teardown(self) -> None:
        """Override to close connections on shutdown."""

    @abstractmethod
    async def process(self, message: T) -> None:
        """Process a single message. Raise on unrecoverable error."""

    # ── Internal helpers ──────────────────────────────────────────────────

    async def _process_with_dlq(self, message: T, attempt: int = 1) -> None:
        """Wrap process() with dead-letter routing on failure."""
        try:
            async with self._sem:
                await self.process(message)
        except Exception as exc:
            logger.error(
                "worker_process_error",
                worker=self.__class__.__name__,
                error=type(exc).__name__,
                detail=str(exc)[:500],
                attempt=attempt,
            )
            # Route to dead-letter topic
            dlq_msg = DeadLetterMessage(
                original_topic=self.input_topic,
                original_message_id=getattr(message, "message_id", "unknown"),
                original_payload=message.model_dump_json(),
                error_type=type(exc).__name__,
                error_detail=str(exc)[:2000],
                worker=self.__class__.__name__,
                attempt=attempt,
            )
            await publish(Topics.DEAD_LETTER, dlq_msg, key=self.input_topic)

    # ── Main run loop ─────────────────────────────────────────────────────

    async def run(self) -> None:
        """Start the worker. Blocks until SIGTERM/SIGINT."""
        self._running = True

        # Graceful shutdown handler
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, lambda: asyncio.create_task(self._stop()))
            except (NotImplementedError, RuntimeError):
                pass  # Windows doesn't support add_signal_handler fully

        logger.info(
            "worker_starting",
            worker=self.__class__.__name__,
            topic=self.input_topic,
            group_id=self.group_id,
        )

        await self.setup()

        consumer = make_consumer(
            topics=[self.input_topic],
            group_id=self.group_id,
        )

        if consumer is None:
            logger.warning(
                "kafka_unavailable_worker_sleeping",
                worker=self.__class__.__name__,
            )
            # In dev without Kafka, sleep forever (worker stays alive but idle)
            while self._running:
                await asyncio.sleep(5)
            return

        try:
            async for batch in consume_messages(consumer, self.input_schema, self.batch_size):
                if not self._running:
                    break
                # Process batch concurrently, bounded by semaphore
                tasks = [self._process_with_dlq(msg) for msg in batch]
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            await self.teardown()
            logger.info("worker_stopped", worker=self.__class__.__name__)

    async def _stop(self) -> None:
        logger.info("worker_shutdown_signal", worker=self.__class__.__name__)
        self._running = False
