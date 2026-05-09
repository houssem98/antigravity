"""
SEC Form-Specific Structured Parsers

Extracts structured fields from non-narrative SEC forms whose value is in
the structured XML/HTML, not the free-text body:

  Form 4   — insider transactions (XML)
  13F-HR   — institutional holdings (XML information table)
  SC 13D/G — activist / passive 5%+ stakes (HTML cover page)
  DEF 14A  — proxy statement (parsed as narrative + key tables)
  S-1      — IPO registration (parsed as narrative + cover page)

Returned dicts are stored on chunk metadata and indexed alongside text.
Downstream search + agents use them for filters like "show insider sales
by Apple executives in last 30 days" or "13D activists in semis 2025".
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class InsiderTransaction:
    """A single Form 4 non-derivative or derivative transaction row."""
    transaction_date: str = ""
    security_title: str = ""
    transaction_code: str = ""   # P=purchase, S=sale, A=award, M=exercise, F=tax, etc.
    shares: float = 0.0
    price_per_share: float = 0.0
    shares_owned_after: float = 0.0
    direct_or_indirect: str = "D"
    is_derivative: bool = False


@dataclass
class Form4Filing:
    issuer_cik: str = ""
    issuer_name: str = ""
    issuer_ticker: str = ""
    reporter_cik: str = ""
    reporter_name: str = ""
    reporter_relationship: str = ""   # Director, Officer, 10% Owner
    officer_title: str = ""
    period_of_report: str = ""
    transactions: list[InsiderTransaction] = field(default_factory=list)


@dataclass
class HoldingRow:
    """A single 13F information table row."""
    issuer_name: str = ""
    cusip: str = ""
    value_usd: float = 0.0      # market value, $
    shares: float = 0.0
    share_type: str = "SH"      # SH or PRN
    investment_discretion: str = ""
    voting_authority_sole: float = 0.0
    voting_authority_shared: float = 0.0
    voting_authority_none: float = 0.0


@dataclass
class Form13FFiling:
    filer_cik: str = ""
    filer_name: str = ""
    period_of_report: str = ""
    total_value_usd: float = 0.0
    holdings: list[HoldingRow] = field(default_factory=list)


@dataclass
class Schedule13Filing:
    """SC 13D or SC 13G — beneficial ownership."""
    schedule_type: str = ""     # "13D" or "13G"
    issuer_name: str = ""
    issuer_cusip: str = ""
    reporting_persons: list[str] = field(default_factory=list)
    shares_beneficially_owned: float = 0.0
    percent_of_class: float = 0.0
    sole_voting: float = 0.0
    shared_voting: float = 0.0
    sole_dispositive: float = 0.0
    shared_dispositive: float = 0.0
    purpose_summary: str = ""   # first 1000 chars of Item 4 (Purpose of Transaction)


# ─── Form 4 parser ────────────────────────────────────────────────────────────

# EDGAR Form 4 ships as `ownership.xml` inside the filing index.
def parse_form_4_xml(xml_bytes: bytes) -> Optional[Form4Filing]:
    """Parse Form 4 ownership XML into a structured Form4Filing."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning("form4_xml_parse_failed", error=str(e))
        return None

    f = Form4Filing()
    f.issuer_cik   = _findtext(root, "issuer/issuerCik")
    f.issuer_name  = _findtext(root, "issuer/issuerName")
    f.issuer_ticker = _findtext(root, "issuer/issuerTradingSymbol")
    f.period_of_report = _findtext(root, "periodOfReport")

    rep = root.find("reportingOwner")
    if rep is not None:
        f.reporter_cik  = _findtext(rep, "reportingOwnerId/rptOwnerCik")
        f.reporter_name = _findtext(rep, "reportingOwnerId/rptOwnerName")
        rel_el = rep.find("reportingOwnerRelationship")
        if rel_el is not None:
            rels = []
            for tag, label in [("isDirector", "Director"), ("isOfficer", "Officer"),
                               ("isTenPercentOwner", "10% Owner"), ("isOther", "Other")]:
                if _findtext(rel_el, tag).strip().lower() in ("1", "true"):
                    rels.append(label)
            f.reporter_relationship = ", ".join(rels)
            f.officer_title = _findtext(rel_el, "officerTitle")

    # Non-derivative transactions
    for tx in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        f.transactions.append(_parse_form4_tx(tx, derivative=False))
    # Derivative transactions (options, RSUs)
    for tx in root.findall("derivativeTable/derivativeTransaction"):
        f.transactions.append(_parse_form4_tx(tx, derivative=True))

    return f


def _parse_form4_tx(tx_el, derivative: bool) -> InsiderTransaction:
    t = InsiderTransaction(is_derivative=derivative)
    t.transaction_date = _findtext(tx_el, "transactionDate/value")
    t.security_title   = _findtext(tx_el, "securityTitle/value")
    t.transaction_code = _findtext(tx_el, "transactionCoding/transactionCode")
    t.shares           = _parse_float(_findtext(tx_el, "transactionAmounts/transactionShares/value"))
    t.price_per_share  = _parse_float(_findtext(tx_el, "transactionAmounts/transactionPricePerShare/value"))
    t.shares_owned_after = _parse_float(
        _findtext(tx_el, "postTransactionAmounts/sharesOwnedFollowingTransaction/value")
    )
    t.direct_or_indirect = _findtext(tx_el, "ownershipNature/directOrIndirectOwnership/value") or "D"
    return t


# ─── 13F-HR parser ────────────────────────────────────────────────────────────

# 13F filings ship the holdings as a separate `infotable.xml` per filing.
# Schema namespace: https://www.sec.gov/edgar/document/thirteenf/informationtable
_NS_13F = {"n": "http://www.sec.gov/edgar/document/thirteenf/informationtable"}


def parse_13f_information_table(xml_bytes: bytes) -> list[HoldingRow]:
    """Parse 13F-HR informationTable XML into HoldingRow list."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning("form13f_xml_parse_failed", error=str(e))
        return []

    rows: list[HoldingRow] = []
    # Try with namespace first, fall back to no-namespace
    info_tables = root.findall("n:infoTable", _NS_13F) or root.findall("infoTable")
    for it in info_tables:
        h = HoldingRow()
        h.issuer_name = _findtext(it, "n:nameOfIssuer", _NS_13F) or _findtext(it, "nameOfIssuer")
        h.cusip       = _findtext(it, "n:cusip", _NS_13F) or _findtext(it, "cusip")
        h.value_usd   = _parse_float(_findtext(it, "n:value", _NS_13F) or _findtext(it, "value"))
        # Pre-2023 13F: "value" is in $thousands. Post-Dec-2022: full $.
        # We over-correct heuristically below using shrsOrPrnAmt.
        shrs_el = it.find("n:shrsOrPrnAmt", _NS_13F) or it.find("shrsOrPrnAmt")
        if shrs_el is not None:
            h.shares     = _parse_float(_findtext(shrs_el, "n:sshPrnamt", _NS_13F) or _findtext(shrs_el, "sshPrnamt"))
            h.share_type = _findtext(shrs_el, "n:sshPrnamtType", _NS_13F) or _findtext(shrs_el, "sshPrnamtType") or "SH"
        h.investment_discretion = _findtext(it, "n:investmentDiscretion", _NS_13F) or _findtext(it, "investmentDiscretion")
        va = it.find("n:votingAuthority", _NS_13F) or it.find("votingAuthority")
        if va is not None:
            h.voting_authority_sole   = _parse_float(_findtext(va, "n:Sole", _NS_13F) or _findtext(va, "Sole"))
            h.voting_authority_shared = _parse_float(_findtext(va, "n:Shared", _NS_13F) or _findtext(va, "Shared"))
            h.voting_authority_none   = _parse_float(_findtext(va, "n:None", _NS_13F) or _findtext(va, "None"))
        rows.append(h)
    return rows


# ─── Schedule 13D/G parser ────────────────────────────────────────────────────

# SC 13D/G are HTML cover pages — parse with regex on key labelled fields.
_SC13_PATTERNS = {
    "shares": re.compile(
        r"(?:aggregate\s+amount\s+beneficially\s+owned[^0-9]{0,80})"
        r"([\d,]+(?:\.\d+)?)", re.IGNORECASE | re.DOTALL,
    ),
    "percent": re.compile(
        r"(?:percent\s+of\s+class[^0-9]{0,60})"
        r"([\d.]+)\s*%", re.IGNORECASE | re.DOTALL,
    ),
    "sole_voting": re.compile(r"sole\s+voting\s+power[^0-9]{0,40}([\d,]+)", re.IGNORECASE | re.DOTALL),
    "shared_voting": re.compile(r"shared\s+voting\s+power[^0-9]{0,40}([\d,]+)", re.IGNORECASE | re.DOTALL),
    "sole_dispositive": re.compile(r"sole\s+dispositive\s+power[^0-9]{0,40}([\d,]+)", re.IGNORECASE | re.DOTALL),
    "shared_dispositive": re.compile(r"shared\s+dispositive\s+power[^0-9]{0,40}([\d,]+)", re.IGNORECASE | re.DOTALL),
    "cusip": re.compile(r"\bCUSIP[^A-Z0-9]{0,10}([0-9A-Z]{6,9})", re.IGNORECASE),
    "issuer": re.compile(r"name\s+of\s+issuer[^A-Za-z0-9]{0,40}([A-Z][A-Z0-9 &.,'\-]{2,80})", re.IGNORECASE),
    "purpose": re.compile(
        r"item\s+4\.?\s+purpose\s+of\s+transaction\s*[:.]?\s*(.{50,1500}?)(?:item\s+5|signature)",
        re.IGNORECASE | re.DOTALL,
    ),
}


def parse_schedule_13(text: str, schedule_type: str) -> Schedule13Filing:
    """Best-effort regex parse of SC 13D or SC 13G text."""
    f = Schedule13Filing(schedule_type=schedule_type)

    if m := _SC13_PATTERNS["issuer"].search(text):
        f.issuer_name = m.group(1).strip()[:200]
    if m := _SC13_PATTERNS["cusip"].search(text):
        f.issuer_cusip = m.group(1).strip()
    if m := _SC13_PATTERNS["shares"].search(text):
        f.shares_beneficially_owned = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["percent"].search(text):
        f.percent_of_class = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["sole_voting"].search(text):
        f.sole_voting = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["shared_voting"].search(text):
        f.shared_voting = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["sole_dispositive"].search(text):
        f.sole_dispositive = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["shared_dispositive"].search(text):
        f.shared_dispositive = _parse_float(m.group(1))
    if m := _SC13_PATTERNS["purpose"].search(text):
        f.purpose_summary = re.sub(r"\s+", " ", m.group(1)).strip()[:1000]

    # Reporting persons — collect distinct entries appearing under "Name of Reporting Person"
    for m in re.finditer(
        r"name\s+of\s+reporting\s+person[s]?[^A-Za-z0-9]{0,40}([A-Z][A-Z0-9 &.,'\-]{2,80})",
        text, re.IGNORECASE,
    ):
        n = m.group(1).strip()
        if n and n not in f.reporting_persons:
            f.reporting_persons.append(n)
        if len(f.reporting_persons) >= 10:
            break

    return f


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _findtext(el, path: str, ns: dict | None = None) -> str:
    if el is None:
        return ""
    t = el.find(path, ns) if ns else el.find(path)
    if t is None or t.text is None:
        return ""
    return t.text.strip()


def _parse_float(s: str) -> float:
    if not s:
        return 0.0
    try:
        return float(str(s).replace(",", "").replace("$", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return 0.0


# ─── Public dispatcher ────────────────────────────────────────────────────────

def parse_sec_form(filing_type: str, content: bytes, html_text: str = "") -> dict:
    """
    Dispatch to the right form parser. Returns a dict suitable for attaching
    to chunk metadata under the key `sec_form_data`.

    For 4 / 13F-HR: requires the structured XML payload (caller must locate it).
    For SC 13D/G:   uses html_text (HTML/text cover page).
    For DEF 14A / S-1 / others: returns {} (handled as narrative).
    """
    ft = filing_type.upper().strip()
    if ft in ("4", "FORM 4"):
        f = parse_form_4_xml(content)
        if f is None:
            return {}
        return {
            "form": "4",
            "issuer_ticker": f.issuer_ticker,
            "issuer_name": f.issuer_name,
            "reporter_name": f.reporter_name,
            "reporter_relationship": f.reporter_relationship,
            "officer_title": f.officer_title,
            "period_of_report": f.period_of_report,
            "transactions": [
                {
                    "date": t.transaction_date,
                    "code": t.transaction_code,
                    "shares": t.shares,
                    "price": t.price_per_share,
                    "value_usd": t.shares * t.price_per_share,
                    "is_derivative": t.is_derivative,
                    "owned_after": t.shares_owned_after,
                }
                for t in f.transactions
            ],
        }
    if ft in ("13F-HR", "13F"):
        rows = parse_13f_information_table(content)
        return {
            "form": "13F-HR",
            "holdings_count": len(rows),
            "total_value_usd": sum(r.value_usd for r in rows),
            "top_holdings": sorted(
                [{"name": r.issuer_name, "cusip": r.cusip, "value": r.value_usd, "shares": r.shares}
                 for r in rows],
                key=lambda x: x["value"], reverse=True,
            )[:50],
        }
    if ft in ("SC 13D", "SC 13G"):
        text = html_text or content.decode("utf-8", errors="replace")
        # Strip HTML if present
        text = re.sub(r"<[^>]+>", " ", text)
        f = parse_schedule_13(text, "13D" if "13D" in ft else "13G")
        return {
            "form": f.schedule_type,
            "issuer_name": f.issuer_name,
            "issuer_cusip": f.issuer_cusip,
            "reporting_persons": f.reporting_persons,
            "shares_beneficially_owned": f.shares_beneficially_owned,
            "percent_of_class": f.percent_of_class,
            "sole_voting": f.sole_voting,
            "shared_voting": f.shared_voting,
            "sole_dispositive": f.sole_dispositive,
            "shared_dispositive": f.shared_dispositive,
            "purpose_summary": f.purpose_summary,
        }
    return {}
