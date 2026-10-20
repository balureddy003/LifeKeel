# Mechanism foundations: the research under LifeKeel's ownable patterns

Research date: 20 October 2026. Companion to
[proprietary-mechanisms-and-future-architecture-2026-10.md](proprietary-mechanisms-and-future-architecture-2026-10.md)
(M1–M7) and
[llm-usage-patterns-low-cost-and-private-2026-10.md](llm-usage-patterns-low-cost-and-private-2026-10.md)
(P1–P8).

**Purpose.** Each proposed mechanism was traced to its scientific lineage and to
deployed systems doing adjacent work. The output of this pass is deliberately
two-edged: it shows each mechanism is *sound* — built on decades of established
theory, not novelty-bait — and it shows exactly which parts are **not** novel,
so design energy and any patent effort aim only at the defensible deltas.

Patent-relevant rule of thumb applied throughout: the general technique is
prior art; the potentially novel contribution is always the **family-domain
composition** — two or more established mechanisms bound together by the
family-continuity problem in a way that produces a new emergent property.

---

## M1. LifeGraph (evidence DAG + minimal invalidation)

**Lineage.** Truth Maintenance Systems: Doyle's 1977/1979 MIT work established
justification-tracking where each belief records what supports it, and
dependency-directed backtracking propagates the consequences of a retracted
premise to exactly the dependent beliefs. Petrie (AAAI-87) added
domain-guided revision; later work unified JTMS/ATMS as abduction. Build
systems and incremental-computation frameworks apply the same operator at
industrial scale: *recompute only the affected closure of a change*.

**Deployed neighbors.** Every incremental build tool (Make → Bazel → Adapton/
Salsa-style demand-driven recomputation) implements `invalidate(change)`.
Database view maintenance does it continuously. **No known consumer product
applies derivation-closure invalidation to household documents, permissions,
and readiness conclusions.**

**The defensible delta.** A *permission- and lifecycle-aware* truth-maintenance
variant: invalidation triggered not only by data change but by **grant change**
and **rule-version change** — Doyle's TMS never had to answer "this belief is
now true but must no longer be *shown* to this person." That join between
derivation and disclosure is the composition claim.

**Design consequence.** Implement as: provenance triples (W3C PROV-aligned,
see M7) on every derived artifact + reverse index on inputs + a versioned
grant/rule component of each derivation. Do NOT adopt general non-monotonic
backtracking — LifeKeel needs monotonic invalidation only (retraction marks
stale; no belief revision), which is dramatically simpler than Doyle's DDB.

## M2. Disclosure Lattice (labels that flow through computation)

**Lineage.** Decentralized Information Flow Control: Myers–Liskov's
Decentralized Label Model (Jif) established labels-as-lattice with a
can-flow-to relation `⊑`. Stefan, Russo, Mazières et al.'s **DCLabels** (2011)
distilled it to conjunctions-of-disjunctions labels with a sound,
decentralized privilege model for declassification — the cleanest formal basis
for LifeKeel's needs. MLS databases and capability systems are the operational
ancestors.

**Deployed neighbors.** IFC exists in OS research (HiStar, Flume), browser
sandboxes, and language-level systems (Jif, LIO). **No consumer family product
applies flow-through labels to derived artifacts** — vaults ACL documents at
rest; assistants filter at the route. The gap ARCHITECTURE.md names ("tiers
classify side-effects, not disclosure") is precisely the IFC gap: labels on
data, join-through-computation, declassification as an audited, privileged
operation.

**The defensible delta.** Two specific compositions:

1. Labels on **derived** family artifacts with time/version dimension — a
   grant revocation or member lifecycle change (youth→adult) triggers
   DCLabel-privileged declassification *and* M1 invalidation together. IFC
   literature treats policies as mostly static; LifeKeel's family graph is a
   dynamic principal set where the lattice itself evolves (a member turning 18
   changes their position). "Dynamic-principal DIFC for kinship structures" is
   the claim shape.
2. The 2D policy product — disclosure class × action tier — where both are
   enforced through the same policy resolution, so "what Keel may do" and "who
   may see it" can't drift apart.

**Design consequence.** Implement as a TypeScript-level dynamic IFC layer:
every derived artifact constructor must call `label.join(inputs)`; a tripwire
test asserts no emitter (feed, assistant, export, notification) bypasses it —
exactly the `ai-task-gateway.test.ts` pattern. Declassification = an explicit
`declassify(label, privilege, justification)` that writes an audit row.

## M3. Proof-of-Handover (rehearsal certificates)

**Lineage.** Business-continuity discipline: recovery plans are validated by
*exercise*, not storage — tabletop/simulation exercises in ISO 22301-style
practice. Digital security: Bitwarden/1Password emergency access (wait-time
trusted-contact release), Google Inactive Account Manager. Capability
attestation: UCAN's invocation proofs demonstrate authorized action occurred.

**Deployed neighbors.** Estate tools (Everplans, Cake, Empathy LifeVault,
Trustworthy) provide sharing + checklists; password managers provide
time-delayed emergency access. **Nobody verifies that the designated person can
actually perform the retrieval** — every incumbent measures *access granted*,
not *task demonstrated under realistic conditions*. And critically, every
incumbent's emergency trigger is **inactivity or request + timer**, which is an
unreliable incapacity signal LifeKeel already correctly rejects.

**The defensible delta.** The certificate is **evidence-freshness-bound**: it
is not a one-time pass but a live claim that is revoked when M1's
invalidation fires on any input to the exercised path. "An attestation whose
validity is continuously recomputed against the provenance closure of what was
demonstrated" — no neighbor couples rehearsal outcomes to a TMS. That coupling
(M1+M3) is the narrow claim shape.

**Design consequence.** Store exercise events as first-class evidence
(subject, capability exercised, evidence set hash, outcome); certificate =
signed artifact whose `valid` field is a *computed* function of LifeGraph
staleness, not a stored boolean. Note the deliberate hard rule: certificates
are earned by active demonstrated retrieval, never by elapsed time.

## M4. Drift Sentinels (per-family calibrated change detection)

**Lineage.** Sequential analysis: Page's CUSUM (1954) for change-point
detection; ICSS and KW-ICSS variants handle non-normal financial series
(published accuracy ~81% TPR, fast detection on small post-change windows —
exactly LifeKeel's sparse-data regime). Panel-data extensions (double CUSUM)
cover multi-member households. On alerting calibration: conformal prediction
gives finite-sample marginal coverage guarantees; online conformal (Gibbs &
Candès 2024) holds under arbitrary distribution shift — the honest answer to
"families change regime."

**Deployed neighbors.** Curry et al. (KDD 2007) applied change detection to
payment-card populations — **for issuer risk**. Lender early-warning systems
protect lenders. Fintech apps show spending anomalies as *observations*.
**Nobody runs protection-domain change detection for the family's benefit with
a statistical guarantee attached** (e.g., "this alert tier false-alarms at
most ε of the time, measured against your household's own history").

**The defensible delta.** Mondrian/group-conditional conformal alerting keyed
by tenant — per-family error budgets rather than population thresholds — plus
the domain restriction (protection/runway/coverage variables, with a hard
inference blocklist for sensitive attributes). The claim shape: "calibrated
sequential change detection whose threshold is fit to a single household's
history and constrained to declared protection variables."

**Design consequence.** Implementation already has the substrate (conformal
eval harness, calibration module). Requirements: a per-tenant state-history
retention policy (this is a privacy decision, not just stats — how many months
of cash-flow history does a sentinel need, and is that retention disclosed?),
and a false-alarm budget surfaced to the family as a dial, not hidden.

## M5. Earned-Scope Contracts (autonomy as collapsible credential)

**Lineage.** Human-factors: Parasuraman's levels of automation taxonomy;
the adaptive-automation literature (adjusting LOA from measured performance);
the trust-calibration literature — which shows *people* mis-calibrate trust and
need cues. Capability security: scoped, delegable, revocable authorization —
UCAN's model (attenuated delegation chains, expiry-preferred-over-revocation,
append-only revocation sets) is the closest production-grade vocabulary.

**Deployed neighbors.** Adaptive authentication (risk-scoped step-up), RBAC
with usage conditions, Gmail-style delegated access. **Nobody exposes autonomy
as an inspectable, evidence-backed, auto-collapsing artifact to the human it
serves.** Gartner's 2026 thesis ("reliability earns autonomy") describes the
desideratum; the mechanism is the contribution.

**The defensible delta.** Two moves not in either lineage:

1. **Classified-effect equality** — the scope grows only on identical
   *classified effect* (same action type, channel class, recipient class,
   bounded parameters), not "similar" approvals. Trust becomes a property of a
   deterministic equivalence relation, not a model's judgment of sameness.
2. **Forfeit-by-construction** — any override, parameter drift, roster change,
   detector-rule version change, or dormancy collapses scope to zero
   automatically, driven by M1's invalidation signals. In trust-calibration
   research, trust decays slowly; here the credential *destructs* — matching
   UCAN's "prefer expiry to revocation" philosophy but with evidence triggers.

**Design consequence.** `earned_scope` rows carry: scope triple, evidence
window, forfeit triggers (as LifeGraph subscriptions), and a human-readable
explanation string — the "trust calibration cue" the HF literature says users
need.

## M6. Readiness Calculus (compositional score with join semantics)

**Lineage.** Multi-criteria decision analysis (weighted sum, OWA operators);
fuzzy/possibilistic reasoning for unknown-vs-bad; worst-link semantics from
reliability engineering (series-system reliability: the chain fails at its
weakest component — exactly the "min join" proposed).

**Deployed neighbors.** Every competitor ships a scalar: Origin's Financial
Health Score, My-legacy.ai's LegacyScore, credit scores everywhere. The
research move is **unknown-as-ceiling**: unknown inputs cap a component rather
than scoring zero — possibilistic logic's epistemic distinction ("we don't
know" vs "we know it's bad") applied to a consumer-readiness score.

**The defensible delta.** Modest. The per-domain join semantics (min for
continuity chains, weighted for substitutable domains, ceiling for unknowns)
is a named, teachable formalism and great UX ("your estate score cannot exceed
50 until the executor is confirmed") — but it's a rules-of-composition design,
unlikely to survive obviousness review on its own. Treat as brand/UX moat, not
IP.

## M7. Receipt Chain (tamper-evident family action ledger)

**Lineage.** Hash-chained logs (ancient: linked timestamping, Haber–Stornetta
1990), transparency logs (Certificate Transparency), W3C PROV-DM for
provenance records.

**Critical find — near prior art.** A 2024-era TDCommons defensive publication
("Data Provenance Verification for Multi-Stage Processing Pipelines — Chained
Integrity Binding") discloses exactly this pattern: verifiable commitments
chained across pipeline stages **including context → evidence → evaluation →
authorization → execution**, tamper-evident, selectively verifiable. Because
it's a defensive publication, it exists precisely to prevent patenting this
composition. **Conclusion: M7 is not patentable; ship it as a trust feature
only.** The same publication likely also forecloses patent claims on
hash-chaining the ActionExecutor receipt path specifically — the receipts
themselves remain valuable, just not protectable.

**Design consequence.** Use PROV-DM-flavored entity/activity/agent records
plus a hash chain; expose a verify-and-export affordance to families. Zero
novelty risk to ship; zero novelty claim to file.

---

## LLM-usage patterns (P1–P8) — lineage check

| Pattern | Lineage / prior art | Assessment |
|---|---|---|
| P1 LLM-as-Compiler | Active niche: Rice-Factor (LLM emits JSON plans, deterministic artifacts, locked test plans), Prompt-Literate Workflow (candidate-artifact + TRACE acceptance), LintCFG (DSL-driven LLM compilation of linter rules), Helix DSL (agents emit spec, deterministic compiler produces design) | Established pattern in dev tooling; **novel application surface** is regulated-family domain artifacts (detector YAML through golden evals + advice-rule tripwire). Ship it; don't claim it broadly |
| P2 Compiled Context | Context engineering discipline + prompt caching practice | Engineering hygiene, no novelty claim; strong cost effect |
| P3 Constrained Narration | Grounded-generation/guardrails literature; LifeKeel's twist is the presence-requirement + narration-diff metric | Modest novelty; worth a measurement blog, not a filing |
| P4 Classify-before-generate | Cascade/routing literature; LifeKeel already ships trie→encoder→LLM | No claim; instrument escalation rate |
| P5 Synthetic-first distillation | Knowledge distillation + synthetic data literature; provider-terms minefield documented | No claim; the *compliance posture* (synthetic-only under rule 3) is the differentiator vs. competitors who fine-tune on user data |
| P6 Privacy-by-shaping | Data minimization + PII-redaction gateways (widely deployed); sealed-class-refuses-hosted-execution via M2 labels is the distinct composition | The label-boundary composition is new-ish; the rest is hygiene |
| P7 Batch economics | Standard provider practice | Hygiene |
| P8 Cost-per-correct-result | FinOps + eval-lineage composition; the join (cost × correctness × review minutes) is under-deployed in practice | No claim; good operating discipline |

---

## What the foundations change about the roadmap

1. **M1 is the keystone, and now has a formal name-check**: implement as a
   monotonic, PROV-flavored TMS — simpler than Doyle's because no belief
   revision is needed. Its invalidation operator is the shared substrate for
   M2 (revocation), M3 (certificate expiry), and M5 (forfeit triggers).
   Building M1 first isn't just sequencing — the other three literally
   subscribe to it.
2. **M2's formal basis is DCLabels**, specifically "dynamic principals"
   (member lifecycle changes the lattice). Read Stefan et al. 2011 before
   designing the label algebra; don't reinvent it.
3. **M3's narrow patent claim is the M1 coupling** — the freshness-bound
   certificate. The rehearsal protocol itself is a security-pattern
   composition (continuity exercise × capability attestation) and won't stand
   alone.
4. **M5's claim is forfeit-by-construction via classified-effect equality** —
   not "graduated autonomy" (that's the HF literature's adaptive automation,
   decades old).
5. **M7: drop all IP ambition.** The TDCommons defensive publication forecloses
   it. Build for trust, cite Certificate Transparency lineage.
6. **M4's honest risk is retention policy, not statistics** — the math is
   70-year-old solved work; the novel discipline is doing it per-tenant with
   conformal error budgets and a sensitive-attribute blocklist. If the
   retention price is too high (e.g., sentinels need more months of history
   than policy allows), the right answer is fewer sentinels, not more data.
7. **New combined-claim possibility this research suggests**: the
   **LifeGraph + Disclosure Lattice + Earned-Scope triple** — "a permissioned
   truth-maintenance system in which both visibility and autonomous-action
   authority are provable functions of a versioned evidence graph" — is a
   single coherent system-level claim no known product or paper composes. If
   one provisional is ever filed, that composition (not any single mechanism)
   is the filing.

## Honesty ledger

- All seven mechanisms are **compositions of established research**. That is
  the correct posture: soundness borrowed from proven theory, novelty living
  only in the family-domain binding and in the enforcement-in-construction
  property.
- The consumer-moat is real regardless of patent outcomes: the accumulated
  per-family state (evidence closures, calibration histories, rehearsal
  outcomes, earned scopes) compounds and cannot be imported by a competitor.
- Nothing here should be published externally before counsel runs claim-level
  prior art on the M1+M2+M5 composition, M3's freshness-bound certificate, and
  M4's per-tenant conformal alerting.

## References (selected)

- Doyle, "Truth Maintenance Systems for Problem Solving," MIT AI Lab TR-419,
  1977; Petrie, "Revised Dependency-Directed Backtracking," AAAI-87;
  JTMS/ATMS unification via abduction (Computational Intelligence, 1995).
- Myers & Liskov, Decentralized Label Model; Stefan, Russo, Mazières et al.,
  "Disjunction Category Labels" (DCLabels), 2011; Jif documentation.
- Page (1954) CUSUM; KW-ICSS unsupervised change-point detection (IEEE Access,
  2022); double CUSUM panel tests (EJS, 2016); Curry et al., payment-card
  change detection (KDD 2007).
- Gibbs & Candès, online conformal prediction under arbitrary shift (JMLR
  2024); Audited Conformal Prediction (2026); conformal selective prediction
  with cost-aware deferral (Sci. Reports 2026); Waudby-Smith & Ramdas
  confidence sequences (2024).
- Parasuraman, Sheridan & Wickens LOA taxonomy; adaptive trust calibration
  framework (2020, drone-simulator study); adaptive-autonomy review (Applied
  Ergonomics, 2024).
- UCAN specs: delegation, invocation, revocation (ucan.xyz); expiry-preferred
  semantics and append-only revocation sets.
- W3C PROV-DM; Certificate Transparency; TDCommons, "Chained Integrity
  Binding for Multi-Stage Processing Pipelines" (defensive publication — near
  prior art for M7).
- LLM-as-compiler instances: Rice-Factor, Prompt-Literate Workflow, LintCFG
  (arXiv 2602.07783), Helix DSL.
