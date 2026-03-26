"""
Gravity Search — Citation Validation Agent
Layer 2 of the 3-layer verification system.
Uses Gemini 3 Pro (FACTS Grounding #1) to verify every claim against sources.
"""

import json
import structlog

from app.core.reasoning.prompts import CITATION_VALIDATOR_SYSTEM
from app.core.retrieval.fusion import RetrievalResult
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage

logger = structlog.get_logger()


class CitationValidator:
    """Verify that every factual claim is grounded in cited sources."""

    def __init__(self, llm_client: BaseLLMClient):
        self.llm = llm_client  # Gemini 3 Pro or similar

    async def verify(
        self,
        answer: str,
        passages: list[RetrievalResult],
    ) -> dict:
        """
        Verify citations in the generated answer.

        Returns:
          {
            "claims": [{"claim_text": ..., "verification": "VERIFIED"|"UNVERIFIED", ...}],
            "overall_accuracy": 0.0-1.0,
            "unsupported_claims": [...],
            "numerical_errors": [...],
            "corrected_answer": str | None,
          }
        """
        # Format source passages for the validator
        source_text = ""
        for i, p in enumerate(passages, 1):
            source_text += f"[Source {i}] {p.document_title}"
            if p.section:
                source_text += f" — {p.section}"
            source_text += f"\n{p.text}\n\n"

        prompt = f"""## Generated Answer
{answer}

## Source Passages
{source_text}

Verify every factual claim in the answer against the source passages."""

        try:
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=CITATION_VALIDATOR_SYSTEM),
                    LLMMessage(role="user", content=prompt),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=2000, json_mode=True),
            )

            result = json.loads(response.content)

            # Log validation results
            claims = result.get("claims", [])
            verified = sum(1 for c in claims if c.get("verification") == "VERIFIED")
            total = len(claims)
            accuracy = verified / total if total > 0 else 0.0

            result["overall_accuracy"] = accuracy
            result.setdefault("unsupported_claims", [])
            result.setdefault("numerical_errors", [])
            result["corrected_answer"] = None  # Only set if corrections needed

            logger.info(
                "citation_validation",
                total_claims=total,
                verified=verified,
                accuracy=round(accuracy, 2),
                unsupported=len(result["unsupported_claims"]),
                numerical_errors=len(result["numerical_errors"]),
            )

            return result

        except Exception as e:
            logger.warning("citation_validation_failed", error=str(e))
            return {
                "claims": [],
                "overall_accuracy": None,
                "unsupported_claims": [],
                "numerical_errors": [],
                "corrected_answer": None,
                "error": str(e),
            }
