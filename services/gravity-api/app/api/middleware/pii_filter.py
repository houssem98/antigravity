"""
Gravity Search — PII Filter
Strips personally identifiable information from query text before LLM calls.
Used as a callable class inside search_pipeline.py, not as HTTP middleware.

Complies with: EU AI Act transparency requirements, SOC 2 Type II data handling.
"""

import re
import structlog

logger = structlog.get_logger()


class PIIFilter:
    """
    Detects and redacts PII patterns from text.

    Usage:
        pii_filter = PIIFilter()
        clean_text, redacted_types = pii_filter.filter(user_query)
    """

    PATTERNS = [
        (re.compile(r"\b[\w.%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "[REDACTED_EMAIL]"),
        (re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"), "[REDACTED_PHONE]"),
        (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]"),
        (re.compile(r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b"), "[REDACTED_CARD]"),
        # US passport-like patterns
        (re.compile(r"\b[A-Z]{1,2}[0-9]{6,9}\b"), "[REDACTED_ID]"),
    ]

    def filter(self, text: str) -> tuple[str, list[str]]:
        """
        Apply all PII patterns to text.

        Returns:
            (filtered_text, list_of_redacted_types)
        """
        redacted_types = []
        filtered = text

        for pattern, replacement in self.PATTERNS:
            new_text, count = pattern.subn(replacement, filtered)
            if count > 0:
                redacted_types.append(replacement.strip("[]"))
                filtered = new_text

        if redacted_types:
            logger.info("pii_redacted", types=redacted_types, count=len(redacted_types))

        return filtered, redacted_types
