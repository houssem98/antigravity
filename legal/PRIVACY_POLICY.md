# Privacy Policy

**Effective date:** 2026-05-10
**Last updated:** 2026-05-10

> ⚠ TEMPLATE — Counsel review required. Replace placeholders. This template
> covers the GDPR / CCPA basics for a B2B AI SaaS but every jurisdiction has
> idiosyncrasies that boilerplate cannot capture.

[COMPANY NAME] ("we", "us") operates the Gravity Search service.
This Privacy Policy explains what personal data we collect, how we use it,
who we share it with, and your rights.

## 1. Data We Collect

**Account data:** name, email, organization name, role, hashed password,
optional MFA secret (encrypted at rest).

**Usage data:** queries you submit, retrieval-result IDs returned, generated
answers, citation metadata, latency, cost, model version, prompt template hash,
device + browser identifiers, IP address. Each request emits a tamper-evident
audit record that includes these fields (FINRA 4511 / MiFID II compliant
schema).

**Customer Content:** documents you upload, deal-room files, project context,
notes, exports. We treat Customer Content as confidential.

**Payment data:** processed by Stripe, Inc. We do not store card numbers; we
retain only Stripe's customer ID, plan, subscription status, and last-4 of card
where Stripe surfaces it.

**Cookies / local storage:** session token, MFA challenge token, dev-mode flag.
We do not use third-party advertising cookies.

## 2. Why We Process Your Data

| Purpose | Legal basis (GDPR) |
|---|---|
| Provide the Service | Contract |
| Bill subscriptions | Contract |
| Detect abuse / secure systems | Legitimate interest |
| Comply with audit / regulatory obligations | Legal obligation (FINRA 4511, SEC 17a-4, MiFID II, AML/KYC) |
| Improve the Service via aggregated metrics | Legitimate interest (no personal data) |
| Send service announcements | Legitimate interest |
| Marketing emails (opt-in only) | Consent |

## 3. Sub-Processors

We use the following sub-processors. Each is bound by a data-protection
agreement that includes EU Standard Contractual Clauses where applicable.

| Sub-processor | Purpose | Region |
|---|---|---|
| Anthropic, PBC | LLM inference | US |
| OpenAI, OpCo LLC | LLM inference (optional) | US |
| Google LLC | LLM inference (optional) | US |
| Voyage AI | Embeddings | US |
| Cohere Inc. | Reranking | US / Canada |
| Render Inc. / Fly.io | Hosting | US |
| Vercel Inc. | Frontend hosting | US |
| AWS / GCP | KMS for BYOK customers (their tenancy) | Customer's choice |
| Stripe, Inc. | Payments | US |
| Sentry Inc. | Error tracking | US |
| Langfuse GmbH | LLM observability (self-hosted by default) | EU |

A current list is published at `/legal/sub-processors`. We notify customers at
least 30 days before adding or replacing a sub-processor.

## 4. Where Your Data Is Stored

Default region is US. Enterprise customers may request EU data residency
(Frankfurt). BYOK customers control encryption-key region via their cloud KMS.

## 5. Retention

| Data category | Default retention |
|---|---|
| Audit logs (FINRA 4511 / MiFID II) | 6 years (configurable up to 7) |
| Account data | Lifetime of account + 30 days |
| Customer Content (uploads) | Until you delete + 30-day soft-delete window |
| Generated answers + citations | Lifetime of account (audit records persist 6y) |
| Stripe billing records | 7 years (tax) |
| Web analytics / aggregated metrics | 24 months |

## 6. Your Rights

Subject to your jurisdiction (GDPR / CCPA / CPRA / similar), you may:

- access the personal data we hold about you
- correct inaccurate data
- delete your account and personal data (subject to retention obligations
  above for audit/billing records)
- export your data in a portable format
- object to or restrict processing
- withdraw consent for marketing
- complain to a supervisory authority

To exercise any right, email [PRIVACY CONTACT EMAIL]. We respond within 30 days.

## 7. Children

The Service is not directed to children under 16. We do not knowingly collect
data from children. If you believe we have, contact us and we will delete it.

## 8. Security

Highlights of our technical and organizational measures:

- AES-256-GCM envelope encryption for stored API keys (P0.4 of internal spec)
- Optional BYOK via AWS KMS / GCP Cloud KMS / Azure Key Vault (P0.5)
- TLS 1.2+ for data in transit
- Pre-retrieval entitlement ACL prevents prompt-injection exfiltration (P0.1)
- MNPI tagging with mandatory wall-crossing approval and acknowledgement (P0.2)
- HMAC + SHA-256 hash chain on every audit record; tamper-evident (P0.3)
- 17a-4 audit-trail-alternative WORM archival with append-only DB role grants
- TOTP MFA, idle + absolute session timeouts, per-org IP allowlists (N1)
- HITL reviewer audit (FINRA 3110(b)(4)) on every AI-generated record
- SOC 2 Type II observation in progress

We will notify affected customers without undue delay (and within 72 hours for
GDPR-covered breaches) of any security incident affecting their data.

## 9. International Transfers

For EU/UK customers: we transfer data to the US under Standard Contractual
Clauses (EU 2021/914, UK addendum) and where applicable rely on Adequacy
Decisions or your explicit consent.

## 10. AI / ML Specifics

**Outputs may be hallucinated.** Every generated claim is grounded against
retrieval context and scored by NLI + numeric verifier + finance-tuned
hallucination guardrail (Patronus Lynx-equivalent). Grounding scores and
citation metadata accompany every record.

**No training on your data.** We do not use Customer Content to train shared
models. Sub-processor LLMs operate under Zero-Data-Retention or equivalent
contracts where available (Anthropic ZDR addendum, OpenAI ZDR, Azure OpenAI
Modified Abuse Monitoring).

**Auditable.** You can request a complete tamper-evident audit log of all
queries, retrieval contexts, citations, and outputs associated with your
account.

## 11. Changes

We will post material changes here with at least 30 days' notice and notify
account admins by email.

## 12. Contact

[PRIVACY CONTACT EMAIL]
[COMPANY NAME] · [REGISTERED ADDRESS]

EU representative (where required under GDPR Art. 27): [EU REP NAME / ADDRESS]
