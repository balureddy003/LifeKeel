# Proprietary mechanisms: algorithms, models and architecture LifeKeel can own

Research and design date: 20 October 2026.

**Status: design review and candidate architecture refinement.** This document
answers a specific strategic question: *what can LifeKeel own — as named
algorithms, models, and architectural patterns — that competitors cannot copy by
renting a frontier model?* It builds on the market strategy
([market-strategy-and-vision-2026-2029.md](market-strategy-and-vision-2026-2029.md)),
the shipped inventory in [ARCHITECTURE.md](../../ARCHITECTURE.md), and the code as
it exists in `packages/engine/`, `apps/api/src/ai/`, and `detectors/family/`.

It deliberately does **not** propose new LLMs, foundation models, or general
agent frameworks. LifeKeel's defensibility lives in the mechanisms *around*
models: how evidence becomes insight, how permission becomes visibility, and how
approval becomes action.

Each proposal is scored for: **defensibility** (how hard to copy), **fit**
(three rules in CLAUDE.md), and **prior-art risk** (honest assessment, not
patent counsel).

---

## 1. The core insight: own the compounding, not the model

Every competitor — Origin, Trustworthy, ChatGPT Finances, Monarch — rents the
same frontier models. Anything LifeKeel does that is "call an LLM on family
context" replicates in a competitor sprint. What *doesn't* replicate quickly:

1. **Compositions** of ordinary mechanisms into flows that only make sense for
   family continuity (nobody else's unit of analysis is "can another person
   take over").
2. **Accumulating state** — evidence histories, approval records, drill
   outcomes, calibration data — that gets better for *that family* over years
   and cannot be imported from a model.
3. **The enforcement layer** — mechanisms that fail closed by construction
   rather than by convention.

The proposals below are all state-accumulating compositions inside the
existing engine. Most use components that already exist — the engine already has
calibration (Platt/isotonic), conformal escalation, evidence chains, insight
lifecycle, and a feature-hash scorer — but they are currently used for *ranking
and review*, not composed into LifeKeel's stated product.

---

## 2. Candidate proprietary mechanisms

### M1. LifeGraph — the versioned evidence dependency graph

**Mechanism.** Every derived artifact (insight, readiness score, handover
checklist item, dossier field) records its *derivation closure*: the exact
signal values, document extractions, permission versions, and detector rule
versions that produced it. Two operators over the graph:

- `invalidate(change)` — given any change (profile edit, doc superseded, grant
  revoked, detector rule updated), compute the **minimal affected closure** and
  mark exactly those derived artifacts stale, leaving others verified.
- `provenance(artifact)` — answer "why does the family see this and not that"
  down to field level, deterministically.

**What already exists:** signal→insight pipeline with lifecycle and dedup
(`packages/engine/src/engine.ts`), evidence chains per insight, insight
explainer. What's missing: reverse-indexed derivation closure + invalidation as
a first-class operator instead of full-tenant re-evaluation on every sweep.

**Why it's ownable:** the general technique (truth maintenance systems,
incremental computation, build-system memoization) is old. The *family-scoped
composition* — "revoking grandma's access to the policy folder invalidates her
handover readiness but not mine" — is what the market needs and what document
vaults (Trustworthy) and advisors (Origin) do not implement. Truth maintenance
systems are 40 years of prior art; a patent claim would need to be narrow and
claim-level counsel-reviewed. The durable protection is the implementation plus
accumulated correctness.

**Fit:** fully within rules; it *strengthens* rule 2 (insights always cite
what's on file) and makes the disclosure-tier P1 gap implementable.

**Build:** Medium. Extends the engine's lifecycle; requires a derivation-closure
record on every derived artifact, and migration of existing insights to point at
their closure.

---

### M2. The Disclosure Lattice — permission as a flowing type, not a route check

**Mechanism.** Give every piece of family information two static labels —
`disclosure_class` (household, organizer-only, member-scoped, youth-redacted,
deputy-only, executor-locked) — and make the label **flow through computation**:
any derived result carries the *join* (most restrictive) of its inputs' labels.
The assistant, the feed, the dossier, notifications, and exports can only emit
what the viewer's permission set covers, enforced at the computation layer, not
at the HTTP route.

Formally: information-flow control (IFC) / DCLabels-style lattice applied to a
family domain — a well-studied security mechanism with a genuinely novel
application surface, because family permission sets are dynamic (age-out,
membership change, emergency grant) and versioned.

**What already exists:** youth-redacted twin and role-aware views, **per-route**.
The P1 gap register already names this: "trust tiers classify side-effects, not
disclosure."

**Why it's ownable:** the "2D trust model" — action tiers (T0–T3) × disclosure
classes — where autonomy and visibility are independent dimensions of the same
policy object, is a coherent, describable mechanism. Today's incumbents bolt
sharing onto documents; a lattice where *the score itself* is labelled, and an
aggregate insight cannot leak a hidden input, is a different engineering
posture. Prior art: DCLabels, IFC research, MLS databases. Novelty is in the
family-domain instantiation and its binding to the insight lifecycle (a grant
change invalidates derived visibility — composes with M1).

**Fit:** this is the single highest value-per-effort proposal. It converts the
"second rule" (disclosure) from convention to construction — the same way the
task gateway did for AI calls.

**Build:** Medium-Large. Need a label on signals/documents/derived artifacts and
a join-enforcement point in the insight/feed/assistant emitters, plus a
tripwire test (analogous to `ai-task-gateway.test.ts`) that fails if an emitter
bypasses the lattice.

---

### M3. Proof-of-Handover — the rehearsal protocol

**Mechanism.** A bounded protocol with three phases:

1. **Scope** — organiser defines a certificate: *this person, can find these N
   essential items/next-steps, under these permissions, before date X*.
2. **Exercise** — the designated person attempts retrieval *through the product
   only* (no side-channel help); each retrieval attempt is logged as evidence
   events. No external side effects (Tier 0/1 only).
3. **Attestation** — outcome is a signed, time-stamped, scoped **handover
   certificate** (`handover_certificates`): valid only while every evidence
   input remains within its freshness policy — composes with M1 so any
   invalidating change revokes the certificate.

This is "rehearse, don't just store" — the market strategy's core pattern —
made into a measurable engine primitive. Critically, *timer-based inactivity
alone never triggers disclosure* (Bitwarden-style emergency access already
exists; and inactivity is an unreliable incapacity signal). Exercise success
requires active human retrieval, not a timeout.

**What already exists:** emergency mode, member views, vault sharing surfaces.
What's missing: the certificate as an artifact with freshness semantics and the
exercise logging model.

**Why it's ownable:** the composition (scoped capability + exercised retrieval +
evidence-bound expiry) is not present in Trustworthy, Everplans, Cake, or
LifeVault as verified at research date. Patent risk: mitigation/verification
protocols and access attestations have adjacent prior art, but the specific
evidence-freshness-bound certificate for family continuity is a plausible
narrow claim — counsel review warranted *if* the mechanism survives contacts
with real users.

**Fit:** exemplary — no autonomy expansion, no advice; it *is* the second rule's
positive twin ("informative handoff, never steering").

**Build:** Small-Medium as a Tier 0/1 MVP.

---

### M4. Keel Drift Sentinels — life-event detection, for the family

**Mechanism.** Detector adolescence: today detectors fire on declared profile
changes. Sentinels watch *trajectories* of declared/synced state for
statistically significant change — cash-flow buffer decay rate, coverage
erosion in real terms (inflation, not user edits), stagnation flags, milestone
approach (child aging toward 18) — using cheap, explainable stream statistics
(CUSUM-style change-point detection, conformal-calibrated alerting) rather than
an LLM.

The engine already has the statistical substrate: conformal escalation
(`packages/engine/src/__evals__/conformal.eval.test.ts`), calibration, and
adaptive thresholds. Compose them per-family: each sentinel's threshold is
calibrated to *that family's* history so a £60/month drift for one household is
noise and for another is a signal.

**Why it's ownable:** per-family calibrated change-point alerting over a
*protection domain* (not spending categorization — Monarch/Rocket Money own
that) is unclaimed in market research. The reverse-polarity framing (lender
early-warning systems exist to protect the lender; this protects the family) is
a genuine whitespace from the October differentiation review. Patent risk:
CUSUM/conformal are published; the per-tenant calibration composition in this
domain is the narrow claim.

**Fit:** pure Tier 0 detection. Care required: **no inference of health,
pregnancy, or relationship events** — sentinels fire on financial aggregates
only (this must be a hard list in code, not a policy note).

**Build:** Medium. The statistical parts exist in `packages/engine`; the work is
state-history retention policy (retention rules!) and the minimal-label UI.

---

### M5. Earned-Scope Contracts — autonomy as an explicit artifact

**Mechanism.** Make the trust ladder a data structure: an `earned_scope` record
binding (tenant, action class, evidence) → allowed auto-execution scope. Its
grammar:

- **Earn**: N consecutive human approvals of the *identical classified effect*,
  zero overrides, within a recency window → eligible for a narrow `log_only` or
  scheduled-automation scope (Tier 3).
- **Forfeit**: any override, any changed field in the classified effect, any
  trust-relevant event (new member, detector rule change, 90-day dormancy) →
  scope collapses to zero automatically.
- **Display**: the family sees *why* Keel can currently do X alone, and what
  would reset it.

**What already exists:** `log_only` trusted-scope auto-execution and earned
trust display on approve. The contract formalizes it into an auditable state
machine.

**Why it's ownable:** this is the mechanism-level answer to Gartner's "reliability
before autonomy" thesis, implemented as a collapse-on-any-change contract.
Nothing in Origin/ChatGPT/State Farm exposes autonomy as an inspectable,
forfeitable artifact. Prior art exists in adaptive authentication and rule-based
auto-approval; the classified-effect equality check + automatic forfeit
semantics in the family domain is the distinct combination. Strong story, honest
moat, weak-to-moderate patent case.

**Fit:** this *operationalizes* rule 1 — autonomy becomes a revocable
credential, never a model threshold. High alignment.

**Build:** Medium.

---

### M6. Readiness Calculus — an algebra for the score, not a number

**Mechanism.** Make readiness a **typed composition** rather than a weighted
average: each domain contributes a component value with (a) evidence state
(confirmed / declared / stale / unknown) and (b) a join semantics defined per
domain:

- `min` join for continuity-critical chains ("estate ready" = worst of will /
  beneficiaries / executor access — one broken link fails the chain);
- weighted join for substitutable domains (emergency fund + insurance partially
  offset each other);

so the composite *explains itself structurally*: "estate readiness is 40/100
and cannot exceed 50 until beneficiary confirmation is verified" — a **ceiling
semantics** that no scalar score can express.

**What already exists:** composite + member readiness with component inputs and
explainability. The algebra formalizes and exposes the *structure* — including
unknown-as-ceiling (`unknown` caps a component rather than being scored zero,
avoiding the false-precision failure where missing data looks like bad data).

**Why it's ownable:** this is a named, teachable formalism ("readiness joins")
that produces materially different UX from every competitor's single percentage.
Prior art: multi-criteria decision analysis, fuzzy/possibilistic scoring. Patent
likely weak; brand and UX moat real ("a score that tells you its own limits" —
honest abstention applied to measurement).

**Fit:** deterministic; models never touch the math. Directly compatible.

**Build:** Small-Medium, mostly engine + copy + tests.

---

### M7. The Receipt Chain — tamper-evident family action ledger

**Mechanism.** Extend the action receipt model from "records of what happened"
to a **hash-chained, exportable ledger**: each receipt links to its predecessor
(chain head), and the family can verify chain integrity and export it. The
compliance-review register already calls for "immutable export/hash chain" —
this formalizes it as a product feature: *the family's own tamper-evident record
of everything Keel ever did on their behalf*.

**Why it's ownable:** hash chaining is ancient, but as a *consumer-facing trust
artifact* ("show me everything your AI did, and let me prove you didn't edit
history") it is category-defining in consumer fintech. Low patent value; high
trust-marketing value and it completes the audit-hardening gap honestly.

**Fit:** strengthens audit without marketing "regulatory readiness" (per the
October review's warning).

**Build:** Small.

---

## 3. Scoring summary

| # | Mechanism | Defensibility | Fit with 3 rules | Prior-art risk | Effort | Verdict |
|---|---|---|---|---|---|---|
| M1 | LifeGraph (evidence DAG + invalidation) | High | Strong | Medium (TMS) | M | **Build — foundational, required by M2/M3** |
| M2 | Disclosure Lattice (2D trust policy) | High | Strong | Medium (IFC) | M-L | **Build — converts rule 2 to construction** |
| M3 | Proof-of-Handover certificates | High (composition) | Strong | Medium | S-M | **Build — this is the marketable "secret"** |
| M4 | Drift Sentinels (per-family calibrated) | Medium | Strong, w/ hard inference blocklist | Medium | M | **Build after connectors deepen signals** |
| M5 | Earned-Scope Contracts | Medium-High | Strong | Medium | M | **Build — formalize what exists** |
| M6 | Readiness Calculus (join semantics) | Medium (UX/brand) | Strong | Medium | S-M | **Build — cheap, immediately user-visible** |
| M7 | Receipt Chain | Low (but marketing-high) | Strong | High (ancient), fine as feature | S | **Build as trust feature, not moat claim** |

Deliberately **not** pursued: proprietary LLMs, cross-tenant foundation training
(rule 3), federated learning (dormant, gated — keep it dormant), biometric or
health-data twins (special-category debt), predictive "death/incapacity from
data" triggers (unreliable and jurisdictionally hazardous), autonomous product
matching (rule 2).

## 4. What changes in ARCHITECTURE.md if approved

These are the mechanical edits a follow-up PR would make, in dependency order:

1. **§5 Family Twin** — add the derivation-closure record (M1) and the
   `disclosure_class` label to the persistence model and source-of-truth rules.
2. **§7 Understand and Predict** — add Drift Sentinels (M4) as a tenth mechanism
   family with an explicit inference blocklist; add Readiness Calculus (M6)
   join semantics to the readiness section.
3. **§9 Act and Escalate** — extend the trust-tier section to the 2D policy
   (action tier × disclosure class) and add Earned-Scope Contracts (M5) as the
   formalism behind `log_only` trusted scopes; upgrade receipts to the chained
   ledger (M7).
4. **New §2 sub-section** — Proof-of-Handover (M3) as a named product primitive
   in the Observe→Escalate loop.
5. **§16 gap register** — mark "trust tiers classify side-effects, not
   disclosure" as having a chosen mechanism (M2) rather than a direction.

None of this changes the trust-tier rules, the advice boundary, or the AI
gateway design. Every mechanism is deterministic or calibrating — no model
gains authority.

## 5. Recommended build order (small team, one bet at a time)

1. **M1 LifeGraph** — everything else depends on invalidation/provenance.
2. **M6 Readiness Calculus** — cheap, immediately differentiating copy+score UX.
3. **M3 Proof-of-Handover** — the named, marketable primitive the strategy doc
   positions around ("a handover you can prove").
4. **M2 Disclosure Lattice** — the deep moat; adds server-side enforcement.
5. **M5 Earned-Scope** — formalize existing partial behavior.
6. **M4 Drift Sentinels** — gated on live signal depth (connectors).
7. **M7 Receipt Chain** — trust feature, opportunistic.

## 6. Filing guidance (non-legal)

If a prototype of M3 (handover certificate bound to evidence freshness) or M5
(collapse-on-change earned-scope contract) proves out with users, the strongest
invention disclosures are those two plus the M1+M2 composition. Keep the claims
at the mechanism level ("a method for computing the affected closure of derived
permissioned artifacts on permission change") rather than the domain level.
Have counsel run claim-level prior art before any public writeup of the
mechanism details — this review itself should stay in the repo, not become a
blog post, until that decision is made.
