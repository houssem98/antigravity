# Data Processing Addendum (DPA)

**Effective date:** 2026-05-10

> ⚠ TEMPLATE — Counsel review required. Do not execute as-is. This document
> conforms to GDPR Art. 28 + UK GDPR + CCPA service-provider clauses.

This Data Processing Addendum ("DPA") forms part of the Master Services
Agreement or Terms of Service ("Agreement") between [COMPANY NAME] ("Processor")
and the customer identified in the Agreement ("Controller").

## 1. Definitions

Capitalized terms not defined here have the meanings given in the Agreement.

- **Personal Data**, **Process(ing)**, **Controller**, **Processor**,
  **Data Subject**, **Sub-processor**, **Supervisory Authority** — as defined in
  GDPR.
- **Customer Data** — Personal Data Controller submits to or generates within
  the Service.
- **Standard Contractual Clauses** ("SCCs") — EU Commission Decision 2021/914
  Module 2 (Controller-to-Processor), with the UK Addendum where Controller is
  in the UK.

## 2. Roles

Controller is the Controller of Customer Data. Processor processes Customer Data
solely on Controller's documented instructions, including those embodied in the
Agreement, this DPA, and Controller's configuration of the Service.

## 3. Scope of Processing

| Item | Description |
|---|---|
| Subject matter | Provision of the Service |
| Duration | Term of the Agreement + retention periods in Privacy Policy §5 |
| Nature/Purpose | Hosting, retrieval, AI inference, billing, support |
| Categories of Data Subjects | Controller's authorized users, individuals named in Customer Content |
| Categories of Personal Data | Account data, usage data, Customer Content, payment metadata |
| Special-category Data | Only if Controller uploads it (use at Controller's risk) |

## 4. Sub-processors

Controller authorizes Processor to engage the sub-processors listed at
`/legal/sub-processors`. Processor will (a) impose data-protection obligations
on each sub-processor at least as protective as this DPA, and (b) remain liable
to Controller for sub-processor acts and omissions.

Processor will give Controller at least 30 days' notice of new sub-processors.
Controller may object on reasonable grounds; if the objection cannot be
resolved, Controller may terminate the affected portion of the Service for a
pro-rata refund.

## 5. Security

Processor implements the technical and organizational measures described in
the Privacy Policy §8 ("Security"), including:

- Encryption at rest (AES-256-GCM envelope) and in transit (TLS 1.2+)
- Pre-retrieval entitlement ACL + MNPI wall-crossing controls
- Tamper-evident audit log with hash chain + HMAC
- 17a-4 audit-trail-alternative WORM archival
- TOTP MFA, session timeouts, IP allowlists (per-org)
- Vulnerability management, regular penetration testing, role-based access
- Annual SOC 2 Type II audit (in progress as of effective date)

Material changes to the security program that materially decrease protection
require 30 days' notice.

## 6. Data Subject Requests

Processor will, taking into account the nature of processing, assist Controller
through appropriate technical and organizational measures (insofar as possible)
to fulfil Controller's obligations to respond to Data Subject requests under
applicable law (GDPR Arts. 12-23, CCPA §1798.105/110/115). Where Processor
receives a Data Subject request directly, it will redirect the Data Subject to
Controller without acting on the request, except as required by law.

## 7. Personal Data Breach

Processor will notify Controller without undue delay (and within 72 hours where
required by GDPR Art. 33) after becoming aware of a Personal Data Breach
affecting Customer Data, providing the information Controller reasonably
requires to comply with its own notification obligations.

## 8. International Transfers

Where Processor transfers Customer Data to a country outside the EEA, UK, or
Switzerland that is not subject to an Adequacy Decision, the SCCs are
incorporated by reference, with the following choices:

- Module 2 (Controller-to-Processor)
- Clause 7 (docking) — included
- Clause 9 (sub-processors) — Option 2 (general written authorization), 30-day
  notice
- Clause 11 (redress) — independent dispute-resolution body NOT selected
- Clause 17 (governing law) — law of the Member State of Controller's
  establishment
- Clause 18 (forum) — courts of the Member State of Controller's establishment
- Annex I.A: identifying parties — see Agreement signature blocks
- Annex I.B: description of transfer — see DPA §3 above
- Annex II: technical and organizational measures — see DPA §5 + Privacy Policy §8
- Annex III: list of sub-processors — see `/legal/sub-processors`

UK customers: the IDTA / UK Addendum to the SCCs applies.

## 9. Audits

Processor will make available to Controller all information necessary to
demonstrate compliance with this DPA. Processor will allow audits, including
inspections, conducted by Controller or an independent auditor mandated by
Controller, no more than once per year, on at least 30 days' notice, during
business hours, subject to (a) confidentiality obligations, (b) reasonable
restrictions to protect other customers' data, and (c) reimbursement of
Processor's reasonable costs above 1 person-day per year.

A Type II SOC 2 report (when available) satisfies this clause.

## 10. Deletion and Return

Within 30 days of termination of the Agreement, Processor will (at Controller's
choice) delete or return Customer Data, except where retention is required by
law (e.g., 17a-4, FINRA 4511, MiFID II, tax retention) or where Customer Data
is needed to defend legal claims.

## 11. Liability

Liability under this DPA is subject to the limitations set out in the
Agreement, except where prohibited by law.

## 12. Order of Precedence

In case of conflict: (1) SCCs (where incorporated), (2) this DPA, (3) the
Agreement, (4) the Privacy Policy.

---

**Signed**

For Controller:
Name / Title / Date / Signature

For [COMPANY NAME] (Processor):
Name / Title / Date / Signature
