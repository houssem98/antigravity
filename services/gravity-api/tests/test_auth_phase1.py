"""
Phase 1 auth: signup policy, email verification, password reset, rate limit.

Runs with TestClient against the FastAPI app. Uses in-memory AuthStore (no DB
pool wired in tests) and the real Redis only if available — falls back to a
FakeRedis monkey-patch otherwise.

Run:
    cd services/gravity-api
    .venv\\Scripts\\python -m pytest tests/test_auth_phase1.py -v
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("AUTH_JWT_SECRET", "test-secret-please-change-" + "x" * 16)
os.environ.setdefault("AUTH_TOKEN_SECRET", "test-token-secret-" + "y" * 24)
# Disable auth rate limit globally; tests that exercise it re-enable via
# monkeypatch.setenv("AUTH_RL_DISABLED", "").
os.environ.setdefault("AUTH_RL_DISABLED", "1")


# ── FakeRedis: minimal subset for our auth modules ───────────────────────────

class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, tuple[str, float | None]] = {}

    async def _gc(self) -> None:
        now = time.time()
        for k, (_, exp) in list(self.kv.items()):
            if exp is not None and exp < now:
                del self.kv[k]

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        await self._gc()
        exp = (time.time() + ex) if ex else None
        self.kv[key] = (str(value), exp)
        return True

    async def incr(self, key: str) -> int:
        await self._gc()
        v, exp = self.kv.get(key, ("0", None))
        n = int(v) + 1
        self.kv[key] = (str(n), exp)
        return n

    async def expire(self, key: str, seconds: int) -> bool:
        if key in self.kv:
            v, _ = self.kv[key]
            self.kv[key] = (v, time.time() + seconds)
            return True
        return False

    async def get(self, key: str) -> str | None:
        await self._gc()
        v = self.kv.get(key)
        return v[0] if v else None

    async def delete(self, *keys: str) -> int:
        n = 0
        for k in keys:
            if k in self.kv:
                del self.kv[k]
                n += 1
        return n

    async def scan_iter(self, match: str, count: int = 100):
        await self._gc()
        import fnmatch
        for k in list(self.kv.keys()):
            if fnmatch.fnmatch(k, match):
                yield k

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        pass


@pytest.fixture(scope="module")
def fake_redis():
    fr = FakeRedis()

    # Swap underlying client *inside* the lazy wrapper used app-wide.
    from app.db import redis as redis_mod
    redis_mod.redis_client._client = fr  # type: ignore[attr-defined]

    # Also patch any modules that already imported redis_client at module load.
    import app.core.security.auth_tokens as at
    import app.core.security.auth_rate_limit as arl
    at.redis_client = fr  # type: ignore[assignment]
    arl.redis_client = fr  # type: ignore[assignment]

    yield fr
    redis_mod.redis_client._client = None  # type: ignore[attr-defined]


@pytest.fixture(scope="module")
def client(fake_redis):
    """TestClient with all DBs disabled — AuthStore falls back to in-memory."""
    # Disable network-dependent startup so TestClient can boot offline.
    os.environ["DISABLE_SENTRY"] = "1"

    # Prevent SEC EDGAR background task from starting during tests
    os.environ["DISABLE_EDGAR_POLLING"] = "1"

    from app.main import app
    with TestClient(app) as c:
        # Force AuthStore to memory mode (no Postgres pool wired in tests)
        from app.api.routes import auth as auth_route
        auth_route._AUTH_STORE = None  # reset singleton; will rebuild w/o pool
        yield c


# ── Helpers ──────────────────────────────────────────────────────────────────

GOOD_PW = "StrongP@ssword2026!"
WEAK_PW = "password"


def _signup(client, email: str, pw: str = GOOD_PW) -> Any:
    return client.post("/v1/auth/signup", json={"email": email, "password": pw})


# ── Tests ────────────────────────────────────────────────────────────────────

def test_signup_rejects_short_password(client):
    r = _signup(client, "short@test.com", pw="abc")
    # Pydantic field validation rejects min_length=8 first
    assert r.status_code in (400, 422)


def test_signup_rejects_weak_password(client):
    r = _signup(client, "weak@test.com", pw="password1234")  # too common
    assert r.status_code == 400
    body = r.json()
    assert "password" in body["detail"].lower()


def test_signup_accepts_strong_password(client):
    r = _signup(client, "strong@test.com", pw=GOOD_PW)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "strong@test.com"
    assert body["user"]["email_verified"] is False
    assert "access_token" in body
    assert "refresh_token" in body


def test_signup_blocks_duplicate_email(client):
    email = "dup@test.com"
    r1 = _signup(client, email)
    assert r1.status_code == 201
    r2 = _signup(client, email)
    assert r2.status_code == 400


def test_login_works_with_correct_password(client):
    email = "login@test.com"
    _signup(client, email)
    r = client.post("/v1/auth/login", json={"email": email, "password": GOOD_PW})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_rejects_bad_password(client):
    email = "badpw@test.com"
    _signup(client, email)
    r = client.post("/v1/auth/login", json={"email": email, "password": "WrongPass1!XYZ"})
    assert r.status_code == 401


def test_verify_request_always_returns_202(client):
    """Account enumeration prevention — same response for known + unknown."""
    r1 = client.post("/v1/auth/verify/request", json={"email": "nonexistent@nope.com"})
    assert r1.status_code == 202

    email = "verifyenum@test.com"
    _signup(client, email)
    r2 = client.post("/v1/auth/verify/request", json={"email": email})
    assert r2.status_code == 202


def test_verify_confirm_full_flow(client, fake_redis):
    """Issue + consume verify token directly (bypassing email)."""
    from app.core.security import auth_tokens

    email = "verifyflow@test.com"
    sr = _signup(client, email)
    assert sr.status_code == 201

    # Fetch user_id from /me
    tok = sr.json()["access_token"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200
    assert me.json()["email_verified"] is False
    user_id = me.json()["user_id"]

    # Issue a fresh verify token (simulating clicking the email link)
    token = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "verify")
    )

    r = client.post("/v1/auth/verify/confirm", json={"token": token})
    assert r.status_code == 204, r.text

    me2 = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me2.json()["email_verified"] is True


def test_verify_token_is_single_use(client, fake_redis):
    from app.core.security import auth_tokens

    email = "verifyonce@test.com"
    sr = _signup(client, email)
    tok = sr.json()["access_token"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    user_id = me.json()["user_id"]

    vtok = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "verify")
    )
    r1 = client.post("/v1/auth/verify/confirm", json={"token": vtok})
    assert r1.status_code == 204
    r2 = client.post("/v1/auth/verify/confirm", json={"token": vtok})
    assert r2.status_code == 400  # already consumed


def test_verify_rejects_wrong_kind(client, fake_redis):
    """A reset token must not authorize email verification."""
    from app.core.security import auth_tokens

    email = "kindmix@test.com"
    sr = _signup(client, email)
    tok = sr.json()["access_token"]
    user_id = client.get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {tok}"}
    ).json()["user_id"]

    reset_tok = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "reset")
    )
    r = client.post("/v1/auth/verify/confirm", json={"token": reset_tok})
    assert r.status_code == 400


def test_password_reset_request_always_202(client):
    r1 = client.post("/v1/auth/password/reset/request", json={"email": "ghost@test.com"})
    assert r1.status_code == 202
    email = "resetreq@test.com"
    _signup(client, email)
    r2 = client.post("/v1/auth/password/reset/request", json={"email": email})
    assert r2.status_code == 202


def test_password_reset_full_flow(client, fake_redis):
    from app.core.security import auth_tokens

    email = "resetflow@test.com"
    sr = _signup(client, email)
    user_id = sr.json()["user"]["user_id"]
    new_pw = "BrandNewP@ss2026!"

    rt = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "reset")
    )
    r = client.post(
        "/v1/auth/password/reset/confirm",
        json={"token": rt, "new_password": new_pw},
    )
    assert r.status_code == 204, r.text

    # Old password no longer works
    old_login = client.post(
        "/v1/auth/login", json={"email": email, "password": GOOD_PW}
    )
    assert old_login.status_code == 401

    # New password works
    new_login = client.post(
        "/v1/auth/login", json={"email": email, "password": new_pw}
    )
    assert new_login.status_code == 200


def test_password_reset_rejects_weak_new_password(client, fake_redis):
    from app.core.security import auth_tokens

    email = "resetweak@test.com"
    sr = _signup(client, email)
    user_id = sr.json()["user"]["user_id"]

    rt = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "reset")
    )
    r = client.post(
        "/v1/auth/password/reset/confirm",
        json={"token": rt, "new_password": "weakweakweak"},
    )
    assert r.status_code == 400


def test_password_reset_token_is_single_use(client, fake_redis):
    from app.core.security import auth_tokens

    email = "resetonce@test.com"
    sr = _signup(client, email)
    user_id = sr.json()["user"]["user_id"]
    new_pw = "FirstReset@2026!"

    rt = asyncio.get_event_loop().run_until_complete(
        auth_tokens.issue_token(user_id, "reset")
    )
    r1 = client.post(
        "/v1/auth/password/reset/confirm",
        json={"token": rt, "new_password": new_pw},
    )
    assert r1.status_code == 204
    r2 = client.post(
        "/v1/auth/password/reset/confirm",
        json={"token": rt, "new_password": "AnotherReset@2026!"},
    )
    assert r2.status_code == 400


def test_login_rate_limit_per_email_blocks_after_threshold(client, fake_redis, monkeypatch):
    """10 login_email/5min — 11th should 429."""
    monkeypatch.setenv("AUTH_RL_DISABLED", "")  # re-enable RL for this test
    email = "ratelimited@test.com"
    _signup(client, email)
    # 10 wrong logins should not lock (below threshold)
    for i in range(10):
        r = client.post(
            "/v1/auth/login",
            json={"email": email, "password": "WrongPass!XYZ"},
        )
        assert r.status_code in (401, 429)
    # 11th must be 429
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": "WrongPass!XYZ"},
    )
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_password_policy_checks_hibp_offline_safe(monkeypatch):
    """If HIBP is offline, policy must not block (-1 pwned_count)."""
    from app.core.security import password_policy

    async def fake_pwned(_pw: str) -> int:
        return -1

    monkeypatch.setattr(password_policy, "_hibp_pwned_count", fake_pwned)
    result = await password_policy.check_password(GOOD_PW, email="ok@test.com")
    assert result.ok is True
    assert result.pwned_count == -1


@pytest.mark.asyncio
async def test_password_policy_blocks_breached_password(monkeypatch):
    from app.core.security import password_policy

    async def fake_pwned(_pw: str) -> int:
        return 12345

    monkeypatch.setattr(password_policy, "_hibp_pwned_count", fake_pwned)
    r = await password_policy.check_password(GOOD_PW, email="ok@test.com")
    assert r.ok is False
    assert any("breaches" in s for s in r.reasons)
