"""
Transactional email sender.

Order of preference:
  1. Resend HTTP API   (RESEND_API_KEY set)
  2. SMTP relay        (SMTP_HOST set)
  3. Console fallback  (logs the email body; dev only)

Templates are simple .format()-style strings — keep small to avoid a Jinja dep.

Usage:
    await send_email(
        to="user@example.com",
        subject="Verify your email",
        html=render("verify", link="https://..."),
    )
"""

from __future__ import annotations

import os
import ssl
import smtplib
from email.message import EmailMessage
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()


def _from_addr() -> str:
    return os.getenv("EMAIL_FROM", "no-reply@antigravity.ai")


def _app_url() -> str:
    return os.getenv("APP_URL", "https://market-ui-self.vercel.app").rstrip("/")


# ── Templates ────────────────────────────────────────────────────────────────

VERIFY_HTML = """\
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#070A12;color:#F4F6FF;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#0D1225;border:1px solid rgba(0,240,255,0.1);border-radius:16px;padding:32px">
<h2 style="margin:0 0 16px">Verify your email</h2>
<p style="color:#A7B0C8;line-height:1.6">Click the button below to confirm your email and finish setting up your AlphaSense AI account. Link expires in 24 hours.</p>
<p style="margin:24px 0"><a href="{link}" style="display:inline-block;padding:12px 24px;background:linear-gradient(90deg,#4285F4,#9B72CB,#D96570);color:#fff;text-decoration:none;border-radius:8px;font-weight:500">Verify email</a></p>
<p style="color:#A7B0C8;font-size:12px">Or paste this link: {link}</p>
<p style="color:#A7B0C8;font-size:12px;margin-top:24px">If you didn't create an account, you can ignore this email.</p>
</div></body></html>"""

RESET_HTML = """\
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#070A12;color:#F4F6FF;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#0D1225;border:1px solid rgba(0,240,255,0.1);border-radius:16px;padding:32px">
<h2 style="margin:0 0 16px">Reset your password</h2>
<p style="color:#A7B0C8;line-height:1.6">Someone requested a password reset for this account. The link expires in 15 minutes and can only be used once.</p>
<p style="margin:24px 0"><a href="{link}" style="display:inline-block;padding:12px 24px;background:linear-gradient(90deg,#4285F4,#9B72CB,#D96570);color:#fff;text-decoration:none;border-radius:8px;font-weight:500">Reset password</a></p>
<p style="color:#A7B0C8;font-size:12px">Or paste this link: {link}</p>
<p style="color:#A7B0C8;font-size:12px;margin-top:24px">If you didn't request this, ignore this email and your password stays the same. Consider enabling 2FA for extra protection.</p>
</div></body></html>"""

LOGIN_ALERT_HTML = """\
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#070A12;color:#F4F6FF;padding:32px">
<div style="max-width:480px;margin:0 auto;background:#0D1225;border:1px solid rgba(0,240,255,0.1);border-radius:16px;padding:32px">
<h2 style="margin:0 0 16px">New sign-in to your account</h2>
<p style="color:#A7B0C8;line-height:1.6">A new sign-in was detected:</p>
<ul style="color:#A7B0C8;line-height:1.6"><li>IP: {ip}</li><li>Time: {when}</li><li>User agent: {ua}</li></ul>
<p style="color:#A7B0C8;font-size:12px;margin-top:24px">If this wasn't you, <a href="{reset_link}" style="color:#00F0FF">reset your password</a> immediately.</p>
</div></body></html>"""

TEMPLATES = {
    "verify": VERIFY_HTML,
    "reset": RESET_HTML,
    "login_alert": LOGIN_ALERT_HTML,
}


def render(name: str, **kw: str) -> str:
    tmpl = TEMPLATES.get(name)
    if tmpl is None:
        raise KeyError(f"unknown email template: {name}")
    return tmpl.format(**kw)


def verify_link(token: str) -> str:
    return f"{_app_url()}/verify-email?token={token}"


def reset_link(token: str) -> str:
    return f"{_app_url()}/reset-password?token={token}"


# ── Backends ─────────────────────────────────────────────────────────────────

async def _send_via_resend(to: str, subject: str, html: str) -> bool:
    key = os.getenv("RESEND_API_KEY", "")
    if not key:
        return False
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"from": _from_addr(), "to": [to], "subject": subject, "html": html},
            )
            if r.status_code >= 400:
                logger.warning("resend_send_failed", status=r.status_code, body=r.text[:300])
                return False
        return True
    except Exception as e:
        logger.warning("resend_exception", error=str(e))
        return False


def _send_via_smtp(to: str, subject: str, html: str) -> bool:
    host = os.getenv("SMTP_HOST", "")
    if not host:
        return False
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "")
    pw = os.getenv("SMTP_PASSWORD", "")
    use_tls = os.getenv("SMTP_TLS", "true").lower() != "false"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _from_addr()
    msg["To"] = to
    msg.set_content("Your email client does not support HTML. View this message online.")
    msg.add_alternative(html, subtype="html")

    try:
        if use_tls:
            ctx = ssl.create_default_context()
            with smtplib.SMTP(host, port, timeout=10) as s:
                s.starttls(context=ctx)
                if user:
                    s.login(user, pw)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=10) as s:
                if user:
                    s.login(user, pw)
                s.send_message(msg)
        return True
    except Exception as e:
        logger.warning("smtp_send_failed", error=str(e))
        return False


async def send_email(to: str, subject: str, html: str) -> bool:
    """
    Send transactional email. Returns True on success.

    Tries Resend → SMTP → console (dev fallback). Never raises.
    """
    if await _send_via_resend(to, subject, html):
        logger.info("email_sent", backend="resend", to=to, subject=subject)
        return True
    if _send_via_smtp(to, subject, html):
        logger.info("email_sent", backend="smtp", to=to, subject=subject)
        return True
    # Dev fallback: print to logs so flow can be tested offline.
    logger.warning("email_console_fallback", to=to, subject=subject, html_preview=html[:500])
    return False
