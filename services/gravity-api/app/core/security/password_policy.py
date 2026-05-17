"""
Password Policy — OWASP 2024 compliant.

Checks every new/changed password against:
  1. Length floor (12 chars)
  2. Character classes (any 3 of: upper, lower, digit, symbol)
  3. zxcvbn strength score >= 3 (out of 4) [optional dep]
  4. HaveIBeenPwned k-anonymity API — reject if leaked >0 times

Used by: signup, password change, password reset confirm.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()

MIN_LENGTH = 12
MIN_ZXCVBN_SCORE = 3
HIBP_TIMEOUT = 3.0
MIN_CHARSET_CLASSES = 3


@dataclass
class PolicyResult:
    ok: bool
    score: int
    pwned_count: int
    reasons: list[str]


def _charset_classes(pw: str) -> int:
    classes = 0
    if re.search(r"[a-z]", pw):
        classes += 1
    if re.search(r"[A-Z]", pw):
        classes += 1
    if re.search(r"\d", pw):
        classes += 1
    if re.search(r"[^A-Za-z0-9]", pw):
        classes += 1
    return classes


def _zxcvbn_score(pw: str, user_inputs: list[str]) -> Optional[int]:
    try:
        from zxcvbn import zxcvbn  # type: ignore
    except ImportError:
        return None
    try:
        r = zxcvbn(pw, user_inputs=user_inputs)
        return int(r.get("score", 0))
    except Exception as e:
        logger.warning("zxcvbn_failed", error=str(e))
        return None


async def _hibp_pwned_count(pw: str) -> int:
    """HaveIBeenPwned k-anonymity check. Only first 5 chars of SHA-1 sent."""
    sha1 = hashlib.sha1(pw.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    url = f"https://api.pwnedpasswords.com/range/{prefix}"
    try:
        async with httpx.AsyncClient(timeout=HIBP_TIMEOUT) as client:
            r = await client.get(url, headers={"Add-Padding": "true"})
            if r.status_code != 200:
                return -1
            for line in r.text.splitlines():
                hash_suffix, _, count = line.partition(":")
                if hash_suffix.strip().upper() == suffix:
                    try:
                        return int(count.strip())
                    except ValueError:
                        return -1
        return 0
    except Exception as e:
        logger.warning("hibp_check_failed", error=str(e))
        return -1


async def check_password(
    password: str,
    *,
    email: str = "",
    skip_hibp: bool = False,
) -> PolicyResult:
    reasons: list[str] = []

    if len(password) < MIN_LENGTH:
        reasons.append(f"password must be at least {MIN_LENGTH} characters")
    if _charset_classes(password) < MIN_CHARSET_CLASSES:
        reasons.append(
            f"password must contain at least {MIN_CHARSET_CLASSES} of: "
            "uppercase, lowercase, digit, symbol"
        )

    user_inputs = [email.split("@")[0]] if email else []
    score = _zxcvbn_score(password, user_inputs)
    if score is not None and score < MIN_ZXCVBN_SCORE:
        reasons.append(
            f"password too weak (strength {score}/4, need {MIN_ZXCVBN_SCORE}/4)"
        )

    pwned_count = -1
    if not skip_hibp:
        pwned_count = await _hibp_pwned_count(password)
        if pwned_count > 0:
            reasons.append(
                f"password found in {pwned_count:,} known breaches (HaveIBeenPwned)"
            )

    return PolicyResult(
        ok=len(reasons) == 0,
        score=score if score is not None else 0,
        pwned_count=pwned_count,
        reasons=reasons,
    )
