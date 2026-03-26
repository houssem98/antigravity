"""
Gravity Search — WebSocket Response Streamer
Manages progressive rendering over a WebSocket connection.
Converts SearchEvent objects into typed JSON WebSocket messages.
"""

import asyncio
import structlog
from fastapi import WebSocket, WebSocketDisconnect
from typing import AsyncIterator

from app.core.search_pipeline import SearchEvent

logger = structlog.get_logger()


class ResponseStreamer:
    """
    Manages a single WebSocket connection lifecycle.

    Converts SearchEvent objects → JSON WebSocket messages:
      {"type": "status", "data": "Analyzing...", "trace_id": "..."}
      {"type": "sources", "data": [...], "trace_id": "..."}
      {"type": "token", "data": "word ", "trace_id": "..."}
      {"type": "answer", "data": {...}, "trace_id": "..."}
      {"type": "metadata", "data": {...}, "trace_id": "..."}
      {"type": "error", "data": {"message": "..."}, "trace_id": "..."}

    Handles disconnects, cancelled tasks, and backpressure gracefully.
    """

    HEARTBEAT_INTERVAL = 15  # seconds between heartbeat pings

    def __init__(self, websocket: WebSocket):
        self.ws = websocket
        self._connected = False

    async def accept(self):
        """Accept the WebSocket connection."""
        await self.ws.accept()
        self._connected = True
        logger.info("websocket_connected")

    async def stream_events(self, event_generator: AsyncIterator[SearchEvent]):
        """
        Consume SearchEvent generator and forward each event to the WebSocket client.
        Stops streaming if the client disconnects.
        """
        try:
            async for event in event_generator:
                if not self._connected:
                    logger.info("websocket_client_disconnected_during_stream")
                    break
                await self._send(event)
        except asyncio.CancelledError:
            logger.info("websocket_stream_cancelled")
        except WebSocketDisconnect:
            logger.info("websocket_disconnected_by_client")
            self._connected = False
        except Exception as e:
            logger.error("websocket_stream_error", error=str(e))
            await self._send_error(str(e))

    async def _send(self, event: SearchEvent):
        """Send a single SearchEvent as a JSON WebSocket message."""
        try:
            await self.ws.send_json({
                "type": event.type,
                "data": event.data,
                "trace_id": event.trace_id,
            })
        except WebSocketDisconnect:
            self._connected = False
            logger.info("websocket_send_failed_disconnected")
        except Exception as e:
            self._connected = False
            logger.warning("websocket_send_error", error=str(e))

    async def _send_error(self, message: str):
        """Send an error event to the client."""
        try:
            await self.ws.send_json({
                "type": "error",
                "data": {"message": message},
                "trace_id": "",
            })
        except Exception:
            pass

    async def close(self):
        """Close the WebSocket connection cleanly."""
        self._connected = False
        try:
            await self.ws.close()
            logger.info("websocket_closed")
        except Exception:
            pass
