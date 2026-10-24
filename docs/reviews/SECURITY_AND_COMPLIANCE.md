# LifeKeel security, privacy and compliance review

Review date: 22 October 2026. Baseline: `fe8c12db3d083fda989f6dfd1491af08edf1e1d2`, branch `feat/branded-email-templates`, including the working tree available at review time.

**Revision 2 (22 October 2026, `70b5e7a`):** second-pass review. R01 and R02 were re-traced against the source and still hold. Eight findings were added (R36–R43) covering areas the first pass did not reach: third-party trackers and consent, connector OAuth state binding, Google restricted scopes, recovery-token storage, MFA verification limits, signing-key separation, account enumeration and outbound-email content. The branded email layout added on this branch (`apps/api/src/email/layout.ts`) was reviewed: structural fields are escaped and callers escape user names, so it introduces no HTML-injection finding. IDs are stable; new rows sit in the register at their severity position.

**Revision 3 (22 October 2026, branch `fix/security-compliance-review`):** remediation. Every finding that code can close is fixed with tests; the rest have the code-side narrowing done and a working draft for the people who must decide. See [Remediation status](#remediation-status). One more issue found while fixing (R44) is included.

**Release recommendation: do not launch with real household data until the Critical finding and the applicable High findings are closed.** This recommendation concerns the reviewed source; it does not assert that the vulnerable revision is deployed or that a breach has occurred.

## Scope and evidence limits

This report covers UK GDPR, PII, ICO expectations, OWASP Web Top 10:2025, OWASP API Top 10:2023, PCI DSS and the UK FCA perimeter. Container and supply-chain controls are also covered as infrastructure concerns.

This is a repository-wide, risk-based static review, with focused reading of authentication, authorization, household sharing, account rights, upload/OCR/vault, connectors, AI policies, billing, retention, backups, frontend session storage, native shell, CI and deployment boundaries. Shared engine/platform/pipeline code, existing tests, policies and configuration were inspected where relevant. It is not an exhaustive execution of every route or a line-by-line audit of every source file.

Evidence labels:

- **Confirmed:** the implementation contains the described defect. Findings were traced statically, without exploiting a running service.
- **Conditional:** exposure depends on an explicit environment, provider or deployment condition; that condition is stated.
- **Governance/evidence gap:** required decisions, contracts or operational evidence were not supplied or are explicitly unfinished in the repository. This does not prove that no evidence exists elsewhere.

No production services, cloud accounts, customer records or payment provider accounts were accessed. No penetration test, browser/accessibility audit, load test, container build, restore drill or application test suite was run. Existing tests establish coverage intent, not a passing result for this review. No application code was changed. Existing uncommitted email/template/settings work was preserved. Local secret files were not read or copied into this report; full Git history was not secret-scanned.

The production dependency audit was attempted once with `pnpm audit --prod --audit-level=high --json`. It failed with `ENOTFOUND registry.npmjs.org`. **Current dependency vulnerability status is unverified; no clean audit or specific CVE claim is made.** Hosted CI, branch protections, environment approvals, IAM, database encryption, region, alert delivery and backup schedules remain unverified.

Severity definitions: **Critical** means an immediate account/system compromise path; **High** means significant confidentiality, integrity, financial or launch-compliance risk; **Medium** means meaningful hardening, correctness, availability or assurance work; **Low** means lower-impact maintenance/documentation risk. These are engineering priorities, not CVSS scores or regulator determinations. A governance severity describes launch risk, not an established legal violation.

## Prioritized fix register

| ID | Severity | Evidence | Item to fix |
|---|---|---|---|
| R01 | Critical | Confirmed | Password-reset and email-verification MongoDB operator injection |
| R02 | High | Confirmed | Existing MFA can be replaced using a session alone |
| R03 | High | Confirmed | Removing a family member does not revoke household access |
| R04 | High | Confirmed | Viewer accounts can mutate the household financial profile |
| R05 | High | Confirmed | Account export includes MFA secrets and bypasses vault metadata gating |
| R06 | High | Confirmed | Password changes/resets do not invalidate existing sessions |
| R07 | High | Confirmed | User-controlled IMAP connections can reach internal destinations |
| R08 | High | Confirmed | Adult-only access checks disagree with date-of-birth minor detection |
| R09 | High | Confirmed | Account deletion does not stop subscription billing; webhook can reactivate tombstones |
| R10 | High | Confirmed | Failed Stripe events cannot recover through normal redelivery |
| R11 | High | Confirmed | Published privacy notice contains placeholders and inaccurate statements |
| R12 | High | Governance/evidence gap | DPIA, lawful bases and children's-data responsibilities are unfinished |
| R13 | High | Governance/evidence gap | Health/special-category data can enter supposedly deferred workflows |
| R14 | High | Conditional | Hosted AI approval evidence is absent and enforcement can be disabled |
| R15 | High | Confirmed | Restore loses in-progress erasures and relies on surviving database tombstones |
| R16 | High | Governance/evidence gap | PCI DSS scope and merchant validation are not established |
| R17 | High | Governance/evidence gap | Open Banking and personalized outputs need FCA perimeter sign-off |
| R36 | High | Conditional | Ad and analytics trackers load without consent; privacy notice denies them |
| R37 | High | Confirmed | Connector OAuth state is not bound to the user who started the flow |
| R38 | High | Confirmed | Gmail connector requests full-mailbox and send scopes; restricted-scope verification is unplanned |
| R18 | Medium | Confirmed | Data export omits current product data and loads everything into memory |
| R19 | Medium | Confirmed | Erasure misses email-keyed leads and user-keyed login events |
| R20 | Medium | Confirmed | Backup helper writes unencrypted dumps and prints a credential-bearing URI |
| R21 | Medium | Confirmed | Long-lived bearer credentials remain in browser local storage |
| R22 | Medium | Confirmed | Raw request URLs and errors can disclose tokens and PII to logs/alerts |
| R23 | Medium | Confirmed | Retention does not cover the full data estate or bound billing records |
| R24 | Medium | Confirmed | Global rate limiting runs before authentication and uses instance-local counters |
| R25 | Medium | Confirmed | Uploads and mailbox parsing lack aggregate resource budgets |
| R26 | Medium | Confirmed | Document limit of zero disables the intended list bound |
| R27 | Medium | Confirmed | Financial-profile conflict handling can insert duplicates or return 500 |
| R28 | Medium | Confirmed | Real bank balances are represented as zero when not fetched |
| R29 | Medium | Confirmed | Local-judge CI model override does not override its expected digest |
| R30 | Medium | Confirmed | Release verification checks CI success but not security/image results |
| R31 | Medium | Conditional | Deployment supply-chain identity and artifact controls need tightening |
| R32 | Medium | Governance/evidence gap | Breach response, rights operations and production assurance lack evidence |
| R33 | Medium | Confirmed | Audit delivery is best-effort and immutability is only an application convention |
| R34 | Medium | Confirmed | Browser/native policies trust every Cloud Run subdomain |
| R39 | Medium | Confirmed | Recovery and verification tokens are stored in plaintext |
| R40 | Medium | Confirmed | MFA verification has no per-challenge attempt limit or code-replay protection |
| R41 | Medium | Confirmed | One secret signs every token type, with hardcoded fallbacks outside production |
| R35 | Low | Confirmed | Security and deployment documentation contradict current controls |
| R42 | Low | Confirmed | Signup, verification and lockout responses allow account enumeration and targeted lockout |
| R43 | Low | Confirmed | User-chosen names are sent verbatim in invitation and continuity emails |
| R44 | High | Confirmed | Any household member, including a viewer, could delete the whole household |

## Detailed findings

### R01 — Critical — MongoDB operator injection in account recovery

**Evidence:** `apps/api/src/routes/auth-users.ts:876`, `:888`, `:902`, `:628`, `:634`; JSON bodies are parsed without a recovery-route schema in `apps/api/src/server.ts:1549`.

The reset and verification handlers test token truthiness, then place the supplied value directly into MongoDB filters. TypeScript's declared string type provides no runtime protection. An object containing query operators can select a user without possession of their token; reset then replaces that user's password. Missing expiry fields do not cause rejection. A matching account with an expired reset may stop one selection, but does not eliminate the operator-injection path. MFA may still block a later login for MFA-enabled accounts; password integrity is already compromised.

**Fix:** require strict bounded scalar input for all recovery/verification fields; reject objects/arrays; validate expiry and one-time token state; update the resolved immutable user identity with an atomic token-consumption condition. Review other raw request-to-database filters for the same defect.

**Why:** a public password-reset endpoint can alter credentials without a valid recovery token. Mapping: Web A05/A07; API2; UK GDPR security and confidentiality.

### R02 — High — MFA replacement without reauthentication

**Evidence:** `apps/api/src/routes/auth-users.ts:942`, `:954`, `:970`.

Setup creates a new pending secret even when MFA is already enabled. Enable verifies only a code generated from that newly returned secret, then replaces the active factor and recovery codes. Neither operation requires the account password, the existing factor or recent strong authentication.

**Fix:** distinguish initial enrollment from replacement; require recent strong authentication for factor changes; reject unattended replacement of enabled MFA; notify the account holder and invalidate affected sessions.

**Why:** a stolen session can replace the victim's second factor and establish persistent control. Mapping: Web A07; API2/API6.

### R03 — High — Removed family members retain access

**Evidence:** `apps/api/src/routes/family-group.ts:313`; `apps/api/src/server.ts:1677`, `:1684`, `:1749`; `apps/api/src/routes/family-financial-profile.ts:971`.

Roster removal pulls the member record and updates legacy references, but leaves their user account and tenant binding active. Authentication checks suspension/revocation and tenant status, without requiring current roster membership. The removed person can continue logging in and reading tenant-scoped routes such as the financial profile. The hook also does not reject a missing user record outright.

**Fix:** revoke sessions and remove/suspend household membership atomically with removal; enforce current membership and user existence for household access; ensure login cannot reissue the old tenant authority.

**Why:** access can survive an explicit revocation during separation, household disputes or compromised-account recovery. Mapping: Web A01; API1/API5.

### R04 — High — Viewer can overwrite household finances

**Evidence:** `apps/api/src/routes/family-join.ts:251`; `apps/api/src/server.ts:1787`; `apps/api/src/routes/family-financial-profile.ts:1187`.

Joined users receive `viewer`, but the central resource map has no `family` entry. The financial-profile write route validates content and tenant identity, without an organizer/authorized-writer check. Tenant isolation does not prevent a viewer in the same household from changing salaries, pensions, coverage and other shared facts.

**Fix:** define and enforce household read/write permissions on financial-profile mutations and evaluate/apply paths; make authorization fail closed for unmapped sensitive routes. Confirm the intended permission for each action rather than assuming every adult is an editor.

**Why:** tampered financial inputs generate misleading readiness scores and planning outputs for the entire family. Mapping: Web A01; API3/API5.

### R05 — High — Export exposes security secrets and protected metadata

**Evidence:** `apps/api/src/routes/account.ts:62`, `:86`, `:97`; MFA fields in `apps/api/src/routes/auth-users.ts:74`; general document exclusion in `apps/api/src/routes/documents.ts:416`.

The export omits a legacy list of credential fields but leaves `mfa_secret`, `mfa_pending_secret` and `mfa_recovery_hashes` in the user record. It also exports all document metadata, including the estate-vault category, without the adult check used by vault routes. The generic `settings/read` permission permits viewer reads. This is a metadata disclosure, not evidence that sealed vault plaintext is decrypted by export.

**Fix:** export an explicit safe user-field allowlist; exclude all authentication material; apply vault/member visibility rules to exports and require appropriate export authority.

**Why:** ordinary downloads become durable copies of reusable second-factor secrets and protected family information. Mapping: Web A01/A07; API3; data minimization.

### R06 — High — Recovery does not revoke stolen sessions

**Evidence:** `apps/api/src/routes/auth-users.ts:814`, `:902`; revocation support in `apps/api/src/server.ts:1689`; logout only clears cookies at `apps/api/src/server.ts:1836`.

Password change/reset updates the password but never advances the revocation timestamp already supported by authentication. A previously stolen JWT remains valid. Logout similarly provides no server-side invalidation of the copied bearer token.

**Fix:** revoke pre-change sessions on recovery and password changes, rotate the continuing session where appropriate, and define server-side logout/session revocation behavior.

**Why:** changing a compromised password should end the attacker's existing access. Mapping: Web A07; API2.

### R07 — High — IMAP permits internal outbound connections

**Evidence:** `apps/api/src/routes/family-connectors.ts:136`, `:147`; `apps/api/src/email/imap-client.ts:54`.

An authenticated connector administrator controls host, port and TLS selection. These pass straight to ImapFlow without public-destination validation. The HTTP safe-fetch wrapper does not protect TCP IMAP connections. Exact reachable targets and credential interception depend on network egress and mail-server capabilities; successful metadata-service credential theft is not claimed.

**Fix:** restrict ports and enforce secure transport; block internal, loopback, link-local and reserved destinations after DNS resolution; prevent rebinding; apply connection deadlines and infrastructure egress restrictions.

**Why:** an external user can make the API probe or connect to internal network services, with additional credential risk from weak transport configurations. Mapping: Web A01/A02; API7/API8.

### R08 — High — Minor detection is inconsistent at access boundaries

**Evidence:** `apps/api/src/family/family-permissions.ts:41` versus `:76`; `apps/api/src/routes/family-join.ts:409`, `:524`; `apps/api/src/routes/vault.ts:89`.

Marketing considers either a child role or an under-18 DOB to identify a minor. Vault adult authorization checks only that the role is not `child`. Invite issuance also checks only role, while acceptance does not revalidate current age/child status. An adult-labelled member with an under-18 DOB can therefore pass adult gates; a pending invite can outlive a role change.

**Fix:** use one server-side age/role policy at issuance, acceptance and sensitive reads; recheck current status at consumption; define proportionate age assurance for signup/join and public lead capture.

**Why:** known underage members can receive estate data and account access contrary to the published adult-only posture. Mapping: Web A01/A06; API1/API5; children's privacy.

### R09 — High — Deletion and subscription lifecycle are disconnected

**Evidence:** `apps/api/src/routes/account.ts:130`, `:200`; retained tenant row described at `:31`; `apps/api/src/routes/billing.ts:753`, `:771`.

Account deletion erases household data and sign-ins but does not cancel the Stripe subscription or queue cancellation. The retained tenant still has Stripe identifiers. A later paid subscription invoice can locate it by customer and write `status: active`, with no deletion-state guard. Ongoing billing and tombstone reactivation are separate consequences of the same missing lifecycle coordination.

**Fix:** coordinate deletion with idempotent provider cancellation and durable retry/reconciliation; keep billing records only for justified retention; make deleted/deleting status terminal for payment webhooks. Verify that stale JWTs cannot regain access after any webhook.

**Why:** people can continue being charged after losing account access, and payment events can undo the deletion boundary. Mapping: Web A06/A08; API6; consumer fairness and erasure integrity.

### R10 — High — Billing failures are permanently claimed

**Evidence:** `apps/api/src/routes/billing.ts:56`, `:445`, `:456`, `:823`, `:829`.

A webhook is claimed before its effects. Any duplicate event ID is acknowledged regardless of whether the first attempt is processing, failed or completed. A crash or partial failure leaves normal Stripe retries ineffective. The failure alert advises manual redelivery, but redelivery of the same event remains a duplicate while its claim exists.

**Fix:** use durable processing leases and resumable, idempotent effects; distinguish completed duplicates from retryable failures; provide a safe audited recovery operation without manually deleting evidence.

**Why:** a transient database/provider failure can permanently lose paid credits, subscription state or ledger entries. Mapping: Web A08/A10; API10.

### R11 — High — Privacy notice is not ready for real data

**Evidence:** `apps/web/src/app/privacy/page.tsx:4`, `:49`, `:99`, `:124`, `:141`.

Controller identity, effective date and contact address remain placeholders. The notice says roster members do not get logins despite the join/invite flows. It describes deletion as immediate although the endpoint supports partial/202 outcomes. It claims approved hosted processing while all hosted entries are unreviewed. It lacks a clear purpose-by-purpose lawful-basis, transfers/safeguards and supervisory-complaint account.

**Fix:** publish reviewed jurisdiction-appropriate notices with real controller/contact details, accurate sharing and deletion wording, applicable bases, retention, transfers and complaint rights; link the actual processor inventory and distinguish optional processing.

**Why:** people cannot make informed decisions or exercise rights using placeholder and contradictory disclosures. Accountability records must reflect actual processing. [ICO documentation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/documentation).

### R12 — High — DPIA and lawful-basis evidence remain unfinished

**Evidence:** `docs/privacy/childrens-data-posture.md:3`, `:25`, `:65`, `:93`, `:117`.

The engineering posture explicitly is not the minors' DPIA, leaves purpose-specific lawful bases to counsel, identifies unknown-age leads, and defines an age-out process still awaiting implementation. An organizer's household role alone does not establish parental responsibility or lawful authority over another adult's personal information.

**Fix:** complete a DPIA and processing inventory; determine lawful bases per purpose and data subject; define parental-responsibility/authority evidence, family-member notices, age-out, objections and safeguards. Assess DPO, ICO fee/registration and UK/EU representative obligations against the actual organization and markets; do not assume each is automatically required.

**Why:** profiling children's information needs a documented DPIA and risk controls; adult-only account wording does not remove processing of children's records. [ICO children's-data guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/what-should-our-general-approach-be-to-handling-children-s-personal-information/).

### R13 — High — Special-category intake has no settled legal boundary

**Evidence:** `apps/api/src/routes/assistant.ts:190`, `:452`; `apps/api/src/routes/family-group.ts:330`; document intake at `apps/api/src/routes/documents.ts:99`.

Life-event free text can describe hospitalization, family notes can contain medical facts, and insurance/documents/email can include health information. These channels can enter assistant context even though comments describe health as GDPR-deferred. A warning not to enter medical details is not a technical or legal exclusion.

**Fix:** decide whether to exclude/redact such content or support it under a reviewed Article 6 basis and applicable Article 9 condition; minimize intake and model context, document processor eligibility and apply the decision consistently to uploads, inbox, support and free text.

**Why:** ordinary financial data is not automatically special-category data, but health content is; it requires additional legal justification and safeguards. [ICO special-category rules](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/?q=anonymised).

### R14 — High — Hosted AI approval is not launch evidence

**Evidence:** `definitions/ai-processors.yaml:7`; `apps/api/src/ai/task-gateway.ts:76`, `:92`, `:182`; `packages/platform/src/ai-processors.ts:133`.

Current non-dev defaults correctly enforce processor approval and deny hosted fallback. The hosted registry nevertheless has no approved entries, and explicit `off`/`warn` or fallback overrides remain possible outside development. This is conditional risk, not a finding that the current default silently sends family data to unapproved providers.

**Fix:** supply DPA, retention, no-training, region, transfer and deletion evidence for any enabled hosted processor; prohibit unauthorized production downgrades and audit approved exceptions. Validate the deployed configuration and explain unavailable hosted features honestly until approval is complete.

**Why:** a minimized prompt does not establish contractual or transfer compliance, and silent policy downgrades can defeat the intended boundary. [ICO processing-record requirements](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/documentation).

### R15 — High — Restore can resurrect erasure requests

**Evidence:** `scripts/ops/restore.sh:37`, `:41`, `:51`, `:62`; deletion starts at `apps/api/src/routes/account.ts:153`.

Before `--drop`, restore preserves only `status: deleted`, excluding in-progress `deleting` tenants. An older active tenant row can replace that erasure request. A fresh disaster-recovery target also has no latest tombstones to export from the destroyed database. Reconciliation is printed as a next step rather than enforced before traffic.

**Fix:** retain an independent current erasure journal covering deleting and deleted requests; restore/replay it before allowing reads, background jobs or traffic; include receipts and verify a fresh-target recovery scenario.

**Why:** disaster recovery must not silently make erased data and accounts active again. Backup erasure can be deferred under a controlled policy, but restored data still needs suppression and reconciliation.

### R16 — High — PCI DSS merchant assurance is unverified

**Evidence:** Stripe-hosted Checkout is created at `apps/api/src/routes/billing.ts:125` and `:254`; the inspected flows do not collect card numbers/CVV themselves. No merchant assessment evidence was supplied.

**Fix:** document the payment data-flow and scope; confirm the appropriate current SAQ/validation with the acquirer or assessor; retain provider compliance/responsibility evidence, required scan results and recurring review ownership. Explicitly prohibit PAN/CVV in documents, email, support and logs, with a handling process for accidental submissions.

**Why:** hosted Checkout reduces exposure but does not make the merchant site out of scope or prove PCI compliance. Do not automatically impose every SAQ A-EP requirement on a redirect-only implementation. [PCI SSC merchant website scope](https://www.pcisecuritystandards.org/faqs/is-a-merchant-website-still-in-scope-for-pci-dss-if-it-meets-all-the-criteria-for-saq-a/), [PCI DSS v4.0.1 SAQ bulletin](https://www.pcisecuritystandards.org/wp-content/uploads/2024/10/SAQs_for_PCI_DSS_v4.0.1_Bulletin.pdf).

### R17 — High — FCA perimeter needs a product-specific decision

**Evidence:** intended permanent informational boundary in `CLAUDE.md:33`; account-information provider at `apps/api/src/open-banking/providers.ts:115`; feature gate at `apps/api/src/routes/family-connectors.ts:244`; personalized assistant at `apps/api/src/routes/assistant.ts:218`.

The code deliberately excludes payment initiation and currently gates real token-based banking behind a flag. However, using an authorized aggregator does not itself establish that LifeKeel's own consolidated account-information service is outside regulation. Personalized retirement/insurance outputs, introductions and proposed actions also need assessment by actual behavior, not disclaimer text or keyword tests alone.

**Fix:** obtain a written perimeter assessment for account aggregation, advice, arranging and promotions; document any regulated partner/agent model, permissions and consent obligations before enabling live banking. Retain the product's informational boundary and review output/journey changes against it. Apply Consumer Duty, complaints and resilience obligations only where the assessed regulated relationship makes them applicable.

**Why:** read-only account aggregation can still be regulated; disclaimers do not settle whether output is a personal recommendation. [FCA AIS/PIS guidance](https://www.fca.org.uk/firms/account-information-services-payment-initiation-services), [FCA personal recommendations guidance](https://handbook.fca.org.uk/handbook/perg8/perg8s41).

### R18 — Medium — Export is incomplete and unbounded

**Evidence:** `apps/api/src/routes/account.ts:81`, `:110`; current erasure catalogue at `apps/api/src/erasure.ts:20`.

The JSON export enumerates a small legacy subset. Assets, cashflow, saved scenarios, inbox and other current personal records are absent. Reads use unbounded `toArray` operations in parallel. The header's assertion that derived records are not user data is too broad; identifiable inferences may be personal data even when not subject to portability.

**Fix:** define access and portability scopes separately; inventory current personal records, including applicable inferences; apply member privacy restrictions; stream or asynchronously package bounded exports. Keep original file download availability explicit.

**Why:** users may receive incomplete access responses, while large households can exhaust API memory during export.

### R19 — Medium — Erasure does not reconcile all identity keys

**Evidence:** `apps/api/src/erasure.ts:125`, `:207`; email-keyed leads at `apps/api/src/routes/leads.ts:22`; user/email login telemetry at `apps/api/src/routes/auth-users.ts:195`; 30-day login TTL at `apps/api/src/db.ts:55`.

Custom deletion covers lifecycle email rows, growth events and referrals, but not matching leads or login events. The latter persist user/email/IP linkage until their TTL. A lead captured before signup is not necessarily tenant-keyed and survives the tenant wipe. Some security/suppression retention may be justified, but it must be deliberately scoped and disclosed.

**Fix:** reconcile the full identity graph before removing users; delete/anonymize lead and login records or document a narrow lawful retention exception and its duration; ensure deleted accounts cannot reenter marketing.

**Why:** a tenant-filtered wipe cannot support broad erasure claims for records keyed by email, user ID or nested identifiers.

### R20 — Medium — Backup helpers expose sensitive artifacts

**Evidence:** `scripts/ops/backup.sh:22`, `:26`; `scripts/ops/restore.sh:63`.

The backup helper writes a compressed database dump without encryption or restrictive file permissions. Compression is not encryption. Restore prints `MONGODB_URL` in its suggested next command, which can expose database credentials when the URI contains them. External disk encryption and secret-safe operator practices were not verified.

**Fix:** enforce encrypted backup destinations, restricted permissions and lifecycle/access controls; redact connection credentials from output; separate key management from data archives and test restoration.

**Why:** backups contain ordinary document bytes, family records and recoverable wrapped keys; exposed connection credentials can compromise the live database.

### R21 — Medium — Browser scripts can read persistent credentials

**Evidence:** `apps/web/src/lib/auth-context.tsx:241`, `:332`, `:346`, `:356`; cookie implementation at `apps/api/src/auth/session-cookie.ts:28`.

HttpOnly cookies are implemented, but signup/login/MFA/invite still persist returned JWTs in local storage for bearer fallback. Any same-origin script compromise can copy those credentials. Existing logout purge is a useful protection against later users of the device, not script access during an active session.

**Fix:** finish the same-origin/same-site API migration, retire persistent bearer fallback and legacy storage, and select a protected native credential strategy where a native bearer flow remains necessary.

**Why:** long-lived script-readable credentials amplify an XSS or third-party-script compromise into account takeover. No exploitable XSS was confirmed in the reviewed frontend paths.

### R22 — Medium — URL/error telemetry can retain secrets

**Evidence:** default request logger at `apps/api/src/server.ts:1412`; alerts at `:1480`; OAuth callback routes at `apps/api/src/routes/connector-credentials.ts:12`; client exception forwarding at `apps/web/src/lib/observability.ts:18`.

Fastify logging has no project-specific URL redaction, and 5xx alerts include raw request URLs and exception messages. OAuth codes/state and signed action/invite tokens occur in query strings or paths. Browser Sentry has no project-level scrub hook when enabled. This is a data-exposure path, not proof of a particular token already being retained by an external service.

**Fix:** log route templates and allowlisted metadata; scrub credential-bearing paths/query parameters and provider errors before logs, alerts and tracing; enforce retention/access controls and verify scrub behavior with synthetic secrets.

**Why:** logs and alert destinations should not become an alternate credential or family-data store.

### R23 — Medium — Retention schedule is incomplete

**Evidence:** `apps/api/src/jobs/retention-worker.ts:48`; `docs/data-retention.md:54`; `apps/api/src/routes/account.ts:55`.

The nightly sweep covers four classes. Billing is retained merely “as the financial record,” and the documented schedule does not give every identity/AI/evaluation/queue record a bounded lifecycle. Seven-year audit retention is a project policy, not a universal legal requirement for all security metadata. Existing per-collection TTLs should be incorporated rather than duplicated blindly.

**Fix:** complete a per-purpose retention matrix with legal rationale, owner, field minimization, deletion mechanism and verification; distinguish tax/ledger evidence from incidental personal content; define inactivity and processor/backup windows.

**Why:** indefinite or unjustified retention increases breach impact and makes storage-limitation and erasure claims difficult to substantiate.

### R24 — Medium — Rate limiter does not implement its tenant-wide claim

**Evidence:** `apps/api/src/server.ts:1411`, `:1513`, `:1517`, `:1671`.

The limiter's default onRequest hook is registered before the hook populating `authContext`, so its tenant key normally falls back to IP. No Redis store is supplied, leaving counters per process. Fastify also has no configured trusted-proxy policy; deployed client-IP accuracy must be verified rather than trusting arbitrary forwarding headers.

**Fix:** authenticate before tenant-keyed limiting or derive a verified limiter identity; share enforcement across instances; define trusted proxy hops and sensitive-flow/account limits.

**Why:** scaling can multiply abuse allowances, while proxy/NAT behavior can incorrectly group unrelated people or deny access. Mapping: API4/API6.

### R25 — Medium — Resource budgets stop at per-file limits

**Evidence:** `apps/api/src/routes/documents.ts:109`, `:347`; `apps/api/src/email/imap-client.ts:106`, `:150`; `apps/api/src/server.ts:1539`.

Uploads have a 50 MB per-file cap, but storage is free without an aggregate tenant storage/ingestion budget at this path. IMAP fetches complete message sources and parses them before the attachment-size filter runs. A small number of large MIME messages or concurrent uploads can create substantial memory/storage pressure. Malware scanning is optional, and `not_performed` still permits extraction (`apps/api/src/routes/documents.ts:353`).

**Fix:** enforce aggregate storage, concurrency and intake budgets; bound source-message bytes before parsing; isolate expensive OCR/parsers; define scanner-required/quarantine policy for production and unsealed vault/email intake. Do not claim sealed ciphertext can be plaintext malware-scanned server-side.

**Why:** authenticated users or hostile incoming email can exhaust resources or feed unscanned files to parsers. Mapping: Web A06/A10; API4/API10.

### R26 — Medium — Zero document limit means unlimited

**Evidence:** `apps/api/src/routes/documents.ts:422`.

The list limit is capped only above. Zero passes through to MongoDB, where it removes the result limit; malformed values can also produce invalid numeric behavior.

**Fix:** validate a finite integer with a positive minimum and maximum, and provide cursor pagination.

**Why:** the advertised result cap can be bypassed, increasing response size, database work and API memory. Mapping: API4.

### R27 — Medium — Optimistic concurrency uses upsert on stale versions

**Evidence:** `apps/api/src/routes/family-financial-profile.ts:957`, `:1214`, `:1229`, `:1231`.

A stale version filter matches no row, but `upsert: true` attempts an insert instead of returning no result. With the unique tenant index, this throws a duplicate-key error before the intended 409 branch. If that asynchronously created, error-swallowed index is absent, a duplicate profile can be inserted. Omitting the optional version also bypasses conflict checking.

**Fix:** separate first creation from versioned update; require the correct version for existing records; map genuine conflicts to 409 and make critical uniqueness an awaited deployment requirement.

**Why:** concurrent family edits can yield 500s, duplicate data or silent overwrites in financial planning inputs.

### R28 — Medium — Unfetched bank balances appear as zero

**Evidence:** `apps/api/src/open-banking/providers.ts:151`; persistence at `apps/api/src/open-banking/sync.ts:85`.

TrueLayer account-list results are assigned `balance_minor: 0` because balance fetching is not implemented. Sync persists that value as a real amount with a fresh sync timestamp.

**Fix:** represent unknown balances explicitly and label account-list-only freshness; fetch and validate balances before using them in any readiness/cashflow calculation.

**Why:** zero and unknown have very different financial meanings; a successful sync must not imply a verified zero balance. This is source-level correctness risk; downstream monetary harm was not demonstrated.

### R29 — Medium — Model-image CI uses the wrong digest pair

**Evidence:** `.github/workflows/images.yml:84`; `infra/local-judge/Dockerfile:13`, `:47`.

CI overrides the baked model to `qwen2.5:0.5b`, but leaves the default manifest digest for `qwen2.5:7b`. The Dockerfile validates the selected model manifest against that expected digest, so the intended smaller-model build cannot validate its artifact correctly.

**Fix:** supply a verified matching model/digest pair in CI or use the same pinned model as the image definition; retain the checksum check.

**Why:** an invalid smoke-build configuration breaks deployment assurance or encourages disabling the integrity control. No image build was run in this review.

### R30 — Medium — Security and image failures are not release gates

**Evidence:** `.github/workflows/require-ci.yml:45`; `.github/workflows/security.yml:58`, `:72`; `.github/workflows/images.yml:9`.

The reusable deploy guard looks only for a successful `ci.yml` run on the target SHA. It does not require Security or Images results. CodeQL findings are kept as an artifact without an explicit findings threshold. Image PR filters omit the root lockfile and shared-package manifests despite their effect on the API image. Repository protections may add controls, but they were not verified.

**Fix:** require applicable security/image checks on the exact release revision, include dependency inputs in image-change detection, and make high-confidence static-analysis findings actionable and owned.

**Why:** a build can be deployable through the workflow while dependency, secret, image or code-analysis assurance is failed or absent.

### R31 — Medium — Supply-chain and deployment trust need tightening

**Evidence:** mutable `node:22-alpine` bases and production build tools in `apps/api/Dockerfile:5`, `:29`, `:38`; action tags and service-account JSON at `.github/workflows/deploy-api.yml:66`, `:74`; tag-based deployment build at `:93`.

Unlike the model-service bases, the API base is not digest pinned. Actions use mutable version tags, deploy authentication uses long-lived service-account key material, and the workflow does not explicitly require image signature verification or a container OS vulnerability gate. Build tooling remains in the runtime image. Actual registry immutability and cloud IAM controls were not supplied; this is not evidence that deployed images were tampered with.

**Fix:** adopt reviewed immutable action/base references with updates, short-lived workload identity, digest-based release identity, verifiable provenance/SBOM and vulnerability policy; reduce runtime packages and verify least-privilege runtime identity/network/filesystem controls.

**Why:** dependency locks alone do not protect the base OS, build identities or final deployed artifact. Mapping: Web A03/A08.

### R32 — Medium — Operational compliance cannot be established from code

**Evidence:** `docs/data-retention.md:65` explicitly excludes breach/transfer evidence; placeholder privacy contacts at `apps/web/src/app/privacy/page.tsx:4`; workflow environment expectation at `.github/workflows/deploy-api.yml:54`.

No exercised breach-notification decision record, rights-response operation, processor contract pack, production restoration evidence, verified environment reviewers or current IAM/access review was supplied. UK and Slovenian surfaces and US deployment defaults require an actual residency/transfer assessment; country domains alone do not prove data separation. Runtime accessibility, responsive behavior and native-store disclosure accuracy remain untested.

**Fix:** assign owners for incident detection/triage, regulator and affected-person notification, rights requests and complaints; maintain a processing/processor/transfer inventory and lawful safeguards; exercise recovery and provider-outage scenarios; independently validate production access controls and representative keyboard/screen-reader/mobile journeys.

**Why:** reportable breaches require timely assessment and notification, normally within 72 hours of awareness, and all breaches need records. Technical endpoints do not prove an organization can meet those obligations. [ICO breach guidance](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide/?q=processor).

### R33 — Medium — Audit durability and immutability are not assured

**Evidence:** `apps/api/src/audit/audit-log.ts:125`, `:135`, `:156`; account operations at `apps/api/src/routes/account.ts:95`, `:146`.

Audit inserts and index creation may fail without affecting sensitive operations. Even the retry helper ultimately logs and returns. “Append-only” is a code convention on an ordinary collection, with no storage/IAM tamper-protection evidence supplied.

**Fix:** durably couple critical operations to audit intent, reconcile failures, alert on lost evidence, and enforce independently controlled append-only retention/access where required. Minimize PII and justify retention per class.

**Why:** approvals, deletion and financial investigations need reliable records; unavailable or alterable evidence weakens security and compliance claims. Mapping: Web A09/A10.

### R34 — Medium — Cloud Run wildcard is too broad a trust boundary

**Evidence:** `apps/web/firebase.json:41`; `apps/mobile/capacitor.config.ts:29`.

The browser CSP allows connections to any `*.run.app` origin, and native navigation allows that wildcard inside the application shell. This trusts unrelated Cloud Run tenants. It does not prove XSS or native-bridge exploitation, but widens destinations available after another defect.

**Fix:** enumerate only observed required API/model origins; keep unrelated navigation outside the privileged WebView; verify regional/OAuth flows before removing temporary allowances.

**Why:** narrower destinations reduce credential/data exfiltration opportunities and native navigation exposure. Mapping: Web A02; API8.

### R35 — Low — Documentation no longer describes the implementation

**Evidence:** `SECURITY.md:81` versus `apps/api/src/erasure.ts:86`; `CLAUDE.md:96` and `definitions/ai-processors.yaml:19` versus `apps/api/src/ai/task-gateway.ts:80`; `README.md:69`; legacy Compose at `apps/api/docker-compose.yml:13` versus loopback bindings at `compose.local.yml:12`.

Security guidance still describes already-added AI erasure work and permissive non-dev AI defaults. README deployment status and comments across family/auth paths also lag the implementation. Two local infrastructure instructions offer materially different exposure: the legacy Compose publishes unauthenticated MongoDB/Redis on all interfaces and uses a placeholder JWT secret; the newer local Compose binds loopback.

**Fix:** reconcile security/deployment/launch docs against tested configuration; make the supported local launcher unambiguous and retire or harden the legacy stack. Track operational evidence separately from source implementation.

**Why:** stale instructions can cause unsafe setup, false public claims and repeated work on gaps that are already fixed.

### R36 — High — Trackers load without consent and contradict the privacy notice

**Evidence:** `apps/web/src/components/GoogleAnalytics.tsx:16`, `apps/web/src/components/AdPixels.tsx:13`, both rendered unconditionally from `apps/web/src/app/layout.tsx:178-179`; privacy notice at `apps/web/src/app/privacy/page.tsx:150`.

GA4, Google Ads, Meta Pixel and LinkedIn Insight are gated only by build-time environment variables. When an ID is set, the tag loads on every page, including signed-in household pages, before any consent choice. There is no consent banner or consent-mode default. The privacy notice says LifeKeel uses local storage "not third-party tracking cookies", which becomes false as soon as an ID is configured. Page URLs sent to these vendors can include credential-bearing paths such as `/reset-password/confirm?token=…` (built at `apps/api/src/routes/auth-users.ts:863`) and invite links. Exposure is conditional on the IDs being set; no deployed build was inspected.

**Fix:** load non-essential tags only after an explicit opt-in choice that is as easy to refuse as to accept, and keep that choice withdrawable. Restrict tags to public marketing pages and exclude authenticated, recovery and invite routes. Strip query strings and tokens from reported URLs. Update the privacy notice to list each vendor, purpose and retention, and cover the native app separately.

**Why:** PECR regulation 6 requires prior consent for non-essential cookies and similar storage, and the ICO actively enforces it. On a family-finance product, the visited pages themselves reveal sensitive context to advertising networks. [ICO cookies guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/).

### R37 — High — Connector OAuth state is not bound to the initiating user

**Evidence:** state signed at `apps/api/src/routes/connector-credentials.ts:517-522`; verified at `:75-104`; callback at `:590-620` trusts `tenantId` from the state alone.

The signed state proves that LifeKeel issued it, not that the browser completing the callback belongs to the person who started the flow. It contains no nonce tied to a cookie or server-side record, and it is reusable until expiry. An attacker can start a Gmail or Drive connection in their own household, keep the provider authorization URL, and get a victim to open it. If the victim consents, the victim's mailbox or drive tokens are stored in the attacker's tenant, and later scans give the attacker that data. `exp` is also optional at verification (`:98`), although the signer always sets it.

**Fix:** at `/oauth/start`, create a single-use nonce bound to the user and tenant, stored server-side or in an HttpOnly, SameSite cookie, and require it at the callback. Consume the nonce on first use, require `exp`, and require that the callback's session (where present) matches the state's user. The native return target needs an equivalent binding, such as PKCE verifier possession on the device. Show the connected account address to the household after linking.

**Why:** this is the classic OAuth CSRF/account-linking pattern from RFC 6749 §10.12 and RFC 9700. It can expose a person's entire inbox to someone else's household. Mapping: Web A01/A07; API2.

### R38 — High — Gmail scopes exceed the stated read-only purpose

**Evidence:** `apps/api/src/routes/connector-credentials.ts:546` requests `gmail.send`, `gmail.readonly` and `https://mail.google.com/` for the family-allowlisted `gmail` connector (`:46`). Drive requests `drive.readonly` (`:549`). OneDrive requests `Files.Read.All` (`:550`).

The comment explains that the full-mail scope supports IMAP and the send scope supports the former Studio product. For LifeKeel's read-only signal detection, `https://mail.google.com/` grants read, send and permanent deletion of the whole mailbox. A leaked refresh token therefore becomes full mailbox control. `gmail.readonly`, `https://mail.google.com/` and `drive.readonly` are Google restricted scopes. Production use requires Google OAuth verification, an annual third-party security assessment (CASA) and compliance with the Limited Use requirements. No plan, assessor or Limited Use disclosure was found in the web app. `Files.Read.All` also covers files shared with the user, not only their own.

**Fix:** split the family connector from the legacy Studio connector, request the narrowest scope (`gmail.readonly` through the REST API, rather than IMAP with full-mail scope), and remove send, delete and YouTube scopes from family flows. Budget and schedule Google verification and CASA before public launch. Publish the Limited Use disclosure, and keep Gmail-derived data out of cross-tenant scorers (already noted in `CLAUDE.md`). Encrypt stored refresh tokens with tenant envelopes, and revoke them on disconnect and account deletion.

**Why:** minimum-necessary scope is both a UK GDPR data-minimisation duty and a Google platform requirement. Without verification, Google limits the app to 100 test users. [Google restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Google API Limited Use](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).

### R39 — Medium — Recovery and verification tokens are stored in plaintext

**Evidence:** `apps/api/src/routes/auth-users.ts:842-850` (reset), `:354` and `:677` (verification), lookups at `:634` and `:888`; expiry is skipped when absent at `:892` and `:638`.

Reset and verification tokens are stored and compared as raw values. Anyone with database read access, such as through a leaked unencrypted backup (R20), a log of the query or an operator account, can complete any pending reset. Tokens travel in URL query strings, so they also reach browser history, Referer headers and analytics (R22, R36). This is separate from R01: fixing input types does not fix storage.

**Fix:** store only a SHA-256 hash of each token, look up by hash, make expiry mandatory and consume the token atomically in the same update. Prefer carrying the token in a URL fragment or a POST body, and set `Referrer-Policy: no-referrer` on recovery pages.

**Why:** a recovery token is equivalent to a password while it is valid and should get the same at-rest protection. Mapping: Web A04/A07; API2.

### R40 — Medium — MFA verification lacks attempt limits and replay protection

**Evidence:** `/auth/mfa/verify` at `apps/api/src/routes/auth-users.ts:1009` has no route-level `rateLimit`, unlike signup and login (`:234`, `:441`). `apps/api/src/auth/totp.ts:58` accepts any code in a ±1-step window without recording the last used step. The secret is stored as a plain field at `:970`.

After a correct password, the second step falls back to the global per-IP, per-instance limiter (R24). There is no counter per pending MFA token or per user. Distributed guessing against a 6-digit code with three valid windows becomes feasible over the pending token's lifetime. A code observed once (shoulder-surfing, phishing proxy) can be replayed within about 90 seconds. Unlike salted password hashes, TOTP secrets are usable as soon as they are read from the database.

**Fix:** limit attempts per pending MFA token and per user (for example, 5 attempts, then require a new password login), record the last accepted time step and reject reuse, alert the account holder after repeated failures, and encrypt `mfa_secret` with the tenant envelope key.

**Why:** the second factor only adds protection if it cannot be brute-forced or replayed. Mapping: Web A07; API2/API4.

### R41 — Medium — One signing secret for every purpose, with hardcoded fallbacks

**Evidence:** `JWT_SECRET` signs session JWTs (`apps/api/src/server.ts:245`), connector OAuth state (`apps/api/src/routes/connector-credentials.ts:70`), social-login state (`apps/api/src/routes/auth-social.ts:29`), unsubscribe links (`apps/api/src/marketing/lifecycle-emails.ts:104`, `apps/api/src/routes/heartbeat-unsubscribe.ts:27`) and, by default, delivery links (`apps/api/src/delivery/delivery-router.ts:128`). The fallbacks `'change-me-in-production'` and `'dev-secret'` are public in the repository. The strong-secret check at `server.ts:242` runs only when `NODE_ENV === 'production'`.

A staging, preview or misconfigured instance with a different `NODE_ENV` boots with a known secret, so anyone can forge sessions for it. Even with a strong secret, compromising one use (such as an unsubscribe HMAC oracle) affects all uses, and rotating the session key breaks every outstanding link.

**Fix:** derive a separate key per purpose (HKDF with a purpose label) or configure separate secrets. Fail closed in every non-dev, non-test mode based on `deploymentConfig.mode`, not `NODE_ENV`. Remove literal fallbacks. Add key IDs so keys can be rotated without invalidating everything.

**Why:** key separation limits blast radius, and hardcoded fallbacks turn a configuration mistake into a full authentication bypass. Mapping: Web A02/A04.

### R42 — Low — Account enumeration and targeted lockout

**Evidence:** signup returns `409 Email already registered` (`apps/api/src/routes/auth-users.ts:274`, accepted as a UX trade-off under KEEL-025); resend verification returns `404 User not found` and `Email already verified` (`:666-668`); login returns a lockout message with remaining minutes for existing accounts (`:482-483`); lockout is per account only (`:502-514`).

Password reset correctly hides whether an account exists, but these other routes reveal it, which supports targeted phishing against known LifeKeel households. Because lockout is per account and not tied to IP or device, anyone who knows an email address can keep that account locked out.

**Fix:** return generic responses on resend verification and login. If the signup 409 stays, rate-limit it and document the accepted risk. Combine lockout with IP or device signals, or use progressive delays and a CAPTCHA instead of a hard lockout. Notify the owner of repeated failures.

**Why:** knowing someone uses a family-finance product is itself sensitive, and lockout should not become a denial-of-service tool. Mapping: Web A07; API6.

### R43 — Low — User-chosen names appear verbatim in third-party emails

**Evidence:** family and organizer names are escaped (correctly) but otherwise sent unchanged in invitation and continuity-contact emails (`apps/api/src/auth-email.ts:139`, `:228`), using the shared layout (`apps/api/src/email/layout.ts`).

An organizer can set a family or display name such as "Your account is suspended — call 0800…", and LifeKeel will send it from its own domain to any address the organizer enters. HTML injection is prevented; content spoofing and phishing via a trusted sender are not.

**Fix:** limit length and character set for names used in outbound mail, reject URLs, phone numbers and email addresses in them, rate-limit invitations per household, and keep sender identity and the organizer's verified email visible in the message.

**Why:** abuse of a transactional sender domain harms recipients and the domain's reputation. Mapping: Web A06; API6.

### R44 — High — Any member could delete the household

**Evidence:** `POST /account/delete` (`apps/api/src/routes/account.ts`) checked only that the confirmation matched the caller's own email, then erased every collection for the tenant.

A viewer who joined through an invite could therefore erase every other member's data, documents and vault. Found while fixing R05 and R09.

**Fix (done):** deletion requires a household editor (`isHouseholdEditor`). A viewer gets a 403 that tells them to ask the organizer to remove them, and removal ends their access (R03).

## Remediation status

Status on branch `fix/security-compliance-review`. **Fixed** means the defect is closed in code and covered by a test that fails without the fix. **Partly** means the code-side work is done and a named residual remains. **Governance** means code can't close it; a working draft for the decision-makers was added. A code change does not close a contract, regulatory or production-control finding.

| ID | Status | What changed | Tests | Residual |
|---|---|---|---|---|
| R01 | Fixed | Recovery and verification inputs must be bounded strings; lookup by token hash with a mandatory expiry, consumed atomically | `routes/__tests__/account-recovery.test.ts`, `email-verification.test.ts` | |
| R02 | Fixed | MFA setup needs the password; replacing a factor also needs a current code; replacement ends other sessions | `mfa.test.ts` | |
| R03 | Fixed | Removal marks the login `removed`, revokes sessions and deletes invites; auth hook rejects missing and removed users; a new invite restores access | `household-access.test.ts` | |
| R04 | Fixed | `isHouseholdEditor` guards profile save, evaluate and review, and policy/profile apply from documents and inbox | `family-financial-profile.test.ts` | Other `/family/*` writes keep their current rules; the central RBAC map is unchanged |
| R05 | Fixed | Allowlisted user fields; household export for editors only; viewers export their own record | `household-access.test.ts` | |
| R06 | Fixed | Reset, password change and MFA replacement set `sessions_revoked_at`; logout revokes the presented token | `account-recovery.test.ts`, `mfa.test.ts` | |
| R07 | Fixed | IMAP ports 993/143 only with TLS; host resolved once, every address must be public, socket pinned to that IP; timeouts | `imap-client.test.ts`, `security-helpers.test.ts` | Infrastructure egress rules are still worth adding |
| R08 | Fixed | One minor check (role or DOB under 18) for vault, invite issue, invite acceptance and editor rights | `family-join.test.ts` | Age assurance at signup and lead capture |
| R09 | Fixed | Deletion cancels the Stripe subscription, retried nightly until done; webhooks never write to `deleting`/`deleted` tenants | `household-access.test.ts`, `billing-webhook-idempotency.test.ts` | |
| R10 | Fixed | Webhook claims are leases; failed or abandoned events are reclaimed; credit grants are idempotent per event | `billing-webhook-idempotency.test.ts` | |
| R11 | Partly | Notice rewritten to match behaviour (sign-ins, deletion, AI, cookies, transfers, complaints, Google Limited Use); controller, contact and date come from deployment variables | | Legal review; set `NEXT_PUBLIC_LEGAL_ENTITY`, `NEXT_PUBLIC_PRIVACY_CONTACT`, `NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE` |
| R12 | Governance | Draft DPIA with inventory, proposed bases and sign-off table | `docs/compliance/dpia.md` | All decisions |
| R13 | Partly | Health terms removed from free text before it reaches the assistant prompt | `security-helpers.test.ts` | Art. 9 decision; document and email extraction paths |
| R14 | Partly | Outside dev, an enforcement downgrade or hosted fallback needs `AI_POLICY_EXCEPTION` and is logged | `ai-task-gateway.test.ts` | No processor terms reviewed yet |
| R15 | Fixed | Restore gathers deleting and deleted tenants plus an erasure journal file, holds maintenance mode, re-marks and replays before reopening; backup writes the journal | `architecture-claims.test.ts`, `scripts/ops/restore-drill.ts` | Where journals are stored is operational |
| R16 | Governance | Payment data flow and proposed SAQ A note | `docs/compliance/pci-scope.md` | Acquirer/QSA confirmation |
| R17 | Governance | Questions for a written perimeter assessment | `docs/compliance/fca-perimeter.md` | The assessment |
| R18 | Fixed | Export covers the erasure catalogue (minus secrets and model weights), streamed, capped per collection with a truncation list | `household-access.test.ts` | |
| R19 | Fixed | Erasure removes leads and sign-in history matching the account's ids and emails | `deletion.test.ts`, `account.test.ts` | |
| R20 | Fixed | `backup.sh` encrypts with `age`, restricts permissions, never writes plaintext; `restore.sh` never echoes the URI | | Store the age identity apart from archives |
| R21 | Partly | No script-readable token is kept where the HttpOnly cookie works; a stored copy from older builds is removed | `auth-context.test.tsx` | Cookie-blocked browsers keep the fallback until the API is same-site (`NEXT_PUBLIC_SAME_ORIGIN_API`); native shell keeps its token |
| R22 | Fixed | Request logs drop query strings and token-like path segments; alerts use route templates and scrubbed messages; browser Sentry strips URLs; emailed tokens moved to the URL fragment | `security-helpers.test.ts`, `link-token.test.ts` | |
| R23 | Partly | Platform sweep (leads, lifecycle ledger, growth events, webhook ids, billing of deleted households) and a retention matrix with reasons | `docs/data-retention.md` | Inactive-household window, AI evaluation captures, queues |
| R24 | Fixed | Global limiter runs after auth (per tenant), shared through Redis when configured, trusted proxy hops pinned | | Confirm `TRUST_PROXY_HOPS` against the deployed proxy chain |
| R25 | Fixed | Per-household storage, daily and concurrency budgets; sizes checked before IMAP/Gmail bodies are fetched; scan required before parsing outside dev; email attachments signature-checked and scanned | `documents-upload-cleanup.test.ts`, `gmail-api.test.ts`, `security-helpers.test.ts` | OCR still runs in-process; a scanner must be deployed or extraction stays off |
| R26 | Fixed | List limit clamped to 1–100 | `documents-upload-cleanup.test.ts` | |
| R27 | Fixed | First save is an insert, later saves need the current version; the unique index is awaited at boot | `family-financial-profile.test.ts` | |
| R28 | Fixed | Unknown balances are `null` with `balance_known: false`; `balance_synced_at` only when fetched | | |
| R29 | Fixed | CI passes the 0.5b model's own manifest digest (verified against the registry the same way as the 7b pin) | | |
| R30 | Fixed | Release gate runs a production dependency audit on the exact SHA; CodeQL fails on high/critical; image builds trigger on lockfile and package manifests | | Branch protection and environment reviewers unverified |
| R31 | Partly | Digest-pinned Node base, build tools out of the runtime image, every action pinned to a commit SHA, provenance and SBOM, Trivy gate, deploy by digest, workload identity when configured | | Configure `GCP_WORKLOAD_IDENTITY_PROVIDER` and delete the JSON keys; images were not built locally |
| R32 | Governance | Breach-response and rights-request runbooks | `docs/runbooks/` | Names, contacts, a tabletop exercise |
| R33 | Partly | A lost audit record pages ops; account deletion and export stop if their audit record can't be written | | Insight approval audit still runs after the effect; append-only storage needs infrastructure |
| R34 | Fixed | `*.run.app` removed from CSP and native navigation; deploy pins the one API origin | | |
| R35 | Fixed | CLAUDE.md, SECURITY.md, README, processor registry comment updated; legacy Compose bound to loopback with no fixed secret | | |
| R36 | Fixed | Tags load only after opt-in, only on public pages, never for signed-in visitors; GA strips query strings; Meta ignores in-app navigation; notice and cookie settings | `consent.test.ts` | The app CSP still blocks third-party scripts; landing-site CSP must allow them if tags are enabled there |
| R37 | Fixed | Callback parks the grant encrypted for 10 minutes; only the signed-in initiator can claim it, once | `connector-oauth-binding.test.ts` | Frontends outside this repo (Studio) must call `/oauth/complete` |
| R38 | Partly | Gmail grant is `gmail.readonly` only and mail is read through the REST API; OneDrive `Files.Read` only | `connector-oauth-binding.test.ts`, `gmail-api.test.ts` | Google restricted-scope verification and CASA |
| R39 | Fixed | Reset (self-service and operator-initiated), verification and invite tokens stored as SHA-256; tokens travel in the URL fragment | `account-recovery.test.ts`, `family-join.test.ts`, `operator.test.ts` | |
| R40 | Fixed | Per-user second-step lockout, used-step replay protection, route limit, encrypted secrets (re-encrypted on first use) | `mfa.test.ts` | |
| R41 | Fixed | One signing-key module; per-purpose derived keys; fails closed outside dev/test; `/auth/token` and demo tokens limited to dev/test; platform zero-key fallback limited to dev/test | `security-helpers.test.ts` | |
| R42 | Fixed | Sign-in throttled per email+IP (5) and per email (50) with one generic message; suspension only revealed after a correct password; resend verification answers the same for every address | `login-events.test.ts`, `email-verification.test.ts` | Signup still returns 409 for a registered email (KEEL-025, rate-limited) |
| R43 | Fixed | Names can't contain links, emails, phone numbers or control characters; 20 invitations per household per day | `security-helpers.test.ts`, `household-access.test.ts` | |
| R44 | Fixed | Deletion requires a household editor | `household-access.test.ts` | |

Not run in this pass: container image builds, the GitHub workflows themselves, a deployed environment, or a penetration test.

## OWASP Web Top 10:2025 coverage

The following mapping uses the current [OWASP Web Top 10:2025](https://top10.owasp.org/2025/). It is a coverage map, not a certification or a claim that every vulnerability within a category was tested.

| Category | Review result and fix references |
|---|---|
| A01 Broken Access Control | Confirmed household/member/export boundary defects: R03–R05, R07–R08; connector account-linking via unbound OAuth state: R37. Tenant-scoped collection wrappers are a useful existing control, but do not enforce within-household permissions. |
| A02 Security Misconfiguration | Rate/proxy/store configuration, broad origin policy and legacy local stack: R24, R34–R35; shared signing secret with public fallbacks: R41. Helmet/CORS/cookie controls exist; deployed headers were not probed. |
| A03 Software Supply Chain Failures | Audit blocked; release, image, action and identity assurance work: R29–R31. Model image digests and secret scanning already exist. |
| A04 Cryptographic Failures | Exposed MFA secret/export and script-readable credentials: R05, R21; unencrypted backup helper: R20; plaintext recovery tokens and MFA secrets: R39–R40; no key separation: R41. AES-GCM tenant envelopes and browser sealing exist. KMS, rotation and actual database/backup encryption were not verified. |
| A05 Injection | Critical MongoDB filter injection: R01. No SQL engine is used in the inspected primary API data paths. No frontend XSS or remote code execution was established. |
| A06 Insecure Design | MFA replacement, deletion/billing, resource and minor-policy inconsistencies: R02, R08–R09, R25; over-broad provider scopes and spoofable outbound email: R38, R43. Human approval gates exist for higher-impact actions. |
| A07 Authentication Failures | Recovery, MFA replacement, session lifecycle and export secrets: R01–R02, R05–R06, R21; OAuth state, recovery-token storage, MFA brute force/replay, enumeration: R37, R39–R40, R42. Salted password hashing and MFA do exist. |
| A08 Software or Data Integrity Failures | Billing event state/replay, deletion restoration and release identity: R09–R10, R15, R29–R31. Signed webhooks do not make subsequent state transitions correct. |
| A09 Security Logging and Alerting Failures | Secret-bearing URL telemetry and best-effort audit records: R22, R33. Alert delivery and incident response were not exercised. |
| A10 Mishandling of Exceptional Conditions | Failed-event recovery, malformed bounds, stale-profile updates, silent audit failure: R10, R25–R27, R33. Generic 500 responses already exist but do not resolve these state failures. |

## OWASP API Top 10:2023 coverage

Mapping follows the [OWASP API Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/).

| Category | Review result and fix references |
|---|---|
| API1 Broken Object Level Authorization | R03, R05, R08. Cross-tenant helpers/tests exist; same-tenant removal and protected-object visibility still need enforcement. No exhaustive cross-tenant route test was run. |
| API2 Broken Authentication | R01–R02, R05–R06, R21, R37, R39–R42. MFA and password hashing do not compensate for recovery/type-validation defects. |
| API3 Broken Object Property Level Authorization | R04–R05. Viewer financial edits and exporting non-allowlisted secret fields are confirmed. |
| API4 Unrestricted Resource Consumption | R18, R24–R26, R40. Upload size limits and some LLM budgets exist; aggregate/shared limits are incomplete. |
| API5 Broken Function Level Authorization | R03–R05, R08. Central URL mapping is incomplete; operator routes have a separate permission model. |
| API6 Unrestricted Access to Sensitive Business Flows | MFA replacement, billing/deletion and rate policies: R02, R09, R24; targeted lockout and invitation abuse: R42–R43. Lead capture has route throttling and explicit consent, but identity/age/retention assurance remains open. |
| API7 Server Side Request Forgery | R07. HTTP wrappers do not cover user-controlled IMAP TCP destinations. |
| API8 Security Misconfiguration | R24, R30–R31, R34–R35. Production IAM/egress and forwarding configuration require live evidence. |
| API9 Improper Inventory Management | R18–R19, R23, R30, R35. Route/permission/data inventories drift, and Swagger describes the former SMB platform (`apps/api/src/server.ts:1500`). Inventory versions, public/internal routes and actual deployed hosts. |
| API10 Unsafe Consumption of APIs | Billing recovery and unknown bank values: R10, R28; external MIME/parser budgets: R25. Validate provider responses with runtime schemas and explicit deadlines; TrueLayer currently casts JSON types (`apps/api/src/open-banking/providers.ts:138`). |

## Compliance disposition

| Scope | Disposition | Required closure evidence |
|---|---|---|
| UK GDPR / PII security | Not ready for assurance claims | Close R01–R08, R15, R18–R25, R33, R37–R41; demonstrate negative authorization, secret-safe telemetry and rights-lifecycle verification. |
| ICO accountability / children's information | Launch evidence incomplete | Reviewed privacy notices, lawful-basis/processing register, DPIA, age/authority safeguards, processor/transfer records, rights and incident operations: R11–R14, R19, R23, R32. ICO is a regulator, not a blanket software certification. |
| PECR (cookies and electronic marketing) | Not ready if any tracker ID is configured | Prior opt-in consent for non-essential tags, accurate cookie disclosure, tags excluded from authenticated and token-bearing pages: R36. Marketing email already carries one-click unsubscribe (`apps/api/src/auth-email.ts:276`); soft opt-in or consent records for lead emails still need confirming. |
| Google API Services User Data Policy | Restricted-scope verification not started | Narrowed scopes, OAuth verification, annual CASA assessment, published Limited Use disclosure and refresh-token revocation on disconnect/deletion: R38. Required before more than 100 users can connect Gmail or Drive. |
| EU GDPR / Slovenian-facing service | Applicability and local obligations need assessment | Confirm controller establishments/markets, supervisory authority, required language/notices/representatives and actual data transfers. UK controls alone are not proof of EU compliance. |
| PCI DSS | Hosted payment scope reduction observed; validation unverified | Acquirer/assessor-confirmed scope and SAQ, provider responsibilities and required recurring evidence: R16. Billing correctness R09–R10 is a separate release concern, not automatically a PCI violation. |
| FCA | Informational boundary intended; perimeter unresolved for live banking | Written assessment and partner model before real aggregation; reviewed personalized outputs and promotions: R17. No unauthorized regulated activity is asserted from source alone. |
| Accessibility / usability / frontend reliability | Static controls observed; runtime conformance unverified | Keyboard, focus, contrast, screen-reader, error/recovery and responsive checks on the actual app. Existing accessibility/browser test files do not establish WCAG conformance without execution and human assessment. |
| Performance / reliability / operations | Confirmed issues plus unverified capacity | R10, R18, R24–R30, R33; representative ingestion/export/concurrency/outage/restore evidence with defined service limits and owners. |
| Maintainability / dependency / licensing | Mixed assurance; current vulnerability audit blocked | Resolve R29–R31, R35; rerun dependency/secret/container scans and review third-party/model licence obligations in `NOTICE` and `ai-bom.yaml`. No new licence violation was established. |

## Existing controls worth preserving

- Tenant-derived query scoping and dedicated cross-tenant tests; separate operator permissions.
- Salted scrypt password hashing, constant-time comparisons, TOTP and hashed recovery codes; MFA-pending tokens rejected as normal sessions.
- HttpOnly session cookies, mutation Origin checks, CORS and security headers; no client session replay by default.
- Stripe raw-body signature verification and event-ID claims; claims need recovery semantics rather than removal.
- Social sign-in links to an existing account by email only when the provider attests the email as verified (`apps/api/src/routes/auth-social.ts:357`); password-reset requests do not reveal whether an account exists.
- Upload MIME allowlist plus magic-byte checks on documents and unsealed vault files; sealed uploads still restrict the declared type, so stored files cannot be served as HTML.
- The shared email layout escapes every structural field, and callers escape user names; marketing email carries RFC 8058 one-click unsubscribe.
- File type signatures, per-file size caps, OCR review/provenance gates, encrypted estate storage and optional browser sealing.
- Non-dev AI processor enforcement and denied hosted fallback by default; bounded task registry and tenant-context processing.
- Broad AI-derived erasure catalogue, deletion receipts/replay and backup-window caveats. Shared scorer warm-start is opt-in by default; current feature-hash evaluation trains per tenant. Earlier documents describing unconditional shared warm-start or pooled training must not be repeated as current defects.
- Model-service digest checks, image smoke workflows, dependency/secret scans, migration readiness and canary/rollback mechanics. These are implementation controls; their hosted success and operating effectiveness were not verified here.

## Closure order and acceptance

1. **Immediate:** fix R01; validate negative recovery/verification inputs without live user data. Close R02–R08 and R37, and confirm revoked/removed identities cannot regain access by password, OAuth, MFA, bearer token or export. Before any tracker ID is set in a deployed build, close R36.
2. **Before accepting real payments/data:** close R09–R17 and R38 for the enabled feature set; verify failed webhook recovery, terminal erasure states, provider cancellation and fresh-target restore reconciliation. Keep live banking and unapproved hosted processing unavailable pending applicable evidence.
3. **Before a production assurance claim:** close the relevant Medium findings; rerun dependency/security checks, exercise representative browser/accessibility/load/outage/restore scenarios, and attach immutable release/configuration evidence with owners and dates.
4. **For each closed item:** retain the patch/decision reference, focused verification result, operational evidence where applicable, reviewer and residual limitation. A code change alone does not close a contract, regulatory-perimeter or production-control finding.

No code examples or exploit payloads are included. This is an engineering review and remediation register; legal applicability, merchant validation and regulatory permissions require the responsible organization and appropriately qualified reviewers.
