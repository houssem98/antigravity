"""
BYOK (Bring Your Own Key) — Customer-Managed KMS adapters (plan §6.12)

Three KEK providers that source the Key Encryption Key from a customer's
own cloud KMS instead of the local environment. Customer revokes the KMS
key → all of their encrypted data becomes unrecoverable in our system
(kill-switch).

  AWSKMSKEKProvider    — uses boto3, key spec SYMMETRIC_DEFAULT (AES-256)
  GCPKMSKEKProvider    — uses google-cloud-kms
  AzureKVKEKProvider   — uses azure-keyvault-keys + azure-identity

All three provide the SAME 32-byte key bytes interface as `EnvKEKProvider`.

How it works:
  - We do NOT pull the raw KEK out of KMS (most KMS won't let you).
  - Instead, KMS holds a 32-byte AES key per "version" (each version =
    a separate KMS key resource, e.g. arn:.../alias/gravity-kek-v1).
  - On `get_key(version)`, the provider performs `kms.GenerateDataKey` or
    fetches a wrapped key once, then caches the plaintext key in memory
    for the lifetime of the process. (Tradeoff: in-memory plaintext for
    speed; revocation requires process restart.)
  - For maximum security, swap to per-call `Encrypt`/`Decrypt` with the
    KMS key wrapping each DEK. This file ships the simpler in-memory
    pattern; a future iteration can layer the wrapping pattern.

Soft-dependency: SDKs only imported when the provider is instantiated.
The default deployment uses `EnvKEKProvider` and incurs zero AWS/GCP/Azure
imports.
"""

from __future__ import annotations

import os
from typing import Optional

import structlog

logger = structlog.get_logger()


# ─── AWS KMS ──────────────────────────────────────────────────────────────────

class AWSKMSKEKProvider:
    """
    AWS KMS-backed KEK provider.

    Configuration:
      key_arns: dict[int, str]  # version → KMS key ARN
        e.g. {1: "arn:aws:kms:us-east-1:123:key/abc",
              2: "arn:aws:kms:us-east-1:123:key/def"}
      region:   AWS region (defaults to AWS_REGION env)

    Required IAM permissions on the KMS key:
      kms:GenerateDataKey  (to derive the 32B AES key for envelope encryption)

    Customer revokes by either:
      - Disabling the KMS key (re-running app → all reads fail with KMS error)
      - Scheduling key deletion (irrevocable after 7-30 days)
    """

    def __init__(
        self,
        key_arns: dict[int, str],
        region: Optional[str] = None,
        boto3_session=None,
    ):
        if not key_arns:
            raise ValueError("AWSKMSKEKProvider requires at least one key version")
        self.key_arns = dict(key_arns)
        self.region = region or os.getenv("AWS_REGION", "us-east-1")
        self._session = boto3_session
        self._cache: dict[int, bytes] = {}

    def _client(self):
        if self._session is not None:
            return self._session.client("kms", region_name=self.region)
        try:
            import boto3
        except ImportError as e:
            raise ImportError(
                "AWSKMSKEKProvider requires boto3. Install: pip install boto3"
            ) from e
        return boto3.client("kms", region_name=self.region)

    def current_version(self) -> int:
        return max(self.key_arns)

    def get_key(self, version: int) -> bytes:
        if version in self._cache:
            return self._cache[version]
        if version not in self.key_arns:
            raise KeyError(f"AWS KMS KEK version {version} not configured")
        client = self._client()
        try:
            resp = client.generate_data_key(
                KeyId=self.key_arns[version],
                KeySpec="AES_256",
            )
        except Exception as e:
            logger.error("aws_kms_generate_data_key_failed",
                         arn=self.key_arns[version], error=str(e))
            raise
        plaintext = resp["Plaintext"]
        if len(plaintext) != 32:
            raise ValueError(f"AWS KMS returned {len(plaintext)}B, expected 32")
        self._cache[version] = plaintext
        logger.info("aws_kms_kek_loaded", version=version,
                    arn=self.key_arns[version][:50])
        return plaintext


# ─── GCP KMS ──────────────────────────────────────────────────────────────────

class GCPKMSKEKProvider:
    """
    GCP Cloud KMS-backed KEK provider.

    Configuration:
      key_names: dict[int, str]  # version → fully-qualified key name
        e.g. {1: "projects/p/locations/us/keyRings/gr/cryptoKeys/kek-v1"}

    Uses the KMS key purpose `ENCRYPT_DECRYPT` with `GOOGLE_SYMMETRIC_ENCRYPTION`
    (AES-256). We Encrypt/Decrypt a fixed 32B nonce-blob to derive the in-memory
    KEK; this gives a deterministic 32B value bound to the GCP key without
    exposing the raw GCP-managed material.
    """

    # Fixed plaintext used as input to GCP's Encrypt — its ciphertext (truncated/hashed
    # to 32B) becomes the in-memory KEK. Bound to the GCP key, irreversible without it.
    _DERIVATION_INPUT = b"gravity-kek-derivation-v1"

    def __init__(self, key_names: dict[int, str], gcp_client=None):
        if not key_names:
            raise ValueError("GCPKMSKEKProvider requires at least one key version")
        self.key_names = dict(key_names)
        self._client = gcp_client
        self._cache: dict[int, bytes] = {}

    def _kms(self):
        if self._client is not None:
            return self._client
        try:
            from google.cloud import kms
        except ImportError as e:
            raise ImportError(
                "GCPKMSKEKProvider requires google-cloud-kms. "
                "Install: pip install google-cloud-kms"
            ) from e
        return kms.KeyManagementServiceClient()

    def current_version(self) -> int:
        return max(self.key_names)

    def get_key(self, version: int) -> bytes:
        if version in self._cache:
            return self._cache[version]
        if version not in self.key_names:
            raise KeyError(f"GCP KMS KEK version {version} not configured")

        client = self._kms()
        name = self.key_names[version]
        try:
            resp = client.encrypt(
                request={"name": name, "plaintext": self._DERIVATION_INPUT}
            )
        except Exception as e:
            logger.error("gcp_kms_encrypt_failed", name=name, error=str(e))
            raise

        # GCP ciphertext is variable-length and includes IV+auth tag. Hash to
        # 32B for the KEK so subsequent calls return identical material.
        import hashlib
        kek = hashlib.sha256(resp.ciphertext).digest()
        self._cache[version] = kek
        logger.info("gcp_kms_kek_loaded", version=version, name=name[:50])
        return kek


# ─── Azure Key Vault ──────────────────────────────────────────────────────────

class AzureKVKEKProvider:
    """
    Azure Key Vault-backed KEK provider.

    Configuration:
      vault_url: e.g. "https://acme-gravity.vault.azure.net"
      key_names: dict[int, str]  # version → key name in the vault
      credential: any azure.identity credential (defaults to DefaultAzureCredential)

    Same derivation pattern as GCP — uses the Key Vault `Encrypt` operation
    on a fixed plaintext, hashes the ciphertext to a 32B KEK.
    """

    _DERIVATION_INPUT = b"gravity-kek-derivation-v1"

    def __init__(
        self,
        vault_url: str,
        key_names: dict[int, str],
        credential=None,
    ):
        if not vault_url:
            raise ValueError("vault_url required")
        if not key_names:
            raise ValueError("AzureKVKEKProvider requires at least one key version")
        self.vault_url = vault_url
        self.key_names = dict(key_names)
        self._credential = credential
        self._cache: dict[int, bytes] = {}

    def _crypto_client(self, key_name: str):
        try:
            from azure.identity import DefaultAzureCredential
            from azure.keyvault.keys import KeyClient
            from azure.keyvault.keys.crypto import CryptographyClient
        except ImportError as e:
            raise ImportError(
                "AzureKVKEKProvider requires azure-keyvault-keys + azure-identity. "
                "Install: pip install azure-keyvault-keys azure-identity"
            ) from e
        cred = self._credential or DefaultAzureCredential()
        kc = KeyClient(vault_url=self.vault_url, credential=cred)
        key = kc.get_key(key_name)
        return CryptographyClient(key, credential=cred)

    def current_version(self) -> int:
        return max(self.key_names)

    def get_key(self, version: int) -> bytes:
        if version in self._cache:
            return self._cache[version]
        if version not in self.key_names:
            raise KeyError(f"Azure KV KEK version {version} not configured")
        try:
            from azure.keyvault.keys.crypto import EncryptionAlgorithm
        except ImportError as e:
            raise ImportError(
                "AzureKVKEKProvider requires azure-keyvault-keys"
            ) from e
        client = self._crypto_client(self.key_names[version])
        try:
            result = client.encrypt(EncryptionAlgorithm.rsa_oaep_256, self._DERIVATION_INPUT)
        except Exception as e:
            logger.error("azure_kv_encrypt_failed",
                         key=self.key_names[version], error=str(e))
            raise
        import hashlib
        kek = hashlib.sha256(result.ciphertext).digest()
        self._cache[version] = kek
        logger.info("azure_kv_kek_loaded", version=version,
                    key=self.key_names[version][:50])
        return kek


# ─── Factory ──────────────────────────────────────────────────────────────────

def kek_provider_from_config(provider: str, **kwargs):
    """
    Build a KEKProvider from a string identifier + kwargs.

    provider:
      "env"     → EnvKEKProvider
      "aws_kms" → AWSKMSKEKProvider(key_arns=..., region=...)
      "gcp_kms" → GCPKMSKEKProvider(key_names=...)
      "azure_kv"→ AzureKVKEKProvider(vault_url=..., key_names=...)
    """
    p = provider.lower().strip()
    if p in ("env", "environment", ""):
        from app.core.security.key_store import EnvKEKProvider
        return EnvKEKProvider(**kwargs)
    if p in ("aws_kms", "aws", "kms"):
        return AWSKMSKEKProvider(**kwargs)
    if p in ("gcp_kms", "gcp"):
        return GCPKMSKEKProvider(**kwargs)
    if p in ("azure_kv", "azure"):
        return AzureKVKEKProvider(**kwargs)
    raise ValueError(f"unknown KEK provider: {provider}")
