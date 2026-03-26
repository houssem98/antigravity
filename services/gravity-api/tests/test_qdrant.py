"""Tests for the Qdrant DB layer."""

import pytest
from unittest.mock import patch, MagicMock

from app.db.qdrant import QdrantLazyClient, _MockQdrantClient, ensure_collection
from app.config import settings


@pytest.mark.asyncio
async def test_qdrant_lazy_client_fallback():
    """Verify QdrantLazyClient falls back to mock when connection fails."""
    client = QdrantLazyClient()
    
    # Force connection failure
    with patch("app.db.qdrant.AsyncQdrantClient") as mock_qdrant:
        mock_instance = MagicMock()
        mock_instance.get_collections.side_effect = ConnectionError("Connection refused")
        mock_qdrant.return_value = mock_instance
        
        # Accessing .client should trigger the connection attempt
        active_client = await client.client
        
        # It should have gracefully caught the error and used the mock
        assert isinstance(active_client, _MockQdrantClient)
        assert client.is_connected is False


@pytest.mark.asyncio
async def test_qdrant_lazy_client_success():
    """Verify QdrantLazyClient connects when Qdrant is available."""
    client = QdrantLazyClient()
    
    from unittest.mock import AsyncMock
    with patch("app.db.qdrant.AsyncQdrantClient") as mock_qdrant:
        # Connection succeeds
        mock_instance = AsyncMock()
        mock_qdrant.return_value = mock_instance
        
        active_client = await client.client
        
        # AsyncQdrantClient is wrapped by the active_client returned
        assert active_client is mock_instance
        assert client.is_connected is True


@pytest.mark.asyncio
async def test_ensure_collection_skips_if_mocked():
    """Verify ensure_collection does nothing if the client is mocked."""
    from unittest.mock import PropertyMock
    with patch("app.db.qdrant.QdrantLazyClient.is_connected", new_callable=PropertyMock) as mock_connected:
        mock_connected.return_value = False
        with patch("app.db.qdrant.qdrant_client.collection_exists") as mock_exists:
            
            # Create a real async function to serve as the property's return value
            async def mock_client_coro():
                return None
                
            with patch("app.db.qdrant.QdrantLazyClient.client", new_callable=PropertyMock) as p_client:
                p_client.return_value = mock_client_coro()
                await ensure_collection()
                # It should return early without checking existence or creating anything
                mock_exists.assert_not_called()
