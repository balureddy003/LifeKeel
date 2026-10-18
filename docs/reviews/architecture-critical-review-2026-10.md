# LifeKeel Architecture — Critical Expert Review

**Reviewed:** `ARCHITECTURE.md` (implementation-aligned snapshot dated
17 October 2026) plus spot verification against `apps/api`, `packages/*`,
and `docs/`.
**Method:** adversarial multi-disciplinary review simulating an external
architecture board. The goal was to find what the document *missed or got
wrong*, not to re-list gaps it already discloses. The existing P0/P1/P2 gap
register is assumed read; findings below are either new, or escalate
something the document understates.
**Reviewer lenses:** chief architect, privacy/data-protection, security,
SRE/reliability, data engineering, AI systems, product/regulatory,
commercial/finops.

---

## Verdict

The architecture is **unusually honest about its own debt** — the gap
register is a genuine strength, not decoration. The deterministic-first
stance, trust-tier model, decision-matrix discipline, and refusal to adopt
agent frameworks prematurely are all defensible.

The residual risk concentrates in four places:

1. **Regulatory domains the product already touches but the architecture
   does not model** — children's data most importantly, plus DPIA/RoPA,
   incidental special-category content, and Open Banking consent lifecycle.
2. **Lifecycle edge cases the data model cannot express** — member
   transitions (youth→adult, death, departure), backup↔erasure
   contradiction, timezone semantics, and single-currency assumption.
3. **Policy-as-prose vs policy-as-mechanism** — trust tiers, context
   budgets, and processor terms are described in documents; several have no
   enforcing code path yet. The document knows this for AI; the same
   critique applies to tenancy, erasure, and disclosure.
4. **The document itself has no conformance machinery** — nothing keeps a
   ~3,000-line, self-assessed architecture aligned with code as it drifts.

---

## P0 findings — product or regulatory claims that are currently unsafe to make

### F1. Children's-data regulatory posture is absent from the architecture

**Expert:** privacy/regulatory. **Severity: P0.**

LifeKeel models youth members, serves youth-facing views, runs youth
literacy content, and plans youth AI interactions. That makes it a service
"likely to be accessed by children" under the ICO's Age-Appropriate Design
Code (Children's Code), and it processes children's personal data under UK
GDPR — arguably at volume, by design, not incidentally.

The document covers **youth redaction** (what a child can see) but is
silent on the much larger obligations:

- **Parental/guardian consent model** — who consents for a youth member's
  profile, documents, and AI interactions? Verifiable parental consent is a
  distinct mechanism from family invites.
- **"Best interests of the child" standard** — required to be a primary
  consideration; not recorded as a design constraint anywhere.
- **Profiling restrictions** — the Children's Code defaults profiling
  *off* for children. Readiness scoring, member-agent nudges, and detector
  evaluation run against youth twins today; the architecture needs a named
  position on which automated processing applies to minors and why it is
  justified.
- **Marketing to children** — lifecycle/campaign eligibility must
  explicitly exclude youth members; the consent model only records
  `consent.marketing` without an age gate in the architecture.
- **AI interaction with minors** — Ask Keel for a youth member needs its
  own task policy (narrower context, stronger output guards, no
  retention) before any youth-facing assistant path ships.
- **Age-out transition** — when a youth becomes an adult, consent,
  visibility, and history all change. Nothing models it (see F5).

**Remediation:** a children's-data section covering consent model,
profiling position, marketing exclusion, youth AI policy, age-out
workflow, and a DPIA specifically covering minors' data (see F4).

### F2. Backup↔erasure contradiction is unaddressed

**Expert:** data engineering. **Severity: P0.**

Account erasure is required to propagate to caches, spans, scorers, and
providers (existing P0 row). But nobody has answered: **what happens to
erased data inside backups?** Two failure modes:

- Restoring an old backup **reintroduces** data a user was told was
  deleted — a broken GDPR promise after a disaster, precisely when trust
  matters most.
- Backup retention effectively becomes a shadow retention policy the
  privacy page does not describe.

Standard remedies the architecture should choose between:

- **Crypto-shredding:** per-tenant data-encryption keys for
  highest-sensitivity data; erasure destroys the key, making backup copies
  unreadable. Also limits vault blast radius (see D3).
- **Post-restore tombstone replay:** a durable erasure ledger that runs
  before a restored instance accepts traffic.
- **Documented backup-retention disclosure** as the minimum.

This is not hypothetical: the document already requires restore drills; a
restore drill without an erasure-replay check tests availability but not
privacy.

---

## P1 findings — real gaps, needed before material scale or higher stakes

### F3. No DPIA, RoPA, or lawful-basis register for the live product

**Expert:** privacy. The document mentions DPIA only as a precondition for
reintroducing federated learning and adding health data. Inverting that
logic: a system processing financial profiles, children's data, email
content, document uploads, and AI-derived inferences almost certainly
**already requires** a DPIA under UK GDPR Art. 35 (systematic monitoring,
novel technology, children's data are all listed triggers). There is no
record of processing activities, no lawful-basis mapping per data class,
and no retention schedule document referenced. The "data catalogue" gap
(P1) should explicitly include lawful basis and DPIA linkage per class.

### F4. Member lifecycle transitions are not a domain concept

**Expert:** product/data. Life-event *playbooks* cover divorce and
bereavement as scenarios, but the **data and permission lifecycle** of a
member is unmodeled:

- **Youth→adult:** consent re-papering, redaction removal, history
  visibility, their own account.
- **Member departure:** what happens to attributed policies, legacy
  records, and their twin when someone leaves the family?
- **Member death:** the estate product's central event — continuity
  checks exist, but there is no named "member deceased" state driving
  twin, notification, and legacy transitions.
- **Divorce/split:** already flagged as a future merge/split workflow;
  it also implies *separating* intertwined records.

For a product explicitly about decades-long family continuity, this is a
first-order domain gap, not a backlog item.

### F5. Incidental special-category data is unavoidable but unhandled

**Expert:** privacy/security. "Health schemas are deferred" is a schema
decision, not a data reality. Users *will* upload letters mentioning
medical conditions into the vault and document intake; mailboxes contain
health-adjacent correspondence. Art. 9 obligations apply to data actually
held, not only data in named schemas. Needed: an explicit position —
upload classification, acceptable-use notice, stronger retention/processing
posture for flagged documents, or documented acceptance of incidental
processing with safeguards (encryption at rest, no hosted-AI routing,
stricter access logging).

### F6. Open Banking consent lifecycle is absent

**Expert:** regulatory/integration. The account-info path is read-only and
gated — correctly. But going live with an AISP partner brings obligations
the architecture does not model: **90-day consent re-confirmation** (UK),
consent revocation propagating to stored account records and derived
signals, and the agent-vs-principal contractual posture. These are
upstream design constraints on the connector's credential and data
lifecycle, not just onboarding paperwork.

### F7. Connector credential custody is under-specified

**Expert:** security. "Encrypted at rest" is stated, but the credential
*model* is not: IMAP app passwords vs OAuth tokens, scope minimization,
revocation detection, credential rotation, and what a credential
compromise enables. Mailbox credentials are among the highest-value
secrets the system holds — Google/Microsoft also impose verification
requirements for sensitive OAuth scopes at production scale. Needs a
credential-custody section: token type per provider, scope justification,
rotation/revocation, and compromise blast-radius.

### F8. Trust tiers classify side-effects, not disclosure sensitivity

**Expert:** security/product — a conceptual criticism, not a wiring gap.
The tier model (0–3) governs *actions*, but several of LifeKeel's worst
failures are **information-flow** failures: a Tier-0 insight or legacy
summary shown to the wrong member is a breach even though nothing was
"executed." Role-based redaction exists, but there is no equivalent
named classification for *who may see what* — a disclosure/confidentiality
dimension parallel to action tiers (e.g., organizer-only, adult-only,
member-private, professional-shareable). Making this explicit would
systematize what is currently enforced per-route.

### F9. The document has no conformance machinery and is self-assessed

**Expert:** chief architect — a meta-finding. Three issues:

- The executive scorecard labels product safety "**Strong**" while the
  same document registers three P0 safety gaps (signed links, guard
  asymmetry, publishing policy). "Good foundations" is the honest rating.
- §8 states "four independent architecture reviews agree the core design
  is correct" — those were internal review passes. This document is the
  first explicitly adversarial pass; the claim should say what it is.
- Nothing verifies the document stays true: no ADR process, no
  architecture fitness functions, no CI check that "implemented" claims
  remain exercised. A 3,000-line architecture file is itself a drift
  liability. Recommend: short ADRs for contested decisions, dependency/
  domain-architecture tests (already in Stage 1), and a quarterly
  claim-verification pass against code.

### F10. Delivery providers are single points of failure on a critical path

**Expert:** SRE. SendGrid carries lifecycle mail *and* product-critical
notifications (renewal reminders, continuity alerts, approval links).
Stage 3 mentions "evaluated secondary providers," but for a product whose
core promise is *proactive protection*, a SendGrid outage silently degrades
the central value. A warm secondary for transactional mail is arguably
P1, not stage-3 P2.

---

## P2 findings — correctness and maturity debts to record now

| # | Finding | Expert | Note |
|---|---|---|---|
| F11 | **Timezone semantics absent** — quiet hours, daily nudges, heartbeat windows, renewal reminders, and digest cadence compute on server time; families live in timezones | product/data | Add `tenant.timezone` (and per-member where relevant) to the data model and job scheduling contract |
| F12 | **Single-currency assumption** — no FX authority or currency field model despite an assets register, expat use cases, and a live `fetch-yfinance.py` fetcher | data | Detector math silently assumes one currency; multi-currency needs a stated conversion policy or explicit single-currency scope |
| F13 | **Cold-start budget unmeasured** — scale-to-zero + embedding/model init + YAML resource loading can push first-request latency well past the proposed interactive SLO | SRE | Measure cold start; consider min-instances for API or defer model init off the request path |
| F14 | **No operator-access transparency to users** — operators can read/export family data with internal audit, but the family cannot see who accessed their data | trust/product | For a product whose pitch is trust, user-visible access history is a differentiator |
| F15 | **No vendor exit/portability table** — Mongo, Redis, SendGrid, Twilio, Stripe, Firebase, Cloud Run lock-in is unpriced | architect | A one-page exit-cost table per critical vendor is cheap insurance and clarifies which ports must stay clean |
| F16 | **Tokenizer estimate vs billed usage** — the gateway "estimates/rejects" input tokens, but cross-provider tokenizers differ; systematic under-estimation leaks budget | AI systems | Reconcile estimated vs billed tokens per provider/model; alert on drift |
| F17 | **No CODEOWNERS/on-call map** — gap register has no owner column; runbooks exist but domain ownership is implicit | operations | Add owner per domain/data class; assign every P0/P1 a named owner |
| F18 | **Prompt-injection defense-in-depth thin** — "delimit untrusted text" is one layer; no canary detection, output allow-lists for email-sourced tasks, or retrieval-side sanitization described | AI security | Add injection-specific patterns to the adversarial CI plan (already listed as a gap; strengthen the defense side) |

---

## Design decisions worth challenging (disagreements, not gaps)

These are positions the document *defends* where a reviewer disagrees or
wants stronger justification on record:

### D1. API + scheduler + workers in one deployment

The document frames this as a scaling issue to split "when measured."
Counterpoint: it is also a **security and blast-radius** issue — a bad
deploy or compromised API replica takes down the safety nets (scheduler,
DLQ recovery) that would notice it; and worker CVEs share the API's
credentials. A cheap intermediate step exists before full deployment
split: **separate Cloud Run services sharing the same image with different
entry points**, which the doc already gestures at. Recommend pulling this
forward of "measured trigger" framing — it is cheap insurance now.

### D2. Custom Redis queue vs managed queue

The architecture defers a managed queue on cost grounds, while its own
register lists the queue as losing-jobs-capable (P0 volatile fallback,
P1 lease-blind recovery). If the fix for both findings is "add leases,
heartbeats, durable-required mode" to a hand-rolled queue, that is
rebuilding a meaningful fraction of a managed product. The crossover for
queue replacement may arrive **earlier** than the document implies —
re-evaluate after the durability fix is costed, not after scale appears.

### D3. Pooled Mongo + single encryption key for the vault

One settings-encryption key protects all vaults and connector credentials.
A single key compromise + DB read = every family's vault. Per-tenant
envelope keys (DEKs) would: contain blast radius, enable crypto-shredding
for erasure (F2), and let vault sealing migrate cleanly. Cost is modest
(KEK/DEK pattern, KMS wrap). The document's "versioned envelope keys"
target should specify **per-tenant** wrapping for crown-jewel data.

### D4. "Health data deferred" vs reality of uploads

F5 covers the data side. The design point: "we don't build health schemas"
does not prevent the vault from *becoming* a health record store — it just
means the product won't know it happened. Either upload-time
classification, or explicit user guidance + processing posture, is needed
to make the deferral real.

### D5. Scorecard language vs gap register

Minor but worth fixing: internal consistency demands the self-assessment
match the debt the same document registers (see F9). Credibility of the
whole document rests on the scorecard not overselling.

---

## Recommended additions to the gap register

| Priority | New row |
|---|---|
| **P0** | Children's-data posture: parental consent, profiling position, marketing exclusion, youth AI policy, age-out transition, DPIA covering minors |
| **P0** | Backup↔erasure: restore can reintroduce erased data; choose crypto-shredding or tombstone replay and test it in restore drills |
| **P1** | DPIA/RoPA/lawful-basis register for the live product (not only future features) |
| **P1** | Member lifecycle transitions (youth→adult, death, departure, household split) as domain workflows |
| **P1** | Incidental special-category data policy for uploads/email |
| **P1** | Open Banking consent lifecycle (re-confirmation, revocation propagation) before partner go-live |
| **P1** | Connector credential custody model (token type, scopes, rotation, revocation, compromise blast radius) |
| **P1** | Disclosure/confidentiality classification parallel to action trust tiers |
| **P1** | Architecture conformance: ADRs, fitness functions, periodic claim verification; scorecard honesty |
| **P1** | Transactional email secondary/warm fallback (proactive alerts are core value) |
| **P2** | Tenant/member timezone model for scheduling and financial dates |
| **P2** | Currency/FX policy for multi-currency families |
| **P2** | Cold-start budget measurement vs interactive SLO |
| **P2** | User-visible operator-access transparency |
| **P2** | Vendor exit/portability table |
| **P2** | Estimated-vs-billed token reconciliation |
| **P2** | Domain ownership/CODEOWNERS map |

---

## What the architecture gets right (and should not regress)

- Deterministic authority with models as bounded components — the single
  most important choice, consistently applied.
- Honest status legend (Implemented/Bounded/Planned) and a gap register
  that names real P0s rather than smoothing them over.
- Trigger-based adoption: patterns and tools have entry conditions, not
  fashion-driven defaults — including the correct refusal of generic
  agent frameworks, broad vault RAG, and premature self-hosting.
- Claim-before-dispatch + ambiguous-state reconciliation for external
  effects — genuinely good pattern, rare at this size.
- Optimistic concurrency on profile writes (KEEL-006) — verified in code.
- The action-tier + exact-preview + receipt model is a stronger consent
  story than most products in this category.

## Review limitations

- This is a document-and-spot-check review, not a penetration test or load
  test; several findings would benefit from hands-on verification.
- "P0" here means the product's *claims* are unsafe without the fix —
  consistent with the document's own register semantics.
- The review simulates external expertise within the same system that
  wrote parts of the architecture; a genuinely independent third-party
  review remains worthwhile before external claims (privacy policy,
  investor/security diligence) rely on this document.
