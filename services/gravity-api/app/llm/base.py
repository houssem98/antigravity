"""
Gravity Search — Abstract LLM Interface
All LLM providers implement this interface so the router can swap models transparently.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator


class ModelProvider(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"
    DEEPSEEK = "deepseek"


@dataclass
class LLMMessage:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class LLMResponse:
    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0
    cost_usd: float = 0


@dataclass
class LLMConfig:
    """Per-call configuration overrides."""
    temperature: float = 0.1
    max_tokens: int = 4096
    top_p: float = 1.0
    stop_sequences: list[str] = field(default_factory=list)
    json_mode: bool = False


class BaseLLMClient(ABC):
    """Abstract base class for all LLM provider integrations."""

    provider: ModelProvider
    model_id: str

    @abstractmethod
    async def generate(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> LLMResponse:
        """Generate a complete response (non-streaming)."""
        ...

    @abstractmethod
    async def generate_stream(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> AsyncIterator[str]:
        """Generate a streaming response, yielding tokens as they arrive."""
        ...

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Estimate cost in USD based on model pricing."""
        # Override in each provider with actual pricing
        return 0.0
