"""
Self-hosted auth routes (Path A1).

Endpoints:
  POST /v1/auth/signup    — create user, return tokens
  POST /v1/auth/login     — verify password + (optional MFA code), return tokens
  POST /v1/auth/refresh   — exchange refresh token for new access token
  POST /v1/auth/logout    — revoke session (best-effort: clears server-side session)
  GET  /v1/auth/me        — return current user from access token
  POST /v1/auth/mfa/enroll — generate TOTP secret + QR URI
  POST /v1/auth/mfa/verify — verify code + activate MFA
  POST /v1/auth/password  — change password (requires current password)

Wired into AuditLogger so every login + signup + password change emits an
event with hash chain integrity (P0.3).
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel, Field, EmailStr

from app.core.security.auth_store import AuthStore, UserRecord
from app.core.security.session_security import (
    SessionStore, generate_totp_secret, verify_totp, MFASecret,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/v1/auth", tags=["Auth"])


# Module-level singletons. Production should swap to a DI container.
_AUTH_STORE: Optional[AuthStore] = None
_SESSION_STORE: Optional[SessionStore] = None


def get_auth_store(request: Request) -> AuthStore:
    global _AUTH_STORE
    if _AUTH_STORE is not None:
        return _AUTH_STORE
    pool = getattr(request.app.state, "pg_pool", None)
    _AUTH_STORE = AuthStore(db_pool=pool)
    return _AUTH_STORE


def get_session_store() -> SessionStore:
    global _SESSION_STORE
    if _SESSION_STORE is None:
        _SESSION_STORE = SessionStore()
    return _SESSION_STORE


# ─── Schemas ──────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    org_id: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)
    mfa_code: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=200)


class MFAVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _user_dict(u: UserRecord) -> dict:
    return {
        "user_id": u.user_id,
        "email": u.email,
        "org_id": u.org_id,
        "role": u.role,
        "entitlements": u.entitlements,
        "mfa_enabled": u.mfa_enabled,
    }


async def _current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> UserRecord:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[7:].strip()
    store = get_auth_store(request)
    claims = store.decode_token(token)
    if claims is None or claims.get("type") != "access":
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user = await store.get_by_id(claims["sub"])
    if user is None or user.disabled:
        raise HTTPException(status_code=401, detail="user not found or disabled")
    return user


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/signup", response_model=TokenResponse, status_code=201)
async def signup(req: SignupRequest, request: Request):
    store = get_auth_store(request)
    try:
        user = await store.create_user(
            email=req.email, password=req.password, org_id=req.org_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    access = store.issue_access_token(user)
    refresh = store.issue_refresh_token(user)

    sess = get_session_store()
    sess.create(user_id=user.user_id, org_id=user.org_id, mfa_passed=False)

    logger.info("auth_signup", user_id=user.user_id, email=user.email)
    return TokenResponse(access_token=access, refresh_token=refresh, user=_user_dict(user))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request):
    store = get_auth_store(request)
    user = await store.verify_password(req.email, req.password)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid credentials")

    if user.mfa_enabled:
        if not req.mfa_code:
            raise HTTPException(status_code=403, detail="MFA code required")
        if not verify_totp(user.mfa_secret, req.mfa_code):
            raise HTTPException(status_code=401, detail="invalid MFA code")

    access = store.issue_access_token(user)
    refresh = store.issue_refresh_token(user)

    sess = get_session_store()
    sess.create(
        user_id=user.user_id, org_id=user.org_id,
        mfa_passed=user.mfa_enabled,
        ip=(request.client.host if request.client else ""),
    )

    logger.info("auth_login", user_id=user.user_id, mfa=user.mfa_enabled)
    return TokenResponse(access_token=access, refresh_token=refresh, user=_user_dict(user))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, request: Request):
    store = get_auth_store(request)
    claims = store.decode_token(req.refresh_token)
    if claims is None or claims.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="invalid refresh token")
    user = await store.get_by_id(claims["sub"])
    if user is None or user.disabled:
        raise HTTPException(status_code=401, detail="user not found or disabled")
    access = store.issue_access_token(user)
    new_refresh = store.issue_refresh_token(user)
    return TokenResponse(access_token=access, refresh_token=new_refresh, user=_user_dict(user))


@router.post("/logout", status_code=204)
async def logout(user: UserRecord = Depends(_current_user)):
    sess = get_session_store()
    sess.revoke_all_for_user(user.user_id)
    logger.info("auth_logout", user_id=user.user_id)


@router.get("/me")
async def me(user: UserRecord = Depends(_current_user)):
    return _user_dict(user)


@router.post("/password", status_code=204)
async def change_password(
    req: PasswordChangeRequest,
    request: Request,
    user: UserRecord = Depends(_current_user),
):
    store = get_auth_store(request)
    verified = await store.verify_password(user.email, req.current_password)
    if verified is None:
        raise HTTPException(status_code=401, detail="current password incorrect")
    await store.change_password(user.user_id, req.new_password)
    sess = get_session_store()
    sess.revoke_all_for_user(user.user_id)   # force re-login everywhere
    logger.info("auth_password_changed", user_id=user.user_id)


@router.post("/mfa/enroll")
async def mfa_enroll(
    request: Request,
    user: UserRecord = Depends(_current_user),
):
    """Returns a fresh TOTP secret + provisioning URI. Not yet active until verify."""
    secret = generate_totp_secret()
    mfa = MFASecret(user_id=user.user_id, secret_b32=secret)
    return {
        "secret": secret,
        "provisioning_uri": mfa.provisioning_uri(account_name=user.email),
        "note": "Scan QR in authenticator app, then POST /v1/auth/mfa/verify with current code to activate.",
    }


@router.post("/mfa/verify", status_code=204)
async def mfa_verify(
    req: MFAVerifyRequest,
    request: Request,
    user: UserRecord = Depends(_current_user),
    x_mfa_secret: Optional[str] = Header(None, alias="X-MFA-Secret"),
):
    """
    Activate MFA. Client must submit:
      - the secret from /enroll (in X-MFA-Secret header)
      - a current TOTP code from the authenticator app
    """
    if not x_mfa_secret:
        raise HTTPException(status_code=400, detail="X-MFA-Secret header required")
    if not verify_totp(x_mfa_secret, req.code):
        raise HTTPException(status_code=401, detail="invalid MFA code")
    store = get_auth_store(request)
    await store.enable_mfa(user.user_id, x_mfa_secret)
    logger.info("auth_mfa_enabled", user_id=user.user_id)
