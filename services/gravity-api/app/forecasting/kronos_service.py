"""
Kronos foundation model — async forecasting service.

Wraps the Kronos pre-trained time-series model for OHLCV prediction.
Loads model lazily (first request) to avoid startup overhead.

Model variants (HuggingFace):
    NeoQuasar/Kronos-mini      4.1M params  — fastest
    NeoQuasar/Kronos-small     24.7M params — default
    NeoQuasar/Kronos-base      102.3M params
    NeoQuasar/Kronos-large     499.2M params

Tokenizer: NeoQuasar/Kronos-Tokenizer-base
"""

import asyncio
import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

_DEFAULT_TOKENIZER = "NeoQuasar/Kronos-Tokenizer-base"
_DEFAULT_MODEL = "NeoQuasar/Kronos-small"


class KronosForecastService:
    """Async-safe wrapper around KronosPredictor."""

    def __init__(
        self,
        model_id: str = _DEFAULT_MODEL,
        tokenizer_id: str = _DEFAULT_TOKENIZER,
        max_context: int = 512,
    ):
        self.model_id = model_id
        self.tokenizer_id = tokenizer_id
        self.max_context = max_context
        self._predictor = None
        self._load_lock = asyncio.Lock()

    async def _ensure_loaded(self):
        """Lazy-load model on first use."""
        if self._predictor is not None:
            return
        async with self._load_lock:
            if self._predictor is not None:
                return
            loop = asyncio.get_event_loop()
            self._predictor = await loop.run_in_executor(None, self._load_sync)
            logger.info(f"Kronos model loaded: {self.model_id}")

    def _load_sync(self):
        from app.forecasting.kronos import Kronos, KronosTokenizer, KronosPredictor
        tokenizer = KronosTokenizer.from_pretrained(self.tokenizer_id)
        model = Kronos.from_pretrained(self.model_id)
        return KronosPredictor(model, tokenizer, max_context=self.max_context)

    async def predict(
        self,
        ohlcv_df: pd.DataFrame,
        x_timestamps: pd.Series,
        y_timestamps: pd.Series,
        pred_len: int,
        temperature: float = 1.0,
        top_p: float = 0.9,
        sample_count: int = 1,
    ) -> pd.DataFrame:
        """
        Forecast future OHLCV bars from historical data.

        Args:
            ohlcv_df: Historical bars with columns [open, high, low, close, volume, amount]
            x_timestamps: Timestamps for historical bars (same length as ohlcv_df)
            y_timestamps: Timestamps for forecast period (length == pred_len)
            pred_len: Number of future bars to predict
            temperature: Sampling temperature (lower = deterministic, higher = diverse)
            top_p: Nucleus sampling threshold
            sample_count: Number of forecast samples to average

        Returns:
            DataFrame with predicted [open, high, low, close, volume, amount]
        """
        await self._ensure_loaded()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._predictor.predict(
                df=ohlcv_df,
                x_timestamp=x_timestamps,
                y_timestamp=y_timestamps,
                pred_len=pred_len,
                T=temperature,
                top_p=top_p,
                sample_count=sample_count,
                verbose=False,
            ),
        )

    def is_loaded(self) -> bool:
        return self._predictor is not None


_service_instance: Optional[KronosForecastService] = None


def get_kronos_service(
    model_id: str = _DEFAULT_MODEL,
    tokenizer_id: str = _DEFAULT_TOKENIZER,
) -> KronosForecastService:
    """Singleton accessor — one model load per process."""
    global _service_instance
    if _service_instance is None:
        _service_instance = KronosForecastService(
            model_id=model_id,
            tokenizer_id=tokenizer_id,
        )
    return _service_instance
