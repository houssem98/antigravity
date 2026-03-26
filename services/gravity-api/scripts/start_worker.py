#!/usr/bin/env python3
"""
Gravity Search — Worker Entrypoint
Starts one of the Kafka stream processing workers.

Usage:
    python scripts/start_worker.py processing    # ProcessingWorker
    python scripts/start_worker.py indexing      # IndexingWorker

Environment:
    KAFKA_BOOTSTRAP_SERVERS  Required (e.g. "kafka:9092" or "localhost:9093")
    WORKER_CONCURRENCY       Optional (default: 4 for processing, 2 for indexing)

Docker Compose services ingestion-worker-processing / ingestion-worker-indexing
both use this script with different arguments.
"""

import asyncio
import sys
import os

# Add project root to PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _check_kafka() -> bool:
    brokers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()
    if not brokers:
        print(
            "[worker] WARNING: KAFKA_BOOTSTRAP_SERVERS not set. "
            "Worker will start but remain idle until Kafka is available.",
            flush=True,
        )
        return False
    return True


async def run_processing_worker() -> None:
    from app.ingestion.workers.processing_worker import ProcessingWorker
    worker = ProcessingWorker()
    await worker.run()


async def run_indexing_worker() -> None:
    from app.ingestion.workers.indexing_worker import IndexingWorker
    worker = IndexingWorker()
    await worker.run()


WORKERS = {
    "processing": run_processing_worker,
    "indexing": run_indexing_worker,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in WORKERS:
        print(f"Usage: {sys.argv[0]} <worker_type>")
        print(f"Available workers: {', '.join(WORKERS)}")
        sys.exit(1)

    worker_type = sys.argv[1]
    _check_kafka()

    print(f"[worker] Starting {worker_type} worker ...", flush=True)
    try:
        asyncio.run(WORKERS[worker_type]())
    except KeyboardInterrupt:
        print(f"[worker] {worker_type} worker stopped.", flush=True)


if __name__ == "__main__":
    main()
