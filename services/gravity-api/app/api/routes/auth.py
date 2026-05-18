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
    generate_recovery_codes, verify_recovery_code,
)
from app.core.security import auth_rate_limit, auth_tokens
from app.core.security.password_policy import check_password
from app.core.email_sender import (
    send_email, render, verify_link, reset_link,
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
        "email_verified": u.email_verified,
    }


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


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
    ip = _client_ip(request)
    await auth_rate_limit.enforce("signup", ip=ip, email=req.email)

    policy = await check_password(req.password, email=req.email)
    if not policy.ok:
        raise HTTPException(status_code=400, detail="; ".join(policy.reasons))

    store = get_auth_store(request)
    try:
        user = await store.create_user(
            email=req.email, password=req.password, org_id=req.org_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Fire-and-forget verification email. Never block signup if email fails.
    try:
        token = await auth_tokens.issue_token(user.user_id, "verify")
        await send_email(
            to=user.email,
            subject="Verify your email — AlphaSense AI",
            html=render("verify", link=verify_link(token)),
        )
    except Exception as e:
        logger.warning("auth_verify_email_failed", error=str(e), user_id=user.user_id)

    access = store.issue_access_token(user)
    refresh = store.issue_refresh_token(user)

    sess = get_session_store()
    sess.create(user_id=user.user_id, org_id=user.org_id, mfa_passed=False)

    logger.info("auth_signup", user_id=user.user_id, email=user.email)
    return TokenResponse(access_token=access, refresh_token=refresh, user=_user_dict(user))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    await auth_rate_limit.enforce("login", ip=ip, email=req.email)

    store = get_auth_store(request)
    user = await store.verify_password(req.email, req.password)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid credentials")

    if user.mfa_enabled:
        if not req.mfa_code:
            raise HTTPException(status_code=403, detail="MFA code required")
        code = req.mfa_code.strip()
        passed = False
        # 6-digit numeric → TOTP. Anything else → try recovery code.
        if len(code) == 6 and code.isdigit():
            passed = verify_totp(user.mfa_secret, code)
        else:
            matched, remaining = verify_recovery_code(code, user.recovery_codes_hashed)
            if matched:
                await store.set_recovery_codes(user.user_id, remaining)
                passed = True
        if not passed:
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
    policy = await check_password(req.new_password, email=user.email)
    if not policy.ok:
        raise HTTPException(status_code=400, detail="; ".join(policy.reasons))
    await store.change_password(user.user_id, req.new_password)
    sess = get_session_store()
    sess.revoke_all_for_user(user.user_id)   # force re-login everywhere
    await auth_tokens.revoke_all_for_user(user.user_id, "reset")
    logger.info("auth_password_changed", user_id=user.user_id)


@router.post("/mfa/enroll")
async def mfa_enroll(
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


@router.get("/mfa/qr", responses={200: {"content": {"image/png": {}}}})
async def mfa_qr(secret: str, email: str = ""):
    """Render the provisioning URI for `secret` as a PNG QR code.

    Stateless on purpose — client supplies the secret it received from /enroll
    so we don't have to persist a half-enrolled record.
    """
    import io
    import qrcode  # type: ignore
    from qrcode.image.pure import PyPNGImage  # type: ignore

    mfa = MFASecret(user_id="", secret_b32=secret)
    uri = mfa.provisioning_uri(account_name=email or "user")
    # PyPNGImage is pure-Python — no PIL/Pillow runtime dep required.
    img = qrcode.make(uri, image_factory=PyPNGImage)
    buf = io.BytesIO()
    img.save(buf)
    buf.seek(0)
    from fastapi.responses import Response
    return Response(content=buf.read(), media_type="image/png")


@router.post("/mfa/verify")
async def mfa_verify(
    req: MFAVerifyRequest,
    request: Request,
    user: UserRecord = Depends(_current_user),
    x_mfa_secret: Optional[str] = Header(None, alias="X-MFA-Secret"),
):
    """
    Activate MFA + return one-time-visible recovery codes.

    Client must submit:
      - secret from /enroll (in X-MFA-Secret header)
      - current 6-digit TOTP code from authenticator app

    Response: 10 plaintext recovery codes. **Shown once.** Display them to the
    user and instruct them to download / store somewhere safe.
    """
    if not x_mfa_secret:
        raise HTTPException(status_code=400, detail="X-MFA-Secret header required")
    if not verify_totp(x_mfa_secret, req.code):
        raise HTTPException(status_code=401, detail="invalid MFA code")
    store = get_auth_store(request)
    await store.enable_mfa(user.user_id, x_mfa_secret)
    plain, hashed = generate_recovery_codes(10)
    await store.set_recovery_codes(user.user_id, hashed)
    logger.info("auth_mfa_enabled", user_id=user.user_id, recovery_codes_issued=len(plain))
    return {"mfa_enabled": True, "recovery_codes": plain}


class MFADisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@router.post("/mfa/disable", status_code=204)
async def mfa_disable(
    req: MFADisableRequest,
    request: Request,
    user: UserRecord = Depends(_current_user),
):
    """Require password re-entry to disable MFA (step-up auth)."""
    store = get_auth_store(request)
    verified = await store.verify_password(user.email, req.password)
    if verified is None:
        raise HTTPException(status_code=401, detail="password incorrect")
    if not user.mfa_enabled:
        return
    await store.disable_mfa(user.user_id)
    logger.info("auth_mfa_disabled", user_id=user.user_id)


class MFARecoveryRegenerateRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)


@router.post("/mfa/recovery/regenerate")
async def mfa_recovery_regenerate(
    req: MFARecoveryRegenerateRequest,
    request: Request,
    user: UserRecord = Depends(_current_user),
):
    """Invalidate previous recovery codes + issue a fresh set of 10."""
    if not user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is not enabled for this account")
    store = get_auth_store(request)
    verified = await store.verify_password(user.email, req.password)
    if verified is None:
        raise HTTPException(status_code=401, detail="password incorrect")
    plain, hashed = generate_recovery_codes(10)
    await store.set_recovery_codes(user.user_id, hashed)
    logger.info("auth_recovery_codes_regenerated", user_id=user.user_id)
    return {"recovery_codes": plain}


# ─── Email verification ──────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    email: EmailStr


class TokenOnly(BaseModel):
    token: str = Field(min_length=10, max_length=2048)


@router.post("/verify/request", status_code=202)
async def verify_request(req: VerifyRequest, request: Request):
    """Send (or re-send) an email-verification link. Always returns 202 to avoid
    account enumeration."""
    ip = _client_ip(request)
    await auth_rate_limit.enforce("verify_request", ip=ip, email=req.email)

    store = get_auth_store(request)
    user = await store.get_by_email(req.email)
    if user is not None and not user.email_verified and not user.disabled:
        try:
            token = await auth_tokens.issue_token(user.user_id, "verify")
            await send_email(
                to=user.email,
                subject="Verify your email — AlphaSense AI",
                html=render("verify", link=verify_link(token)),
            )
        except Exception as e:
            logger.warning("auth_verify_resend_failed", error=str(e))
    return {"status": "ok"}


@router.post("/verify/confirm", status_code=204)
async def verify_confirm(req: TokenOnly, request: Request):
    user_id = await auth_tokens.consume_token(req.token, "verify")
    if user_id is None:
        raise HTTPException(status_code=400, detail="invalid or expired token")
    store = get_auth_store(request)
    user = await store.get_by_id(user_id)
    if user is None or user.disabled:
        raise HTTPException(status_code=400, detail="user not found")
    await store.mark_email_verified(user_id)
    logger.info("auth_email_verified", user_id=user_id)


# ─── Password reset (forgot password) ────────────────────────────────────────

class ResetRequest(BaseModel):
    email: EmailStr


class ResetConfirm(BaseModel):
    token: str = Field(min_length=10, max_length=2048)
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/password/reset/request", status_code=202)
async def password_reset_request(req: ResetRequest, request: Request):
    """Email a single-use reset link. Always 202 to prevent account enumeration."""
    ip = _client_ip(request)
    await auth_rate_limit.enforce("reset_request", ip=ip, email=req.email)

    store = get_auth_store(request)
    user = await store.get_by_email(req.email)
    if user is not None and not user.disabled:
        try:
            token = await auth_tokens.issue_token(user.user_id, "reset")
            await send_email(
                to=user.email,
                subject="Reset your password — AlphaSense AI",
                html=render("reset", link=reset_link(token)),
            )
            logger.info("auth_reset_requested", user_id=user.user_id)
        except Exception as e:
            logger.warning("auth_reset_email_failed", error=str(e))
    return {"status": "ok"}


@router.post("/password/reset/confirm", status_code=204)
async def password_reset_confirm(req: ResetConfirm, request: Request):
    ip = _client_ip(request)
    await auth_rate_limit.enforce("reset_confirm", ip=ip)

    user_id = await auth_tokens.consume_token(req.token, "reset")
    if user_id is None:
        raise HTTPException(status_code=400, detail="invalid or expired token")

    store = get_auth_store(request)
    user = await store.get_by_id(user_id)
    if user is None or user.disabled:
        raise HTTPException(status_code=400, detail="user not found")

    policy = await check_password(req.new_password, email=user.email)
    if not policy.ok:
        raise HTTPException(status_code=400, detail="; ".join(policy.reasons))

    await store.change_password(user.user_id, req.new_password)

    sess = get_session_store()
    sess.revoke_all_for_user(user.user_id)
    await auth_tokens.revoke_all_for_user(user.user_id, "reset")
    logger.info("auth_password_reset", user_id=user.user_id)
