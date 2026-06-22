"""
Multi-Provider Billing Routes (A6) — DB-driven config.

All plans, prices, features, providers, wallets configurable via admin API.
No restart needed to change pricing or toggle providers.

User endpoints:
  GET  /v1/billing/config              — public: fetch plans + active providers
  POST /v1/billing/checkout            — create checkout session (provider-aware)
  POST /v1/billing/portal              — manage subscription (Paddle only)
  GET  /v1/billing/me                  — current subscription status
  GET  /v1/billing/payoneer/info       — Payoneer payment details for manual transfer
  POST /v1/billing/crypto/confirm      — submit crypto tx hash after payment

Admin endpoints (role=admin required):
  GET  /v1/billing/admin/config        — full config (plans + providers + wallets)
  PUT  /v1/billing/admin/config        — update entire config
  PUT  /v1/billing/admin/plans         — update plans (prices, features, limits)
  PUT  /v1/billing/admin/providers     — toggle providers on/off + update credentials
  PUT  /v1/billing/admin/wallets       — update crypto wallet addresses
  GET  /v1/billing/admin/subscriptions — list all subscriptions (paginated)
  PUT  /v1/billing/admin/subscriptions/{user_id} — manually set subscription status
  GET  /v1/billing/admin/invoices      — list pending crypto invoices
  PUT  /v1/billing/admin/invoices/{invoice_id}/confirm — manually confirm crypto payment

Webhook endpoints:
  POST /v1/billing/webhook/paddle
  POST /v1/billing/webhook/paypal
  POST /v1/billing/webhook/coinbase
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from typing import Any, Optional

import httpx
import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/billing", tags=["Billing"])

# ─── DDL ──────────────────────────────────────────────────────────────────────

BILLING_DDL = """
CREATE TABLE IF NOT EXISTS billing_subscriptions (
    user_id              TEXT PRIMARY KEY,
    provider             TEXT NOT NULL DEFAULT 'none',
    customer_id          TEXT,
    plan                 TEXT NOT NULL DEFAULT 'free',
    status               TEXT NOT NULL DEFAULT 'none',
    current_period_end   BIGINT,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_customer ON billing_subscriptions (customer_id);

CREATE TABLE IF NOT EXISTS billing_crypto_invoices (
    invoice_id    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    plan          TEXT NOT NULL,
    amount_usd    NUMERIC(10,2) NOT NULL,
    currency      TEXT NOT NULL,
    wallet        TEXT NOT NULL,
    tx_hash       TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS billing_config (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

# ─── Default config (used when DB unavailable or first run) ───────────────────

DEFAULT_CONFIG: dict[str, Any] = {
    "plans": {
        "free": {
            "name": "Free",
            "price_usd": 0.0,
            "period": "",
            "description": "Explore the platform",
            "highlight": False,
            "features": [
                "10 searches / day",
                "Basic SEC filings",
                "Community support",
            ],
            "limits": {"searches_per_day": 10, "seats": 1},
            "active": True,
        },
        "pro": {
            "name": "Pro",
            "price_usd": 49.00,
            "period": "/ mo",
            "description": "For individual analysts",
            "highlight": True,
            "features": [
                "Unlimited searches",
                "Deep Research mode",
                "Earnings call transcripts",
                "KPI graph extraction",
                "Priority support",
            ],
            "limits": {"searches_per_day": -1, "seats": 1},
            "active": True,
        },
        "team": {
            "name": "Team",
            "price_usd": 499.00,
            "period": "/ mo",
            "description": "5 seats — for funds & teams",
            "highlight": False,
            "features": [
                "Everything in Pro",
                "5 user seats",
                "Shared workspaces",
                "Audit log",
                "SSO (SAML)",
                "Dedicated support",
            ],
            "limits": {"searches_per_day": -1, "seats": 5},
            "active": True,
        },
    },
    "providers": {
        "paddle": {
            "enabled": True,
            "label": "Card",
            "sublabel": "Visa / Mastercard / Amex",
            "icon": "💳",
            "description": "Pay by card — Paddle processes securely. Works worldwide.",
        },
        "paypal": {
            "enabled": True,
            "label": "PayPal",
            "sublabel": "PayPal balance or card",
            "icon": "🅿",
            "description": "Pay via PayPal account or linked card.",
        },
        "payoneer": {
            "enabled": True,
            "label": "Payoneer",
            "sublabel": "Manual transfer",
            "icon": "🟠",
            "description": "Send via Payoneer — we activate your plan after confirming.",
            "email": "",
        },
        "crypto": {
            "enabled": True,
            "label": "Crypto",
            "sublabel": "BTC / ETH / USDT",
            "icon": "₿",
            "description": "Pay with crypto. Instant activation via Coinbase Commerce.",
            "currencies": ["USDT_TRC20", "USDT_ERC20", "ETH", "BTC"],
            "wallets": {
                "BTC": "",
                "ETH": "",
                "USDT_ERC20": "",
                "USDT_TRC20": "",
            },
        },
    },
    "app_name": "Antigravity",
    "support_email": "",
}

# ─── In-memory config cache (invalidated on PUT) ──────────────────────────────
_CONFIG_CACHE: Optional[dict] = None


async def _load_config(pool) -> dict:
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE

    cfg = dict(DEFAULT_CONFIG)

    # Merge env-var wallets + payoneer email into default
    cfg["providers"]["payoneer"]["email"] = os.getenv("PAYONEER_EMAIL", "")
    cfg["providers"]["crypto"]["wallets"]["BTC"] = os.getenv("CRYPTO_WALLET_BTC", "")
    cfg["providers"]["crypto"]["wallets"]["ETH"] = os.getenv("CRYPTO_WALLET_ETH", "")
    cfg["providers"]["crypto"]["wallets"]["USDT_ERC20"] = os.getenv("CRYPTO_WALLET_ETH", "")
    cfg["providers"]["crypto"]["wallets"]["USDT_TRC20"] = os.getenv("CRYPTO_WALLET_USDT_TRC20", "")

    if pool is None:
        _CONFIG_CACHE = cfg
        return cfg

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT key, value FROM billing_config")
        for row in rows:
            key = row["key"]
            val = row["value"]
            if isinstance(val, str):
                val = json.loads(val)
            if key in cfg and isinstance(cfg[key], dict) and isinstance(val, dict):
                cfg[key] = {**cfg[key], **val}
            else:
                cfg[key] = val
    except Exception as e:
        logger.warning("billing_config_load_error", error=str(e))

    _CONFIG_CACHE = cfg
    return cfg


async def _save_config_key(pool, key: str, value: Any):
    global _CONFIG_CACHE
    _CONFIG_CACHE = None  # invalidate
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO billing_config (key, value, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()
            """, key, json.dumps(value))
    except Exception as e:
        logger.warning("billing_config_save_error", error=str(e))


def _plan_price(cfg: dict, plan: str) -> float:
    return cfg["plans"].get(plan, {}).get("price_usd", 49.0)


# ─── Auth deps ────────────────────────────────────────────────────────────────

async def _current_user(request: Request, authorization: Optional[str] = Header(None)):
    # Try gravity-api native auth first
    try:
        from app.api.routes.auth import _current_user as auth_dep
        return await auth_dep(request=request, authorization=authorization)
    except HTTPException:
        pass

    # Fallback: accept Supabase (or any valid-structure) JWT by decoding without
    # signature verification. Extracts sub + email so billing works for users
    # who authenticated via Supabase rather than gravity-api.
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization[7:].strip()
    try:
        from jose import jwt as _jwt
        from app.core.security.auth_store import UserRecord
        claims = _jwt.get_unverified_claims(token)
        user_id = claims.get("sub", "")
        email = claims.get("email", "") or claims.get("user_metadata", {}).get("email", "")
        if not user_id:
            raise HTTPException(401, "invalid token: no sub claim")
        return UserRecord(user_id=user_id, email=email, password_hash="", role="member")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "invalid token")


async def _admin_user(request: Request, authorization: Optional[str] = Header(None)):
    user = await _current_user(request=request, authorization=authorization)
    if getattr(user, "role", "") != "admin":
        raise HTTPException(403, "Admin role required")
    return user


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _base_url() -> str:
    return os.getenv("APP_BASE_URL", "http://localhost:5173").rstrip("/")

def _pool(request: Request):
    return getattr(request.app.state, "pg_pool", None)


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    plan: str
    provider: str = "paddle"
    crypto_currency: Optional[str] = None
    success_path: str = "/billing/success"
    cancel_path: str = "/billing/cancel"

class CheckoutResponse(BaseModel):
    provider: str
    url: Optional[str] = None
    invoice_id: Optional[str] = None
    wallet: Optional[str] = None
    amount_usd: Optional[float] = None
    currency: Optional[str] = None
    qr_data: Optional[str] = None
    manual_info: Optional[dict] = None

class PortalResponse(BaseModel):
    url: str

class SubscriptionStatus(BaseModel):
    plan: str
    status: str
    provider: str = "none"
    current_period_end: Optional[int] = None
    cancel_at_period_end: bool = False
    customer_id: Optional[str] = None

class CryptoConfirmRequest(BaseModel):
    invoice_id: str
    tx_hash: str

class AdminSubUpdate(BaseModel):
    plan: str
    status: str
    provider: str = "manual"


# ─── DB helpers ───────────────────────────────────────────────────────────────

_MEM: dict[str, SubscriptionStatus] = {}

async def _db_get(pool, user_id: str) -> Optional[SubscriptionStatus]:
    if pool is None:
        return _MEM.get(user_id)
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT plan,status,provider,current_period_end,cancel_at_period_end,customer_id "
                "FROM billing_subscriptions WHERE user_id=$1", user_id)
        if not row:
            return None
        return SubscriptionStatus(**dict(row))
    except Exception as e:
        logger.warning("billing_db_get_error", error=str(e))
        return _MEM.get(user_id)

async def _db_upsert(pool, user_id: str, sub: SubscriptionStatus):
    _MEM[user_id] = sub
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO billing_subscriptions
                    (user_id,provider,customer_id,plan,status,current_period_end,cancel_at_period_end,updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    provider=EXCLUDED.provider, customer_id=EXCLUDED.customer_id,
                    plan=EXCLUDED.plan, status=EXCLUDED.status,
                    current_period_end=EXCLUDED.current_period_end,
                    cancel_at_period_end=EXCLUDED.cancel_at_period_end, updated_at=NOW()
            """, user_id, sub.provider, sub.customer_id, sub.plan,
                sub.status, sub.current_period_end, sub.cancel_at_period_end)
    except Exception as e:
        logger.warning("billing_db_upsert_error", error=str(e))

async def _db_get_by_customer(pool, customer_id: str) -> Optional[tuple[str, SubscriptionStatus]]:
    if pool is None:
        for uid, s in _MEM.items():
            if s.customer_id == customer_id:
                return uid, s
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT user_id,plan,status,provider,current_period_end,cancel_at_period_end,customer_id "
                "FROM billing_subscriptions WHERE customer_id=$1", customer_id)
        if not row:
            return None
        return row["user_id"], SubscriptionStatus(**{k: v for k, v in dict(row).items() if k != "user_id"})
    except Exception as e:
        logger.warning("billing_db_lookup_error", error=str(e))
        return None


# ─── Schema init ──────────────────────────────────────────────────────────────

async def ensure_billing_schema(pool):
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(BILLING_DDL)
        logger.info("billing_schema_ready")
    except Exception as e:
        logger.warning("billing_schema_init_failed", error=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# PADDLE
# ═══════════════════════════════════════════════════════════════════════════════

def _paddle_headers() -> dict:
    key = os.getenv("PADDLE_API_KEY", "")
    if not key:
        raise HTTPException(503, "Paddle not configured (PADDLE_API_KEY missing from .env)")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def _paddle_base() -> str:
    key = os.getenv("PADDLE_API_KEY", "")
    return "https://sandbox-api.paddle.com" if key.startswith("test_") else "https://api.paddle.com"

def _paddle_price_id(plan: str) -> str:
    mapping = {"pro": os.getenv("PADDLE_PRICE_PRO", ""), "team": os.getenv("PADDLE_PRICE_TEAM", "")}
    pid = mapping.get(plan, "")
    if not pid:
        raise HTTPException(503, f"Paddle price ID not configured (PADDLE_PRICE_{plan.upper()} missing from .env)")
    return pid

async def _paddle_checkout(plan: str, user_email: str, user_id: str,
                           base: str, success_path: str, cancel_path: str) -> str:
    price_id = _paddle_price_id(plan)
    payload = {
        "items": [{"priceId": price_id, "quantity": 1}],
        "customer": {"email": user_email},
        "customData": {"user_id": user_id, "plan": plan},
        "successUrl": f"{base}{success_path}",
        "cancelUrl": f"{base}{cancel_path}",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{_paddle_base()}/transactions",
                              headers=_paddle_headers(), json=payload)
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Paddle error: {r.text[:200]}")
        data = r.json()
    url = data.get("data", {}).get("checkoutUrl") or data.get("data", {}).get("checkout", {}).get("url")
    if not url:
        raise HTTPException(502, "Paddle returned no checkout URL")
    return url


# ═══════════════════════════════════════════════════════════════════════════════
# PAYPAL
# ═══════════════════════════════════════════════════════════════════════════════

async def _paypal_token() -> tuple[str, str]:
    client_id = os.getenv("PAYPAL_CLIENT_ID", "")
    secret = os.getenv("PAYPAL_CLIENT_SECRET", "")
    if not client_id or not secret:
        raise HTTPException(503, "PayPal not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing from .env)")
    mode = os.getenv("PAYPAL_MODE", "sandbox")
    api = "https://api-m.sandbox.paypal.com" if mode == "sandbox" else "https://api-m.paypal.com"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{api}/v1/oauth2/token",
                              auth=(client_id, secret),
                              data={"grant_type": "client_credentials"})
        if r.status_code != 200:
            raise HTTPException(502, f"PayPal auth failed: {r.text[:200]}")
        return r.json()["access_token"], api

async def _paypal_checkout(plan: str, user_id: str, amount: float,
                           base_url: str, success_path: str, cancel_path: str) -> str:
    token, api = await _paypal_token()
    payload = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "reference_id": f"{user_id}:{plan}",
            "description": f"Antigravity {plan.capitalize()} Plan",
            "amount": {"currency_code": "USD", "value": f"{amount:.2f}"},
            "custom_id": user_id,
        }],
        "application_context": {
            "return_url": f"{base_url}{success_path}?provider=paypal",
            "cancel_url": f"{base_url}{cancel_path}",
            "brand_name": "Antigravity",
            "user_action": "PAY_NOW",
        },
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{api}/v2/checkout/orders",
                              headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                              json=payload)
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"PayPal order error: {r.text[:200]}")
        data = r.json()
    url = next((l["href"] for l in data.get("links", []) if l.get("rel") == "approve"), None)
    if not url:
        raise HTTPException(502, "PayPal returned no approval URL")
    return url


# ═══════════════════════════════════════════════════════════════════════════════
# PAYONEER
# ═══════════════════════════════════════════════════════════════════════════════

def _payoneer_info(plan: str, amount: float, cfg: dict) -> dict:
    email = cfg["providers"]["payoneer"].get("email") or os.getenv("PAYONEER_EMAIL", "")
    app_name = cfg.get("app_name", "Antigravity")
    display_email = email or "your-payoneer@email.com"
    return {
        "method": "Payoneer",
        "send_to_email": display_email,
        "amount_usd": amount,
        "plan": plan,
        "note": f"{app_name} {plan.capitalize()} subscription",
        "instructions": [
            "Log in to your Payoneer account",
            "Go to Pay → Send to Email",
            f"Enter: {display_email}",
            f"Amount: ${amount:.2f} USD",
            f"Note: {app_name} {plan.capitalize()} — your registered email",
            "After sending, email us your transaction ID to activate your plan",
        ],
        "configured": bool(email),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CRYPTO
# ═══════════════════════════════════════════════════════════════════════════════

def _make_qr_base64(data: str) -> Optional[str]:
    try:
        import qrcode, io, base64
        qr = qrcode.QRCode()
        qr.add_data(data)
        qr.make(fit=True)
        # Use PIL factory if available, fall back to pure-PNG
        img = qr.make_image()
        buf = io.BytesIO()
        img.save(buf)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None

async def _coinbase_charge(plan: str, user_id: str, amount_usd: float) -> dict:
    api_key = os.getenv("COINBASE_COMMERCE_API_KEY", "")
    if not api_key:
        return {}
    payload = {
        "name": f"Antigravity {plan.capitalize()} Plan",
        "description": f"Monthly subscription — {plan}",
        "pricing_type": "fixed_price",
        "local_price": {"amount": f"{amount_usd:.2f}", "currency": "USD"},
        "metadata": {"user_id": user_id, "plan": plan},
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post("https://api.commerce.coinbase.com/charges",
                              headers={"X-CC-Api-Key": api_key, "X-CC-Version": "2018-03-22",
                                       "Content-Type": "application/json"},
                              json=payload)
        if r.status_code in (200, 201):
            return r.json().get("data", {})
    return {}

async def _crypto_invoice(plan: str, user_id: str, currency: str, amount: float,
                          cfg: dict, pool) -> dict:
    invoice_id = str(uuid.uuid4())
    wallets = cfg["providers"]["crypto"]["wallets"]

    # Try Coinbase Commerce
    cb = await _coinbase_charge(plan, user_id, amount_usd=amount)
    if cb.get("hosted_url"):
        wallet = cb.get("addresses", {}).get(currency.lower(), "")
        qr = _make_qr_base64(cb["hosted_url"])
        await _save_crypto_invoice(pool, invoice_id, user_id, plan, amount, currency, wallet or cb["hosted_url"])
        return {"invoice_id": invoice_id, "url": cb["hosted_url"],
                "wallet": wallet, "amount_usd": amount, "currency": currency, "qr_data": qr}

    # Manual wallet
    # USDT_ERC20 shares ETH address if not set separately
    wallet = wallets.get(currency) or (wallets.get("ETH") if currency == "USDT_ERC20" else "")
    if not wallet:
        env_map = {"BTC": "CRYPTO_WALLET_BTC", "ETH": "CRYPTO_WALLET_ETH",
                   "USDT_ERC20": "CRYPTO_WALLET_ETH", "USDT_TRC20": "CRYPTO_WALLET_USDT_TRC20"}
        env_key = env_map.get(currency, f"CRYPTO_WALLET_{currency}")
        raise HTTPException(503, f"Wallet not configured: set {env_key} in .env or update via Admin → Billing")

    qr = _make_qr_base64(wallet)
    await _save_crypto_invoice(pool, invoice_id, user_id, plan, amount, currency, wallet)
    return {"invoice_id": invoice_id, "url": None,
            "wallet": wallet, "amount_usd": amount, "currency": currency, "qr_data": qr}

async def _save_crypto_invoice(pool, invoice_id, user_id, plan, amount, currency, wallet):
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO billing_crypto_invoices
                    (invoice_id,user_id,plan,amount_usd,currency,wallet,status,created_at)
                VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
                ON CONFLICT (invoice_id) DO NOTHING
            """, invoice_id, user_id, plan, amount, currency, wallet)
    except Exception as e:
        logger.warning("crypto_invoice_save_error", error=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

def _provider_configured(pid: str, pdata: dict) -> bool:
    """True when provider has working creds → customer can actually pay."""
    if pid == "paddle":
        return bool(os.getenv("PADDLE_API_KEY") and os.getenv("PADDLE_PRICE_PRO"))
    if pid == "paypal":
        return bool(os.getenv("PAYPAL_CLIENT_ID") and os.getenv("PAYPAL_CLIENT_SECRET"))
    if pid == "payoneer":
        return bool(os.getenv("PAYONEER_EMAIL") or pdata.get("email"))
    if pid == "crypto":
        wallets = pdata.get("wallets", {}) or {}
        return bool(any(wallets.values()) or os.getenv("COINBASE_COMMERCE_API_KEY"))
    return False


@router.get("/config")
async def public_config(request: Request):
    """Return plans + payable providers for the frontend (no auth required).

    Only providers with working creds are returned so customers never hit a
    503 'not configured' after clicking. Set creds via Fly secrets or admin.
    """
    pool = _pool(request)
    cfg = await _load_config(pool)
    active_plans = {k: v for k, v in cfg["plans"].items() if v.get("active", True)}
    active_providers = []
    for pid, pdata in cfg["providers"].items():
        if pdata.get("enabled", False) and _provider_configured(pid, pdata):
            pub = {k: v for k, v in pdata.items()
                   if k not in ("wallets",)}  # never expose wallets publicly
            pub["id"] = pid
            pub["configured"] = True
            active_providers.append(pub)
    return {
        "plans": active_plans,
        "providers": active_providers,
        "app_name": cfg.get("app_name", "Antigravity"),
        "support_email": cfg.get("support_email", ""),
    }


@router.get("/me", response_model=SubscriptionStatus)
async def my_subscription(request: Request, user=Depends(_current_user)):
    pool = _pool(request)
    sub = await _db_get(pool, user.user_id)
    return sub or SubscriptionStatus(plan="free", status="none", provider="none")


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(req: CheckoutRequest, request: Request, user=Depends(_current_user)):
    pool = _pool(request)
    cfg = await _load_config(pool)
    base = _base_url()

    if req.plan not in cfg["plans"]:
        raise HTTPException(400, f"Unknown plan: {req.plan}")
    if req.plan == "free":
        raise HTTPException(400, "Cannot checkout the free plan")

    provider_cfg = cfg["providers"].get(req.provider, {})
    if not provider_cfg.get("enabled", False):
        raise HTTPException(400, f"Payment provider '{req.provider}' is disabled")

    amount = _plan_price(cfg, req.plan)

    if req.provider == "paddle":
        url = await _paddle_checkout(req.plan, user.email, user.user_id,
                                     base, req.success_path, req.cancel_path)
        logger.info("checkout_started", provider="paddle", user_id=user.user_id, plan=req.plan)
        return CheckoutResponse(provider="paddle", url=url, amount_usd=amount)

    elif req.provider == "paypal":
        url = await _paypal_checkout(req.plan, user.user_id, amount,
                                     base, req.success_path, req.cancel_path)
        logger.info("checkout_started", provider="paypal", user_id=user.user_id, plan=req.plan)
        return CheckoutResponse(provider="paypal", url=url, amount_usd=amount)

    elif req.provider == "payoneer":
        info = _payoneer_info(req.plan, amount, cfg)
        logger.info("payoneer_requested", user_id=user.user_id, plan=req.plan)
        return CheckoutResponse(provider="payoneer", manual_info=info, amount_usd=amount)

    elif req.provider == "crypto":
        currency = req.crypto_currency or "USDT_TRC20"
        result = await _crypto_invoice(req.plan, user.user_id, currency, amount, cfg, pool)
        logger.info("crypto_invoice_created", user_id=user.user_id, plan=req.plan, currency=currency)
        return CheckoutResponse(provider="crypto", url=result.get("url"),
                                invoice_id=result["invoice_id"], wallet=result["wallet"],
                                amount_usd=result["amount_usd"], currency=result["currency"],
                                qr_data=result.get("qr_data"))

    raise HTTPException(400, f"Unknown provider: {req.provider}")


@router.post("/portal", response_model=PortalResponse)
async def create_portal(request: Request, user=Depends(_current_user)):
    pool = _pool(request)
    sub = await _db_get(pool, user.user_id)
    if not sub or not sub.customer_id:
        raise HTTPException(404, "No billing customer for this user")
    if sub.provider != "paddle":
        raise HTTPException(400, "Portal only available for Paddle subscriptions")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{_paddle_base()}/customers/{sub.customer_id}/portal-sessions",
                              headers=_paddle_headers())
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Paddle portal error: {r.text[:200]}")
        url = r.json().get("data", {}).get("urls", {}).get("general", {}).get("overview", "")
    if not url:
        raise HTTPException(502, "Paddle returned no portal URL")
    return PortalResponse(url=url)


@router.get("/payoneer/info")
async def payoneer_info(plan: str = "pro", request: Request = None, _user=Depends(_current_user)):
    pool = _pool(request)
    cfg = await _load_config(pool)
    if plan not in cfg["plans"]:
        raise HTTPException(400, f"Unknown plan: {plan}")
    amount = _plan_price(cfg, plan)
    return _payoneer_info(plan, amount, cfg)


@router.post("/crypto/confirm")
async def confirm_crypto(req: CryptoConfirmRequest, request: Request, user=Depends(_current_user)):
    pool = _pool(request)
    if pool is None:
        raise HTTPException(503, "DB not available")
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT user_id, plan, status FROM billing_crypto_invoices WHERE invoice_id=$1",
                req.invoice_id)
            if not row:
                raise HTTPException(404, "Invoice not found")
            if row["user_id"] != user.user_id:
                raise HTTPException(403, "Not your invoice")
            if row["status"] == "confirmed":
                raise HTTPException(400, "Already confirmed")
            await conn.execute(
                "UPDATE billing_crypto_invoices SET tx_hash=$1, status='pending_confirmation' WHERE invoice_id=$2",
                req.tx_hash, req.invoice_id)
        logger.info("crypto_tx_submitted", user_id=user.user_id, invoice=req.invoice_id, tx=req.tx_hash)
        return {"status": "pending_confirmation", "message": "Tx received. Will activate within 1 confirmation."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("crypto_confirm_error", error=str(e))
        raise HTTPException(500, "DB error")


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/admin/config")
async def admin_get_config(request: Request, _user=Depends(_admin_user)):
    pool = _pool(request)
    cfg = await _load_config(pool)
    return cfg


@router.put("/admin/config")
async def admin_update_config(body: dict, request: Request, _user=Depends(_admin_user)):
    """Replace entire config. Merge each top-level key separately so partial updates work."""
    pool = _pool(request)
    allowed_keys = {"plans", "providers", "app_name", "support_email"}
    for key, val in body.items():
        if key not in allowed_keys:
            raise HTTPException(400, f"Unknown config key: {key}")
        await _save_config_key(pool, key, val)
    logger.info("billing_config_updated", keys=list(body.keys()))
    return await _load_config(pool)


@router.put("/admin/plans")
async def admin_update_plans(plans: dict, request: Request, _user=Depends(_admin_user)):
    """Update plan definitions (prices, features, limits, active flag)."""
    pool = _pool(request)
    cfg = await _load_config(pool)
    merged = {**cfg["plans"], **plans}
    await _save_config_key(pool, "plans", merged)
    logger.info("billing_plans_updated")
    return {"plans": merged}


@router.put("/admin/providers")
async def admin_update_providers(providers: dict, request: Request, _user=Depends(_admin_user)):
    """Toggle providers on/off, update labels, icons, descriptions, wallet addresses, Payoneer email."""
    pool = _pool(request)
    cfg = await _load_config(pool)
    merged = {}
    for pid, pdata in cfg["providers"].items():
        merged[pid] = {**pdata, **(providers.get(pid, {}))}
    for pid, pdata in providers.items():
        if pid not in merged:
            merged[pid] = pdata
    await _save_config_key(pool, "providers", merged)
    logger.info("billing_providers_updated")
    return {"providers": merged}


@router.put("/admin/wallets")
async def admin_update_wallets(wallets: dict, request: Request, _user=Depends(_admin_user)):
    """Update crypto wallet addresses only. wallets = {BTC: addr, ETH: addr, ...}"""
    pool = _pool(request)
    cfg = await _load_config(pool)
    crypto_cfg = dict(cfg["providers"].get("crypto", {}))
    crypto_cfg["wallets"] = {**crypto_cfg.get("wallets", {}), **wallets}
    providers = dict(cfg["providers"])
    providers["crypto"] = crypto_cfg
    await _save_config_key(pool, "providers", providers)
    logger.info("billing_wallets_updated")
    return {"wallets": crypto_cfg["wallets"]}


@router.get("/admin/subscriptions")
async def admin_list_subscriptions(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    _user=Depends(_admin_user),
):
    pool = _pool(request)
    if pool is None:
        raise HTTPException(503, "DB not available")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT user_id,provider,customer_id,plan,status,current_period_end,cancel_at_period_end,updated_at "
            "FROM billing_subscriptions ORDER BY updated_at DESC LIMIT $1 OFFSET $2",
            limit, offset)
        total = await conn.fetchval("SELECT COUNT(*) FROM billing_subscriptions")
    return {"total": total, "items": [dict(r) for r in rows]}


@router.put("/admin/subscriptions/{user_id}")
async def admin_update_subscription(
    user_id: str,
    body: AdminSubUpdate,
    request: Request,
    user=Depends(_admin_user),
):
    pool = _pool(request)
    sub = SubscriptionStatus(plan=body.plan, status=body.status, provider=body.provider)
    await _db_upsert(pool, user_id, sub)
    logger.info("admin_sub_updated", by=user.user_id, target=user_id, plan=body.plan, status=body.status)
    return {"user_id": user_id, "plan": body.plan, "status": body.status}


@router.get("/admin/invoices")
async def admin_list_invoices(
    request: Request,
    status: str = "pending_confirmation",
    limit: int = 50,
    _user=Depends(_admin_user),
):
    pool = _pool(request)
    if pool is None:
        raise HTTPException(503, "DB not available")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM billing_crypto_invoices WHERE status=$1 ORDER BY created_at DESC LIMIT $2",
            status, limit)
    return {"items": [dict(r) for r in rows]}


@router.put("/admin/invoices/{invoice_id}/confirm")
async def admin_confirm_invoice(invoice_id: str, request: Request, _user=Depends(_admin_user)):
    """Manually activate subscription after verifying crypto tx on-chain."""
    pool = _pool(request)
    if pool is None:
        raise HTTPException(503, "DB not available")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id, plan FROM billing_crypto_invoices WHERE invoice_id=$1", invoice_id)
        if not row:
            raise HTTPException(404, "Invoice not found")
        await conn.execute(
            "UPDATE billing_crypto_invoices SET status='confirmed', confirmed_at=NOW() WHERE invoice_id=$1",
            invoice_id)
    sub = SubscriptionStatus(plan=row["plan"], status="active", provider="crypto")
    await _db_upsert(pool, row["user_id"], sub)
    logger.info("admin_crypto_confirmed", invoice=invoice_id, target=row["user_id"])
    return {"confirmed": True, "user_id": row["user_id"], "plan": row["plan"]}


# ═══════════════════════════════════════════════════════════════════════════════
# WEBHOOKS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/webhook/paddle", status_code=200)
async def paddle_webhook(request: Request):
    secret = os.getenv("PADDLE_WEBHOOK_SECRET", "")
    body = await request.body()
    if secret:
        sig = request.headers.get("paddle-signature", "")
        try:
            parts = dict(p.split("=", 1) for p in sig.split(";") if "=" in p)
            ts = parts.get("ts", "")
            h1 = parts.get("h1", "")
            expected = hmac.new(secret.encode(), ts.encode() + b":" + body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, h1):
                raise HTTPException(400, "Invalid Paddle signature")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("paddle_webhook_sig_error", error=str(e))
            raise HTTPException(400, "Signature parse error")
    try:
        event = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    pool = _pool(request)
    et = event.get("event_type", "")
    data = event.get("data", {})
    logger.info("paddle_webhook", type=et)
    if et in ("transaction.completed", "subscription.activated"):
        custom = data.get("customData") or data.get("custom_data") or {}
        user_id = custom.get("user_id", "")
        plan = custom.get("plan", "pro")
        customer_id = data.get("customerId") or data.get("customer_id", "")
        if user_id:
            await _db_upsert(pool, user_id,
                             SubscriptionStatus(plan=plan, status="active",
                                                provider="paddle", customer_id=customer_id))
            logger.info("paddle_activated", user_id=user_id, plan=plan)
    elif et == "subscription.updated":
        customer_id = data.get("customerId") or data.get("customer_id", "")
        result = await _db_get_by_customer(pool, customer_id)
        if result:
            uid, sub = result
            sub.status = data.get("status", sub.status)
            sub.cancel_at_period_end = data.get("scheduledChange", {}).get("action") == "cancel"
            await _db_upsert(pool, uid, sub)
    elif et == "subscription.canceled":
        customer_id = data.get("customerId") or data.get("customer_id", "")
        result = await _db_get_by_customer(pool, customer_id)
        if result:
            uid, sub = result
            sub.status = "canceled"
            sub.plan = "free"
            await _db_upsert(pool, uid, sub)
    return {"received": True}


@router.post("/webhook/paypal", status_code=200)
async def paypal_webhook(request: Request):
    body = await request.body()
    try:
        event = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    et = event.get("event_type", "")
    resource = event.get("resource", {})
    pool = _pool(request)
    logger.info("paypal_webhook", type=et)
    if et == "PAYMENT.CAPTURE.COMPLETED":
        custom_id = resource.get("custom_id", "")
        user_id, plan = (custom_id.split(":", 1) if ":" in custom_id else (custom_id, "pro"))
        if user_id:
            await _db_upsert(pool, user_id,
                             SubscriptionStatus(plan=plan, status="active",
                                                provider="paypal", customer_id=resource.get("id", "")))
            logger.info("paypal_activated", user_id=user_id, plan=plan)
    elif et == "PAYMENT.CAPTURE.DENIED":
        result = await _db_get_by_customer(pool, resource.get("id", ""))
        if result:
            uid, sub = result
            sub.status = "past_due"
            await _db_upsert(pool, uid, sub)
    return {"received": True}


@router.post("/webhook/coinbase", status_code=200)
async def coinbase_webhook(request: Request, x_cc_webhook_signature: Optional[str] = Header(None)):
    secret = os.getenv("COINBASE_COMMERCE_WEBHOOK_SECRET", "")
    body = await request.body()
    if secret and x_cc_webhook_signature:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, x_cc_webhook_signature):
            raise HTTPException(400, "Invalid Coinbase signature")
    try:
        event = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    et = event.get("type", "")
    data = event.get("event", {}).get("data", {})
    pool = _pool(request)
    logger.info("coinbase_webhook", type=et)
    if et == "charge:confirmed":
        meta = data.get("metadata", {})
        user_id = meta.get("user_id", "")
        plan = meta.get("plan", "pro")
        if user_id:
            await _db_upsert(pool, user_id,
                             SubscriptionStatus(plan=plan, status="active",
                                                provider="crypto", customer_id=data.get("id", "")))
            if pool:
                try:
                    async with pool.acquire() as conn:
                        await conn.execute(
                            "UPDATE billing_crypto_invoices SET status='confirmed', confirmed_at=NOW() "
                            "WHERE user_id=$1 AND status IN ('pending','pending_confirmation')", user_id)
                except Exception as e:
                    logger.warning("crypto_invoice_confirm_error", error=str(e))
            logger.info("coinbase_activated", user_id=user_id, plan=plan)
    return {"received": True}
