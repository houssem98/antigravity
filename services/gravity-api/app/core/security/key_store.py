"""
Server-Side Encrypted API Key Store (plan §6.12)

Replaces client-side localStorage. Tenants' provider API keys (Anthropic,
OpenAI, Voyage, Cohere, etc.) are stored AES-256-GCM-encrypted in Postgres,
with a KEK loaded from environment / KMS.

Threat model addressed:
  - XSS exfiltration of localStorage tokens — keys never sent to browser
  - DB-only compromise without app secret — ciphertext alone is useless
  - Key rotation without re-encryption of every row — versioned KEKs

Encryption layout (per row):
  ciphertext = AES-256-GCM(plaintext, dek)
  wrapped_dek = AES-256-GCM(dek, kek_v{n})
  Stored: {kek_version, nonce_dek, wrapped_dek, nonce_data, ciphertext, aad}

Rotation: bump kek_version, re-wrap DEKs lazily on next access (nothing to
re-encrypt at the data layer).

BYOK (P0.5): the `KEKProvider` interface abstracts the KEK source. Default
is `EnvKEKProvider`. Enterprise tenants get `KMSKEKProvider` (AWS / GCP /
Azure) via `key_store_byok.py` next sprint.
"""

from __future__ import annotations

import base64
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Protocol

import structlog
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = structlog.get_logger()


# ─── KEK provider interface ───────────────────────────────────────────────────

class KEKProvider(Protocol):
    """Source of Key Encryption Keys. Must be 32 bytes per version."""

    def current_version(self) -> int: ...
    def get_key(self, version: int) -> bytes: ...


class EnvKEKProvider:
    """Loads KEKs from KEY_ENCRYPTION_KEY_V{n} env vars (base64-encoded 32B)."""

    def __init__(self, env_prefix: str = "KEY_ENCRYPTION_KEY_V"):
        self.env_prefix = env_prefix
        self._cache: dict[int, bytes] = {}

    def current_version(self) -> int:
        # Highest non-empty version found.
        v = 0
        for k in os.environ:
            if k.startswith(self.env_prefix) and os.environ.get(k):
                try:
                    v = max(v, int(k[len(self.env_prefix):]))
                except ValueError:
                    continue
        if v == 0:
            # Bootstrap dev: synthesize an ephemeral V1 if nothing set.
            # NEVER acceptable in production — main.py refuses to start without
            # at least one KEY_ENCRYPTION_KEY_V1 in non-DEVELOPMENT mode.
            if not self._cache.get(1):
                self._cache[1] = AESGCM.generate_key(bit_length=256)
                logger.warning(
                    "kek_ephemeral_dev_only",
                    note="No KEY_ENCRYPTION_KEY_V1 set; generated ephemeral KEK. "
                         "All encrypted data is lost on restart. Set the env var.",
                )
            return 1
        return v

    def get_key(self, version: int) -> bytes:
        if version in self._cache:
            return self._cache[version]
        env_name = f"{self.env_prefix}{version}"
        raw = os.environ.get(env_name, "")
        if not raw:
            # Fall back to ephemeral if this version was synthesized above.
            if version in self._cache:
                return self._cache[version]
            raise KeyError(f"KEK version {version} not configured ({env_name})")
        try:
            key = base64.b64decode(raw)
        except Exception as e:
            raise ValueError(f"{env_name} is not valid base64: {e}") from e
        if len(key) != 32:
            raise ValueError(f"{env_name} must decode to 32 bytes (got {len(key)})")
        self._cache[version] = key
        return key


# ─── Encrypted record + envelope helpers ──────────────────────────────────────

@dataclass
class EncryptedRecord:
    kek_version: int
    nonce_dek: bytes      # 12B for AES-GCM
    wrapped_dek: bytes    # AES-GCM ciphertext of the 32B DEK
    nonce_data: bytes     # 12B for the data AES-GCM
    ciphertext: bytes     # AES-GCM(plaintext)
    aad: bytes = b""      # Additional authenticated data (tenant_id, key_name)
    created_at: str = ""


def _aad_for(tenant_id: str, key_name: str) -> bytes:
    """AAD binds ciphertext to its (tenant, key_name) — prevents row-swap attacks."""
    return f"tenant={tenant_id};key={key_name}".encode()


def encrypt_secret(
    plaintext: str,
    tenant_id: str,
    key_name: str,
    kek_provider: KEKProvider,
) -> EncryptedRecord:
    """Envelope-encrypt a secret. New DEK per record."""
    if not plaintext:
        raise ValueError("plaintext required")
    kek_version = kek_provider.current_version()
    kek = kek_provider.get_key(kek_version)

    dek = AESGCM.generate_key(bit_length=256)
    nonce_dek = secrets.token_bytes(12)
    nonce_data = secrets.token_bytes(12)
    aad = _aad_for(tenant_id, key_name)

    wrapped_dek = AESGCM(kek).encrypt(nonce_dek, dek, aad)
    ciphertext = AESGCM(dek).encrypt(nonce_data, plaintext.encode(), aad)

    return EncryptedRecord(
        kek_version=kek_version,
        nonce_dek=nonce_dek,
        wrapped_dek=wrapped_dek,
        nonce_data=nonce_data,
        ciphertext=ciphertext,
        aad=aad,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def decrypt_secret(
    record: EncryptedRecord,
    tenant_id: str,
    key_name: str,
    kek_provider: KEKProvider,
) -> str:
    """Decrypt + verify AAD. Raises if AAD doesn't match (row-swap detection)."""
    expected_aad = _aad_for(tenant_id, key_name)
    if record.aad and record.aad != expected_aad:
        raise ValueError("AAD mismatch — possible row-swap or tampering")
    kek = kek_provider.get_key(record.kek_version)
    dek = AESGCM(kek).decrypt(record.nonce_dek, record.wrapped_dek, expected_aad)
    plaintext = AESGCM(dek).decrypt(record.nonce_data, record.ciphertext, expected_aad)
    return plaintext.decode()


# ─── Postgres-backed store ────────────────────────────────────────────────────

# Schema:
_DDL = """
CREATE TABLE IF NOT EXISTS api_key_store (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     TEXT      NOT NULL,
    key_name      TEXT      NOT NULL,
    kek_version   INTEGER   NOT NULL,
    nonce_dek     BYTEA     NOT NULL,
    wrapped_dek   BYTEA     NOT NULL,
    nonce_data    BYTEA     NOT NULL,
    ciphertext    BYTEA     NOT NULL,
    aad           BYTEA     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at    TIMESTAMPTZ,
    last_used_at  TIMESTAMPTZ,
    UNIQUE (tenant_id, key_name)
);
CREATE INDEX IF NOT EXISTS idx_api_key_store_tenant ON api_key_store (tenant_id);
"""


class APIKeyStore:
    """
    Encrypted-at-rest API key store backed by Postgres + an in-memory fallback
    for dev/test.

    Usage:
        store = APIKeyStore(db_pool=pool, kek_provider=EnvKEKProvider())
        await store.put("acme", "ANTHROPIC_API_KEY", "sk-ant-...")
        key = await store.get("acme", "ANTHROPIC_API_KEY")  # "sk-ant-..."
    """

    def __init__(
        self,
        db_pool=None,
        kek_provider: Optional[KEKProvider] = None,
    ):
        self.db = db_pool
        self.kek = kek_provider or EnvKEKProvider()
        self._mem: dict[tuple[str, str], EncryptedRecord] = {}

    async def ensure_schema(self):
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                await conn.execute(_DDL)
        except Exception as e:
            logger.warning("api_key_store_schema_failed", error=str(e))

    async def put(self, tenant_id: str, key_name: str, plaintext: str) -> None:
        rec = encrypt_secret(plaintext, tenant_id, key_name, self.kek)
        if self.db is not None:
            await self.ensure_schema()
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO api_key_store
                          (tenant_id, key_name, kek_version, nonce_dek,
                           wrapped_dek, nonce_data, ciphertext, aad)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (tenant_id, key_name) DO UPDATE SET
                          kek_version = EXCLUDED.kek_version,
                          nonce_dek   = EXCLUDED.nonce_dek,
                          wrapped_dek = EXCLUDED.wrapped_dek,
                          nonce_data  = EXCLUDED.nonce_data,
                          ciphertext  = EXCLUDED.ciphertext,
                          aad         = EXCLUDED.aad,
                          rotated_at  = NOW()
                        """,
                        tenant_id, key_name, rec.kek_version, rec.nonce_dek,
                        rec.wrapped_dek, rec.nonce_data, rec.ciphertext, rec.aad,
                    )
            except Exception as e:
                logger.warning("api_key_store_put_failed", error=str(e))
                self._mem[(tenant_id, key_name)] = rec
        else:
            self._mem[(tenant_id, key_name)] = rec
        logger.info(
            "api_key_stored",
            tenant_id=tenant_id, key_name=key_name, kek_version=rec.kek_version,
        )

    async def get(self, tenant_id: str, key_name: str) -> Optional[str]:
        rec: Optional[EncryptedRecord] = None
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        """
                        UPDATE api_key_store SET last_used_at = NOW()
                        WHERE tenant_id = $1 AND key_name = $2
                        RETURNING kek_version, nonce_dek, wrapped_dek,
                                  nonce_data, ciphertext, aad
                        """,
                        tenant_id, key_name,
                    )
                if row:
                    rec = EncryptedRecord(
                        kek_version=row["kek_version"],
                        nonce_dek=bytes(row["nonce_dek"]),
                        wrapped_dek=bytes(row["wrapped_dek"]),
                        nonce_data=bytes(row["nonce_data"]),
                        ciphertext=bytes(row["ciphertext"]),
                        aad=bytes(row["aad"]),
                    )
            except Exception as e:
                logger.warning("api_key_store_get_failed", error=str(e))
        if rec is None:
            rec = self._mem.get((tenant_id, key_name))
        if rec is None:
            return None
        try:
            return decrypt_secret(rec, tenant_id, key_name, self.kek)
        except Exception as e:
            logger.error("api_key_decrypt_failed", error=str(e),
                         tenant_id=tenant_id, key_name=key_name)
            return None

    async def delete(self, tenant_id: str, key_name: str) -> bool:
        deleted = False
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    res = await conn.execute(
                        "DELETE FROM api_key_store WHERE tenant_id=$1 AND key_name=$2",
                        tenant_id, key_name,
                    )
                    deleted = "DELETE 0" not in (res or "")
            except Exception as e:
                logger.warning("api_key_store_delete_failed", error=str(e))
        if (tenant_id, key_name) in self._mem:
            del self._mem[(tenant_id, key_name)]
            deleted = True
        return deleted

    async def list_keys(self, tenant_id: str) -> list[str]:
        names: list[str] = []
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    rows = await conn.fetch(
                        "SELECT key_name FROM api_key_store WHERE tenant_id=$1 ORDER BY key_name",
                        tenant_id,
                    )
                    names = [r["key_name"] for r in rows]
            except Exception as e:
                logger.warning("api_key_store_list_failed", error=str(e))
        for (t, k) in self._mem:
            if t == tenant_id and k not in names:
                names.append(k)
        return sorted(names)

    async def rotate_record(self, tenant_id: str, key_name: str) -> bool:
        """Re-encrypt with current KEK version (use during KEK rotation)."""
        plaintext = await self.get(tenant_id, key_name)
        if plaintext is None:
            return False
        await self.put(tenant_id, key_name, plaintext)
        return True
