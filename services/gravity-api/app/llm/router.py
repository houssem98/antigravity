"""
Gravity Search — LLM Router
Routes each query to the optimal model based on complexity, task type, and cost budget.
Implements the 70/20/8/2 distribution for cost-optimal performance.

Routing flow:
  1. Gemini Flash classifies query complexity in <10ms
  2. Router maps complexity → model
  3. Fallback chain if primary model is unavailable
"""

import structlog
from dataclasses import dataclass
from enum import Enum

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()


class QueryComplexity(str, Enum):
    SIMPLE = "simple"      # 70% — factual lookup, entity search, basic summary
    MEDIUM = "medium"      # 20% — multi-doc synthesis, trend analysis, comparisons
    COMPLEX = "complex"    # 8%  — multi-hop reasoning, investment thesis, contradiction detection
    MATH = "math"          # 2%  — financial calculations, ratio analysis, DCF modeling


@dataclass
class RoutingDecision:
    complexity: QueryComplexity
    primary_model: str
    provider: str
    estimated_cost: float  # USD per query estimate
    reasoning: str


CLASSIFICATION_PROMPT = """Classify this financial research query into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- SIMPLE: Direct factual lookup, single entity, one data point (e.g., "What was Apple's revenue in Q4 2025?")
- MEDIUM: Multi-document synthesis, comparison, trend analysis (e.g., "Compare FAANG margin trends")
- COMPLEX: Multi-hop reasoning, investment thesis, contradiction detection, requires deep judgment
  (e.g., "Does TSMC's CapEx guidance align with analyst expectations across the last 3 quarters?")
- MATH: Financial calculations, ratios, DCF, valuation models
  (e.g., "What is TSLA's EV/EBITDA relative to the EV sector median?")

Query: {query}
Category:"""


class LLMRouter:
    """Routes queries to the optimal LLM based on complexity classification."""

    def __init__(self):
        # Initialize all model clients
        self._clients: dict[str, BaseLLMClient] = {}
        self._init_clients()

        # Routing table: complexity → ordered fallback chain
        # Groq (llama-3.3-70b) and DeepSeek are last-resort fallbacks when
        # Anthropic credits are exhausted or primary models are unavailable.
        self._routing_table: dict[QueryComplexity, list[str]] = {
            # Groq first: it's the only currently-funded LLM (free tier, generous).
            # Better models (Claude/GPT/Gemini-pro) kept as fallbacks and will be
            # picked again once their billing is funded + registered.
            QueryComplexity.SIMPLE:  ["gpt4o", "groq_fast", "groq_large", "gemini_flash", "deepseek", "claude_haiku"],
            QueryComplexity.MEDIUM:  ["gpt4o", "groq_large", "gpt5", "gemini_pro", "deepseek", "claude_sonnet"],
            QueryComplexity.COMPLEX: ["gpt5", "gpt4o", "groq_large", "deepseek", "claude_opus", "claude_sonnet"],
            QueryComplexity.MATH:    ["gpt5", "gpt4o", "groq_large", "deepseek", "claude_opus"],
        }

        # Cost estimates per query by complexity
        self._cost_estimates = {
            QueryComplexity.SIMPLE: 0.003,
            QueryComplexity.MEDIUM: 0.035,
            QueryComplexity.COMPLEX: 0.12,
            QueryComplexity.MATH: 0.07,
        }

    def _init_clients(self):
        """Initialize available LLM clients based on configured API keys."""
        if settings.anthropic_api_key and settings.anthropic_enabled:
            from app.llm.anthropic_client import AnthropicClient
            self._clients["claude_haiku"] = AnthropicClient("claude-haiku-4-5-20251001")
            self._clients["claude_sonnet"] = AnthropicClient("claude-sonnet-4-6")
            self._clients["claude_opus"] = AnthropicClient("claude-opus-4-7")

        if settings.openai_api_key:
            from app.llm.openai_client import OpenAIClient
            # Valid, funded models with high TPM (Groq free tier 413s on big
            # multi-source prompts). gpt-4o-mini is cheap + the default generator.
            self._clients["gpt5"] = OpenAIClient("gpt-4o")
            self._clients["gpt4o"] = OpenAIClient("gpt-4o-mini")

        if settings.google_api_key:
            from app.llm.google_client import GoogleClient
            self._clients["gemini_flash"] = GoogleClient("gemini-2.5-flash")
            self._clients["gemini_pro"] = GoogleClient("gemini-2.5-pro")

        if settings.deepseek_api_key:
            from app.llm.deepseek_client import DeepSeekClient
            self._clients["deepseek"] = DeepSeekClient("deepseek-chat")

        if settings.groq_api_key:
            from app.llm.groq_client import GroqClient
            self._clients["groq_large"] = GroqClient("llama-3.3-70b-versatile")
            self._clients["groq_fast"] = GroqClient("llama-3.1-8b-instant")

        logger.info("llm_router_init", available_models=list(self._clients.keys()))

    async def classify_complexity(self, query: str) -> QueryComplexity:
        """Classify query complexity with the cheapest available LLM."""
        classifier = (
            self._clients.get("groq_fast")
            or self._clients.get("gemini_flash")
            or self._clients.get("claude_haiku")
            or self._clients.get("deepseek")
        )
        if not classifier:
            # Fallback: simple heuristic if no classifier available
            return self._heuristic_classify(query)

        try:
            response = await classifier.generate(
                messages=[LLMMessage(role="user", content=CLASSIFICATION_PROMPT.format(query=query))],
                config=LLMConfig(temperature=0.0, max_tokens=10),
            )
            result = response.content.strip().upper()

            for complexity in QueryComplexity:
                if complexity.value.upper() in result:
                    return complexity

            return QueryComplexity.MEDIUM  # Default if classification unclear
        except Exception as e:
            logger.warning("complexity_classification_failed", error=str(e))
            return self._heuristic_classify(query)

    def _heuristic_classify(self, query: str) -> QueryComplexity:
        """Fast heuristic fallback when LLM classifier is unavailable."""
        query_lower = query.lower()

        # Math keywords
        math_keywords = ["ev/ebitda", "ratio", "calculate", "dcf", "wacc", "irr", "npv",
                         "multiple", "valuation", "margin %", "growth rate"]
        if any(kw in query_lower for kw in math_keywords):
            return QueryComplexity.MATH

        # Complex keywords
        complex_keywords = ["compare across", "contradiction", "align with", "investment thesis",
                           "risk assessment", "cross-reference", "deep dive", "multi-step"]
        if any(kw in query_lower for kw in complex_keywords):
            return QueryComplexity.COMPLEX

        # Medium keywords
        medium_keywords = ["compare", "trend", "how has", "changed since", "synthesis",
                          "summarize across", "versus", "vs", "difference between"]
        if any(kw in query_lower for kw in medium_keywords):
            return QueryComplexity.MEDIUM

        # Simple: default for everything else
        return QueryComplexity.SIMPLE

    def select_model(self, complexity: QueryComplexity) -> BaseLLMClient:
        """Select the best available model for the given complexity level."""
        candidates = self._routing_table[complexity]

        for model_key in candidates:
            if model_key in self._clients:
                logger.info(
                    "model_selected",
                    complexity=complexity.value,
                    model=model_key,
                )
                return self._clients[model_key]

        # Last resort: return any available client
        if self._clients:
            fallback_key = next(iter(self._clients))
            logger.warning("model_fallback", using=fallback_key)
            return self._clients[fallback_key]

        raise RuntimeError("No LLM clients available. Check API keys in .env")

    async def route(self, query: str) -> tuple[BaseLLMClient, RoutingDecision]:
        """Full routing pipeline: classify → select → return client + decision."""
        complexity = await self.classify_complexity(query)
        client = self.select_model(complexity)

        decision = RoutingDecision(
            complexity=complexity,
            primary_model=client.model_id,
            provider=client.provider.value,
            estimated_cost=self._cost_estimates[complexity],
            reasoning=f"Query classified as {complexity.value} → routed to {client.model_id}",
        )

        return client, decision

    def select_models_ordered(self, complexity: QueryComplexity) -> list[BaseLLMClient]:
        """Return all available clients for a complexity level, in fallback order."""
        clients = []
        for model_key in self._routing_table[complexity]:
            if model_key in self._clients:
                clients.append(self._clients[model_key])
        if not clients:
            clients = list(self._clients.values())
        return clients

    def get_client(self, model_key: str) -> BaseLLMClient:
        """Get a specific model client by key (for validation agent, etc.)."""
        if model_key not in self._clients:
            raise ValueError(f"Model {model_key} not available. Available: {list(self._clients.keys())}")
        return self._clients[model_key]

    def get_fast_client(self) -> BaseLLMClient:
        """Get the fastest/cheapest available client (for query understanding, etc.)."""
        for key in ["groq_fast", "gemini_flash", "claude_haiku", "deepseek", "gpt4o", "groq_large", "claude_sonnet"]:
            if key in self._clients:
                return self._clients[key]
        return next(iter(self._clients.values()))


