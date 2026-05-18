"""
Phase 2 auth: MFA enrollment + recovery codes + login challenge.

Re-uses the FakeRedis monkey-patch from test_auth_phase1.py.
"""

from __future__ import annotations

import asyncio
import os
import time

import pyotp
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("AUTH_JWT_SECRET", "test-secret-please-change-" + "x" * 16)
os.environ.setdefault("AUTH_TOKEN_SECRET", "test-token-secret-" + "y" * 24)
os.environ.setdefault("AUTH_RL_DISABLED", "1")


# Reuse FakeRedis from phase1 test
from tests.test_auth_phase1 import FakeRedis, GOOD_PW


@pytest.fixture(scope="module")
def fake_redis():
    fr = FakeRedis()
    from app.db import redis as redis_mod
    redis_mod.redis_client._client = fr  # type: ignore[attr-defined]
    import app.core.security.auth_tokens as at
    import app.core.security.auth_rate_limit as arl
    at.redis_client = fr  # type: ignore[assignment]
    arl.redis_client = fr  # type: ignore[assignment]
    yield fr
    redis_mod.redis_client._client = None  # type: ignore[attr-defined]


@pytest.fixture(scope="module")
def client(fake_redis):
    os.environ["DISABLE_SENTRY"] = "1"
    os.environ["DISABLE_EDGAR_POLLING"] = "1"
    from app.main import app
    with TestClient(app) as c:
        from app.api.routes import auth as auth_route
        auth_route._AUTH_STORE = None
        yield c


def _signup(client, email: str) -> dict:
    r = client.post("/v1/auth/signup", json={"email": email, "password": GOOD_PW})
    assert r.status_code == 201, r.text
    return r.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_mfa_enroll_returns_secret_and_uri(client):
    s = _signup(client, "mfaenroll@test.com")
    r = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(s["access_token"]))
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("secret"), str)
    assert body["secret"].isalnum()
    assert body["provisioning_uri"].startswith("otpauth://totp/")


def test_mfa_verify_with_wrong_code_rejected(client):
    s = _signup(client, "mfawrong@test.com")
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(s["access_token"])).json()
    r = client.post(
        "/v1/auth/mfa/verify",
        headers={**_auth_headers(s["access_token"]), "X-MFA-Secret": enroll["secret"]},
        json={"code": "000000"},
    )
    assert r.status_code == 401


def test_mfa_full_flow_then_login_requires_totp(client):
    email = "mfafull@test.com"
    s = _signup(client, email)
    tok = s["access_token"]
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(tok)).json()
    secret = enroll["secret"]

    valid_code = pyotp.TOTP(secret).now()
    r = client.post(
        "/v1/auth/mfa/verify",
        headers={**_auth_headers(tok), "X-MFA-Secret": secret},
        json={"code": valid_code},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mfa_enabled"] is True
    codes = body["recovery_codes"]
    assert isinstance(codes, list)
    assert len(codes) == 10
    assert all(isinstance(c, str) and len(c) > 4 for c in codes)

    # /me now shows mfa_enabled
    me = client.get("/v1/auth/me", headers=_auth_headers(tok)).json()
    assert me["mfa_enabled"] is True

    # Login without MFA → 403
    r = client.post("/v1/auth/login", json={"email": email, "password": GOOD_PW})
    assert r.status_code == 403
    assert "MFA" in r.json()["detail"]

    # Login with valid TOTP → 200
    code2 = pyotp.TOTP(secret).now()
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": code2},
    )
    assert r.status_code == 200

    # Login with wrong TOTP → 401
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": "999999"},
    )
    assert r.status_code == 401

    return {"email": email, "secret": secret, "codes": codes, "token": tok}


def test_login_with_recovery_code_consumes_once(client):
    email = "mfarecovery@test.com"
    s = _signup(client, email)
    tok = s["access_token"]
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(tok)).json()
    secret = enroll["secret"]
    r = client.post(
        "/v1/auth/mfa/verify",
        headers={**_auth_headers(tok), "X-MFA-Secret": secret},
        json={"code": pyotp.TOTP(secret).now()},
    )
    codes = r.json()["recovery_codes"]
    one_code = codes[0]

    # Login with recovery code → 200
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": one_code},
    )
    assert r.status_code == 200, r.text

    # Same recovery code re-used → 401
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": one_code},
    )
    assert r.status_code == 401

    # A different unused code still works
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": codes[1]},
    )
    assert r.status_code == 200


def test_mfa_disable_requires_password(client):
    email = "mfadisable@test.com"
    s = _signup(client, email)
    tok = s["access_token"]
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(tok)).json()
    secret = enroll["secret"]
    client.post(
        "/v1/auth/mfa/verify",
        headers={**_auth_headers(tok), "X-MFA-Secret": secret},
        json={"code": pyotp.TOTP(secret).now()},
    )

    # Wrong password → 401
    r = client.post(
        "/v1/auth/mfa/disable",
        headers=_auth_headers(tok),
        json={"password": "WrongPassword!2026"},
    )
    assert r.status_code == 401

    # Correct password → 204
    r = client.post(
        "/v1/auth/mfa/disable",
        headers=_auth_headers(tok),
        json={"password": GOOD_PW},
    )
    assert r.status_code == 204

    # Login no longer requires MFA
    r = client.post("/v1/auth/login", json={"email": email, "password": GOOD_PW})
    assert r.status_code == 200


def test_mfa_recovery_regenerate_invalidates_old_codes(client):
    email = "mfaregen@test.com"
    s = _signup(client, email)
    tok = s["access_token"]
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(tok)).json()
    secret = enroll["secret"]
    first = client.post(
        "/v1/auth/mfa/verify",
        headers={**_auth_headers(tok), "X-MFA-Secret": secret},
        json={"code": pyotp.TOTP(secret).now()},
    ).json()
    old_code = first["recovery_codes"][0]

    # Regenerate
    r = client.post(
        "/v1/auth/mfa/recovery/regenerate",
        headers=_auth_headers(tok),
        json={"password": GOOD_PW},
    )
    assert r.status_code == 200
    new_codes = r.json()["recovery_codes"]
    assert len(new_codes) == 10
    assert old_code not in new_codes

    # Old code rejected at login
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": old_code},
    )
    assert r.status_code == 401

    # New code accepted
    r = client.post(
        "/v1/auth/login",
        json={"email": email, "password": GOOD_PW, "mfa_code": new_codes[0]},
    )
    assert r.status_code == 200


def test_mfa_qr_returns_png(client):
    s = _signup(client, "mfaqr@test.com")
    enroll = client.post("/v1/auth/mfa/enroll", headers=_auth_headers(s["access_token"])).json()
    r = client.get(f"/v1/auth/mfa/qr?secret={enroll['secret']}&email=mfaqr@test.com")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG\r\n")
    assert len(r.content) > 100
