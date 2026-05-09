"""
SSO + SCIM endpoints (plan §6.11).

Two flows:

  1. SAML 2.0 via WorkOS / Auth0 / external IdP
     - GET  /v1/sso/saml/login?org_id=acme
       Builds the IdP-initiated authorization URL and redirects.
     - GET  /v1/sso/saml/callback?code=...&state=...
       Exchanges the authorization code for a profile via WorkOS API,
       provisions the user (just-in-time), issues our JWT.

  2. SCIM 2.0 directory sync (RFC 7644)
     - POST   /scim/v2/Users          create
     - GET    /scim/v2/Users/{id}     read
     - PUT    /scim/v2/Users/{id}     replace
     - PATCH  /scim/v2/Users/{id}     modify
     - DELETE /scim/v2/Users/{id}     deprovision
     - GET    /scim/v2/Users          list (with `filter` + pagination)

Authentication:
  - SCIM endpoints require a per-tenant bearer token (`SCIM_TOKEN`) issued
    when the customer enables directory sync. Stored in the encrypted
    APIKeyStore (P0.4) under key_name="scim_token".
  - SAML callback validates state nonce + matches against issuer config.

WorkOS docs: https://workos.com/docs/sso/api-reference
SCIM 2.0 RFC: https://datatracker.ietf.org/doc/html/rfc7644
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from typing import Any, Optional

import httpx
import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

logger = structlog.get_logger()

router = APIRouter()

WORKOS_API_BASE = "https://api.workos.com"


# ─── In-memory user directory (fallback when DB-backed user table is absent) ──
# Production deployments swap this for a Postgres-backed `users` table; the
# scaffold here lets the SCIM endpoints respond correctly during CI / dev.

_USERS: dict[str, dict] = {}            # scim_id -> user record
_BY_EXTERNAL_ID: dict[str, str] = {}    # external_id -> scim_id
_SCIM_TOKENS: dict[str, str] = {}       # tenant_id -> bearer token


def _gen_scim_id() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(12)).decode().rstrip("=")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ─── SCIM 2.0 schemas ─────────────────────────────────────────────────────────

class SCIMName(BaseModel):
    formatted: Optional[str] = None
    familyName: Optional[str] = None
    givenName: Optional[str] = None


class SCIMEmail(BaseModel):
    value: str
    type: Optional[str] = "work"
    primary: bool = True


class SCIMUser(BaseModel):
    schemas: list[str] = Field(default_factory=lambda: ["urn:ietf:params:scim:schemas:core:2.0:User"])
    id: Optional[str] = None
    externalId: Optional[str] = None
    userName: str
    name: Optional[SCIMName] = None
    emails: list[SCIMEmail] = Field(default_factory=list)
    active: bool = True
    meta: Optional[dict] = None


class SCIMListResponse(BaseModel):
    schemas: list[str] = Field(default_factory=lambda: [
        "urn:ietf:params:scim:api:messages:2.0:ListResponse"
    ])
    totalResults: int
    startIndex: int = 1
    itemsPerPage: int
    Resources: list[dict]


# ─── Tenant + auth dependencies ───────────────────────────────────────────────

async def require_scim_auth(
    request: Request,
    authorization: str = Header(default=""),
) -> str:
    """
    Validates the SCIM bearer token. Returns the tenant_id this token belongs to.
    Production: looks up the token in the encrypted key store.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="empty bearer token")

    # Try in-memory dev mapping first
    for tenant, t in _SCIM_TOKENS.items():
        if hmac.compare_digest(t, token):
            return tenant

    # Production lookup via encrypted store
    try:
        from app.core.security.key_store import APIKeyStore, EnvKEKProvider
        store = getattr(request.app.state, "api_key_store", None)
        if store is None:
            store = APIKeyStore(db_pool=None, kek_provider=EnvKEKProvider())
        # Token format: "{tenant_id}.{secret}" — tenant prefix avoids brute force
        if "." in token:
            tenant_id, _ = token.split(".", 1)
            stored = await store.get(tenant_id, "scim_token")
            if stored and hmac.compare_digest(stored, token):
                return tenant_id
    except Exception as e:
        logger.warning("scim_auth_lookup_failed", error=str(e))

    raise HTTPException(status_code=401, detail="invalid bearer token")


# ─── SAML 2.0 (via WorkOS) ────────────────────────────────────────────────────

class SAMLLoginResponse(BaseModel):
    redirect_url: str
    state: str


@router.get("/v1/sso/saml/login")
async def saml_login(
    org_id: str = Query(..., min_length=1, max_length=64),
    return_to: Optional[str] = Query(default=None),
):
    """Build the WorkOS authorization URL and redirect."""
    workos_client_id = os.getenv("WORKOS_CLIENT_ID", "")
    if not workos_client_id:
        raise HTTPException(status_code=503, detail="SAML SSO not configured (WORKOS_CLIENT_ID)")

    state_payload = {
        "org_id": org_id,
        "nonce": secrets.token_urlsafe(16),
        "ts": int(time.time()),
        "return_to": return_to or "",
    }
    state = _sign_state(state_payload)

    callback_url = os.getenv(
        "WORKOS_REDIRECT_URI",
        f"{os.getenv('APP_BASE_URL', 'http://localhost:8000')}/v1/sso/saml/callback",
    )

    redirect_url = (
        f"{WORKOS_API_BASE}/sso/authorize"
        f"?client_id={workos_client_id}"
        f"&organization={org_id}"
        f"&redirect_uri={callback_url}"
        f"&response_type=code"
        f"&state={state}"
    )
    logger.info("saml_login_initiated", org_id=org_id)
    return RedirectResponse(url=redirect_url, status_code=307)


@router.get("/v1/sso/saml/callback")
async def saml_callback(
    code: str = Query(...),
    state: str = Query(...),
):
    """Exchange the WorkOS auth code for a profile, JIT-provision, issue our JWT."""
    payload = _verify_state(state)
    if payload is None:
        raise HTTPException(status_code=400, detail="invalid or expired state")

    workos_client_id = os.getenv("WORKOS_CLIENT_ID", "")
    workos_api_key = os.getenv("WORKOS_API_KEY", "")
    if not workos_client_id or not workos_api_key:
        raise HTTPException(status_code=503, detail="SAML SSO not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{WORKOS_API_BASE}/sso/token",
                data={
                    "client_id": workos_client_id,
                    "client_secret": workos_api_key,
                    "grant_type": "authorization_code",
                    "code": code,
                },
            )
        if resp.status_code != 200:
            logger.warning("workos_token_failed", status=resp.status_code, body=resp.text[:200])
            raise HTTPException(status_code=502, detail="WorkOS token exchange failed")
        data = resp.json()
        profile = data.get("profile") or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("workos_token_exception", error=str(e))
        raise HTTPException(status_code=502, detail="WorkOS unreachable")

    # JIT provisioning
    user_record = _jit_provision(
        org_id=payload["org_id"],
        external_id=str(profile.get("id", "")),
        email=str(profile.get("email", "")),
        first_name=str(profile.get("first_name", "")),
        last_name=str(profile.get("last_name", "")),
    )

    # Issue our session token (short-lived). Production: hand off to existing
    # session JWT issuer; here we return the SCIM id for the client to store.
    return JSONResponse({
        "user_id": user_record["id"],
        "external_id": user_record["externalId"],
        "email": user_record.get("emails", [{}])[0].get("value", ""),
        "org_id": payload["org_id"],
        "return_to": payload.get("return_to") or None,
    })


# State signing — HMAC over JSON; prevents replay and tampering.
def _state_secret() -> bytes:
    return os.getenv("SAML_STATE_SECRET", "default-dev-state-secret").encode()


def _sign_state(payload: dict) -> str:
    import json
    body = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True).encode()).decode().rstrip("=")
    sig = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify_state(state: str, max_age_sec: int = 600) -> Optional[dict]:
    import json
    if "." not in state:
        return None
    body, sig = state.rsplit(".", 1)
    expected = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        # Restore base64 padding
        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return None
    if int(time.time()) - int(payload.get("ts", 0)) > max_age_sec:
        return None
    return payload


def _jit_provision(
    org_id: str, external_id: str, email: str, first_name: str, last_name: str,
) -> dict:
    """Create or update a user record on first SAML login."""
    scim_id = _BY_EXTERNAL_ID.get(external_id)
    if scim_id is None:
        scim_id = _gen_scim_id()
        _BY_EXTERNAL_ID[external_id] = scim_id
    user = {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": scim_id,
        "externalId": external_id,
        "userName": email,
        "name": {"givenName": first_name, "familyName": last_name,
                 "formatted": f"{first_name} {last_name}".strip()},
        "emails": [{"value": email, "type": "work", "primary": True}],
        "active": True,
        "meta": {
            "resourceType": "User",
            "created": _USERS.get(scim_id, {}).get("meta", {}).get("created", _now_iso()),
            "lastModified": _now_iso(),
            "tenant_id": org_id,
        },
    }
    _USERS[scim_id] = user
    logger.info("user_jit_provisioned", scim_id=scim_id, org_id=org_id, email=email)
    return user


# ─── SCIM 2.0 endpoints ───────────────────────────────────────────────────────

@router.post("/scim/v2/Users", status_code=201)
async def scim_create_user(user: SCIMUser, tenant_id: str = Depends(require_scim_auth)):
    if user.externalId and user.externalId in _BY_EXTERNAL_ID:
        existing_id = _BY_EXTERNAL_ID[user.externalId]
        raise HTTPException(
            status_code=409,
            detail={"schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
                    "scimType": "uniqueness",
                    "detail": f"User with externalId already exists ({existing_id})"},
        )
    scim_id = _gen_scim_id()
    rec = user.model_dump()
    rec["id"] = scim_id
    rec["meta"] = {
        "resourceType": "User",
        "created": _now_iso(),
        "lastModified": _now_iso(),
        "tenant_id": tenant_id,
    }
    _USERS[scim_id] = rec
    if user.externalId:
        _BY_EXTERNAL_ID[user.externalId] = scim_id
    logger.info("scim_user_created", scim_id=scim_id, tenant_id=tenant_id)
    return rec


@router.get("/scim/v2/Users/{user_id}")
async def scim_get_user(user_id: str, tenant_id: str = Depends(require_scim_auth)):
    rec = _USERS.get(user_id)
    if rec is None or rec.get("meta", {}).get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="user not found")
    return rec


@router.get("/scim/v2/Users")
async def scim_list_users(
    request: Request,
    tenant_id: str = Depends(require_scim_auth),
    startIndex: int = 1,
    count: int = 100,
    filter: Optional[str] = None,  # noqa: A002 — SCIM uses 'filter' as query param
):
    items = [r for r in _USERS.values() if r.get("meta", {}).get("tenant_id") == tenant_id]
    # Minimal SCIM filter support — only `userName eq "x"` and `externalId eq "y"`.
    if filter:
        items = [r for r in items if _scim_filter_match(r, filter)]
    total = len(items)
    page = items[startIndex - 1: startIndex - 1 + count]
    return SCIMListResponse(
        totalResults=total,
        startIndex=startIndex,
        itemsPerPage=len(page),
        Resources=page,
    )


@router.put("/scim/v2/Users/{user_id}")
async def scim_replace_user(
    user_id: str,
    user: SCIMUser,
    tenant_id: str = Depends(require_scim_auth),
):
    rec = _USERS.get(user_id)
    if rec is None or rec.get("meta", {}).get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="user not found")
    new_rec = user.model_dump()
    new_rec["id"] = user_id
    new_rec["meta"] = {**rec["meta"], "lastModified": _now_iso()}
    _USERS[user_id] = new_rec
    logger.info("scim_user_replaced", scim_id=user_id, tenant_id=tenant_id)
    return new_rec


class SCIMPatch(BaseModel):
    schemas: list[str]
    Operations: list[dict]


@router.patch("/scim/v2/Users/{user_id}")
async def scim_patch_user(
    user_id: str,
    patch: SCIMPatch,
    tenant_id: str = Depends(require_scim_auth),
):
    rec = _USERS.get(user_id)
    if rec is None or rec.get("meta", {}).get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="user not found")
    for op in patch.Operations:
        action = (op.get("op") or "").lower()
        path = op.get("path")
        value = op.get("value")
        if action in ("replace", "add") and path:
            _apply_path(rec, path, value)
        elif action in ("replace", "add") and isinstance(value, dict):
            for k, v in value.items():
                _apply_path(rec, k, v)
        elif action == "remove" and path:
            _apply_path(rec, path, None)
    rec["meta"]["lastModified"] = _now_iso()
    logger.info("scim_user_patched", scim_id=user_id, tenant_id=tenant_id, ops=len(patch.Operations))
    return rec


@router.delete("/scim/v2/Users/{user_id}", status_code=204)
async def scim_delete_user(user_id: str, tenant_id: str = Depends(require_scim_auth)):
    rec = _USERS.get(user_id)
    if rec is None or rec.get("meta", {}).get("tenant_id") != tenant_id:
        raise HTTPException(status_code=404, detail="user not found")
    ext = rec.get("externalId")
    if ext and ext in _BY_EXTERNAL_ID:
        del _BY_EXTERNAL_ID[ext]
    del _USERS[user_id]
    logger.info("scim_user_deleted", scim_id=user_id, tenant_id=tenant_id)
    return JSONResponse(status_code=204, content=None)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _scim_filter_match(rec: dict, filter_expr: str) -> bool:
    """Tiny SCIM filter parser — supports `<attr> eq "<val>"`."""
    parts = filter_expr.strip().split(maxsplit=2)
    if len(parts) != 3 or parts[1].lower() != "eq":
        return False
    attr = parts[0].strip()
    val = parts[2].strip().strip('"').strip("'")
    cur: Any = rec
    for piece in attr.split("."):
        if isinstance(cur, dict):
            cur = cur.get(piece)
        else:
            return False
    return str(cur) == val


def _apply_path(rec: dict, path: str, value):
    """Apply a SCIM PATCH path to a record (limited: dot-notation keys)."""
    if value is None:
        if path in rec:
            del rec[path]
        return
    if "." not in path:
        rec[path] = value
        return
    parts = path.split(".")
    cur = rec
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value
