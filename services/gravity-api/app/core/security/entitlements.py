"""
Source-Level Entitlements (plan §6.11)

Pre-retrieval ACL filter to prevent prompt-injection exfiltration of
unauthorized content. Every chunk carries an `entitlements` list (keys for
content licenses, projects, deal rooms, MNPI tags). Every search query
carries a `UserEntitlements` set. Retrieval matches chunk entitlements
against user grants BEFORE results leave the storage layer.

Why pre-retrieval (not pre-display):
  Post-display filtering still allows the LLM to see and summarize content
  the user is not licensed to read — and prompt injection can extract it.
  The ACL must live in the Qdrant/ES query filter itself.

Entitlement keys (examples):
  "public"           — anyone can read
  "wsi_amr"          — AlphaSense Wall Street Insights AMR-licensed broker research
  "tegus"            — Tegus expert call transcripts
  "deal_room:proj_x" — private deal-room project X
  "mnpi:proj_y"      — material non-public information for project Y
                       (also requires explicit wall-crossing — see mnpi.py)

Default model:
  - Chunks without explicit entitlements default to ["public"]
  - Users without explicit grants get UserEntitlements.public_only()
  - Ingestion pipeline tags chunks based on source connector
    (e.g. SEC EDGAR → ["public"]; deal-room upload → ["deal_room:<id>"])
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

import structlog

logger = structlog.get_logger()


PUBLIC = "public"


@dataclass
class UserEntitlements:
    """Entitlement grants for a user/session. Loaded from RBAC + license records."""
    user_id: str = ""
    org_id: str = ""
    grants: set[str] = field(default_factory=lambda: {PUBLIC})

    @classmethod
    def public_only(cls, user_id: str = "", org_id: str = "") -> "UserEntitlements":
        return cls(user_id=user_id, org_id=org_id, grants={PUBLIC})

    @classmethod
    def from_jwt_claims(cls, claims: dict) -> "UserEntitlements":
        """Build from JWT claims emitted by the auth service.

        Expected claim shape:
          { "sub": "user_42",
            "org_id": "acme",
            "entitlements": ["public", "wsi_amr", "deal_room:proj_x"] }
        """
        grants = set(claims.get("entitlements") or [])
        grants.add(PUBLIC)
        return cls(
            user_id=str(claims.get("sub", "")),
            org_id=str(claims.get("org_id", "")),
            grants=grants,
        )

    def has(self, key: str) -> bool:
        return key in self.grants

    def has_any(self, keys: Iterable[str]) -> bool:
        return any(k in self.grants for k in keys)

    def grant(self, key: str) -> "UserEntitlements":
        """Returns a new UserEntitlements with the additional grant (immutability)."""
        return UserEntitlements(
            user_id=self.user_id,
            org_id=self.org_id,
            grants=self.grants | {key},
        )

    def revoke(self, key: str) -> "UserEntitlements":
        """Returns a new UserEntitlements with the grant removed."""
        return UserEntitlements(
            user_id=self.user_id,
            org_id=self.org_id,
            grants=self.grants - {key},
        )


def chunk_is_visible(chunk_entitlements: Optional[list[str]], user: UserEntitlements) -> bool:
    """
    Authoritative visibility check for a single chunk.

    A chunk is visible iff at least one of its entitlement keys is in the user's grants.
    Empty / missing entitlements default to ["public"] (deny-by-default with a
    safe public fallback for legacy chunks pre-dating this layer).
    """
    keys = chunk_entitlements or [PUBLIC]
    return any(k in user.grants for k in keys)


def filter_visible(chunks: list, user: UserEntitlements, attr: str = "metadata") -> list:
    """
    Post-retrieval safety net — drops any chunk the user can't see.

    Production retrieval should also apply pre-retrieval filters (qdrant_filter,
    es_filter below) so the storage layer never returns invisible chunks. This
    function is a defense-in-depth check, not the primary control.
    """
    visible = []
    for c in chunks:
        meta = getattr(c, attr, None) or {}
        ents = meta.get("entitlements") if isinstance(meta, dict) else None
        if chunk_is_visible(ents, user):
            visible.append(c)
    if len(visible) < len(chunks):
        logger.warning(
            "entitlement_post_filter_dropped",
            user_id=user.user_id,
            dropped=len(chunks) - len(visible),
            of_total=len(chunks),
        )
    return visible


# ─── Storage-layer filter builders ────────────────────────────────────────────

def qdrant_entitlement_filter(user: UserEntitlements):
    """
    Build a Qdrant filter clause that returns only chunks where ANY entitlement
    in the chunk's `entitlements` payload field is in the user's grants.

    Combine with other domain filters (companies, document_types, chunk_level).

    Example:
      from qdrant_client import models
      conditions = [
          ...,
          qdrant_entitlement_filter(user),
      ]
    """
    from qdrant_client import models
    return models.FieldCondition(
        key="entitlements",
        match=models.MatchAny(any=sorted(user.grants)),
    )


def es_entitlement_filter(user: UserEntitlements) -> dict:
    """Elasticsearch terms filter clause for entitlement matching."""
    return {"terms": {"entitlements": sorted(user.grants)}}
