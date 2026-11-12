# Record of Processing Activities (RoPA) — draft

| Field | Value |
|---|---|
| Document ID | LK-IMS-060 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Privacy lead / DPO (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

UK GDPR / EU GDPR Art. 30(1); ISO/IEC 27001 A.5.34. Built only from
[`docs/compliance/dpia.md`](../compliance/dpia.md) (§1 inventory, §2 proposed lawful bases),
[`docs/data-retention.md`](../data-retention.md) and
[`definitions/ai-processors.yaml`](../../definitions/ai-processors.yaml). Part of closing
**G-PRIV-01** (with the signed DPIA).

**Every lawful basis below is the DPIA's *proposal*, not a decision.** The DPIA (§2) marks each
one for confirmation by a named reviewer; nothing here is decided until it is signed.

## 1. Controller

| Item | Value |
|---|---|
| Controller | LifeKeel — legal entity name and registered address: TBD (not recorded in the repository) |
| Representative (EU/UK, if required) | TBD |
| DPO or privacy contact | TBD (CEO to appoint — `docs/ims/roles.md`) |

## 2. Processing activities

| # | Purpose | Data subjects | Personal data | Source | Proposed lawful basis (DPIA §2) | Systems | Retention (`docs/data-retention.md`) |
|---|---|---|---|---|---|---|---|
| P1 | Account and sign-in | Account holders | Name, email, password hash, MFA secret (encrypted) | The person | Art. 6(1)(b) contract — *confirm* | `users` | Until account deletion; unverified signups swept after 7 days; OTP challenges and send budgets by TTL |
| P2 | Household planning | The household | Income, outgoings, policies, pensions, goals | Organizer, documents, email | Art. 6(1)(b) for the account holder; Art. 6(1)(f) for other members' data — *balancing test sign-off* | `family_financial_profile`, `documents`, `inbox_items` | Until the family deletes it or the account; documents never swept by age |
| P3 | Roster | All household members, including children | Names, roles, dates of birth, email | Organizer | Art. 6(1)(f) — *balancing test sign-off* | `family_groups` | Until changed/removed or account deletion |
| P4 | Insights | The household | Detector output about gaps | Derived | Art. 6(1)(b) — *confirm* | `insights`, `signals` | Age sweep: signals 90 days, insights 180 days (defaults, per-tenant 30–365) |
| P5 | Assistant (Ask Keel) | The household | Minimised profile context, questions | The person | Art. 6(1)(b) — *confirm* | `apps/api/src/routes/assistant.ts` | Agent memory 365 days default (30–730) |
| P6 | Mailbox reading (optional) | Account holder and their correspondents | Message summaries, finance attachments | Gmail (read-only) or IMAP | Art. 6(1)(b) for the account holder; Art. 6(1)(f) for correspondents' incidental data — *confirm* | `inbox_items`, `documents` | Until disconnect with "delete what was read", or account deletion |
| P7 | Payments | Payer | Stripe customer and subscription IDs | Stripe | Not stated in DPIA §2 — *decide* (UK record-keeping cited for retention) | `tenants.billing` | Credit ledger and Stripe identifiers: 7 years after deletion |
| P8 | Security | Account holders | Sign-in history, IP, user agent | System | Art. 6(1)(f) — *confirm* | `login_events`, `audit_log` | `login_events` 30 days; audit log 7 years |
| P9 | Marketing (consented) | Leads and users who opted in | Email, consent record | The person | Consent (PECR reg. 22) — *confirm wording and records* | `leads`, `lifecycle_sends` | Leads 2 years after last activity; lifecycle ledger 2 years |
| P10 | Advertising cookies (marketing site) | Site visitors | Cookie identifiers | Browser | Consent (PECR reg. 6) — *confirm banner* | `apps/web/src/components/MarketingTags.tsx` | Per consent tool — not recorded in repo |
| P11 | Product analytics | Users | Growth events (aggregate) | System | Not stated in DPIA — *decide* | growth events | 13 months |
| P12 | Deletion evidence | Former account holders | Deletion receipts (counts by category, no content) | System | Not stated in DPIA — *decide* | deletion receipts | 7 years |

Special-category (health) data: **no basis relied on**; the product excludes it and strips
health terms from free text sent to models (`apps/api/src/privacy/special-category.ts`). Whether
to keep excluding or adopt an Art. 9 condition is an open DPIA decision (G-PRIV-04).

Children: no sign-ins, no marketing, used only for household planning; age checked at every
access boundary (DPIA §3; `docs/privacy/childrens-data-posture.md`). Open: age-out at 18 and
per-market consent design (G-PRIV-02).

## 3. Recipients (processors)

| Recipient | Activities | Status / terms | Transfer mechanism | Source |
|---|---|---|---|---|
| Azure OpenAI | P2, P4, P5, P6 (AI tasks) | Approved 2026-10-22; DPA dated 2026-10-22; retention `limited_abuse_log` | Microsoft SCCs / EU Data Boundary per DPA | `definitions/ai-processors.yaml` |
| Google Cloud Vertex AI | P2, P4, P5, P6 (AI tasks) | Approved 2026-10-22; DPA dated 2026-10-22; retention `limited_abuse_log` | EU SCCs / UK Addendum per DPA | `definitions/ai-processors.yaml` |
| Groq | P2, P4, P5, P6 (AI tasks) | Approved 2026-10-23; DPA dated 2026-10-23; region US | EU SCCs per GroqCloud DPA §8 | `definitions/ai-processors.yaml` |
| xAI | P2, P4, P5, P6 (AI tasks) | Approved only under the pre-launch testing exception; region US | EU SCCs per SpaceXSI DPA | `definitions/ai-processors.yaml`, CLAUDE.md |
| Anthropic, OpenAI | — | `unreviewed`; refused outside dev | not reviewed | `definitions/ai-processors.yaml` |
| Stripe | P7 | Not recorded in repository | Not recorded | `docs/compliance/pci-scope.md` |
| Google Cloud (hosting), Firebase, Cloudflare (Turnstile, R2), MongoDB/Redis host, SendGrid, Twilio, Open Banking provider, Gmail/IMAP providers | Hosting and delivery for all activities | **Not recorded in repository** | **Not recorded** | ISO_AUDITABLE.md §6.1; G-SUP-03 |

Note: AI processor regions for Azure and Vertex are "deployment-selected (not yet deployed)" in
the registry; record the actual regions when resources are provisioned.

## 4. Security measures (Art. 32 summary)

Tenant-scoped data access; per-tenant envelope encryption of sensitive fields and vault
documents; TLS; MFA; encrypted backups with erasure replay; malware scanning of uploads;
AI task gateway with processor registry; audit log. Detail and evidence:
`docs/ims/soa/iso27001-soa.yaml`.

## 5. Open items before this record is complete

1. Controller identity and DPO contact (TBD).
2. Lawful-basis decisions for P1–P12 (DPIA §2 sign-off).
3. Non-AI recipients, their roles, regions and transfer mechanisms (G-SUP-03).
4. Retention still open: inactive households, AI evaluation captures, queue collections,
   processor-side windows, `BACKUP_RETENTION_DAYS` (G-OPS-04).
5. Notice to other adults on the roster (DPIA §3; G-PRIV-03).
