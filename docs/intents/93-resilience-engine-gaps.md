# Intent 93: Resilience Engine blueprint, gap-closing intents

Source: "LifeKeel Resilience Engine: Research and Blueprint" (2026-11-14, owner's document) reviewed
against CLAUDE.md and the repo. Each gap below is an intent in the shape of `docs/templates/intent.md`,
plus who decides and whether code can start. Nothing here builds the engine. The engine stays unbuilt until
Group A is decided.

Repo facts checked on 2026-11-14 (main):
- No MCP server in `apps/api`. No bitemporal tables. Datastore is MongoDB.
- `detector-evals/` holds golden datasets for the nine family detectors; `family-detector-evals.test.ts`
  gates on F1 >= 0.80. This is the seed of the verifier.
- `detectors/family/emergency-fund-adequacy.yaml` already states months of expenses covered. An
  "income stops" estimate for savings alone already exists.
- AI calls go through `apps/api/src/ai/task-gateway.ts`; Azure, Vertex, Groq approved, xAI testing-phase,
  Anthropic and OpenAI refused outside dev.

Tier for every intent unless stated: Tier 0 (information only, no external action).

## Group A: decide before any engine code (owner)

### A1. Ranked actions must not read as a recommendation (gap 1)
**Problem** — "Rank fixes by pounds of risk" and "single most valuable next step" can become a personal
recommendation (rule 2) if an action is a cover purchase or change.
**Done looks like** — a written rule: the ranked set holds only informational actions (confirm a
nomination, add a missing document, check a renewal date, ask your provider). A test lists the allowed
action kinds and fails on any kind that names, compares or steers to a product.
**Constraints** — Tier 0. Advice check: this intent exists to enforce it. Output shows what is on file and an
estimate, never "buy".
**Out of scope** — pound-value ranking of product purchases, ever.
**Decides** — owner. **Code now?** — no; the allowed-kinds list is the first deliverable once approved.

### A2. Hosted AI and the MCP server (gap 2)
**Problem** — The blueprint exposes the engine to Claude, ChatGPT and Gemini. Rule 3 bars routing family
content through consumer AI endpoints; extraction names "a small model, a larger one" without the gateway.
**Done looks like** — (a) every extraction task is registered in `definitions/ai-tasks.yaml` with
`allowed_processors` limited to approved ones; (b) MCP exposes only metadata and results the user has
already seen, never documents, behind per-tenant auth, as an opt-in; (c) a gateway test covers the new tasks.
**Constraints** — Tier 0. Prompt-injection from document text treated as data. Consent flow for third-party
AI is procedural today and must exist before (b).
**Out of scope** — document content through any consumer endpoint.
**Decides** — owner (MCP at all; consent copy). **Code now?** — task registration only, with the engine.

### A3. Learning loop and cross-tenant learning (gap 3)
**Problem** — Provider playbooks from corrections, outcome recalibration and shared layout knowledge pool
family data.
**Done looks like** — default is per-household only. Any pooling needs explicit opt-in, privacy review,
minimum cohort size, deletion/retraining evidence and user-facing disclosure, as CLAUDE.md requires.
Playbooks are authored by people from patterns, not trained on content.
**Constraints** — Tier 0. No fine-tuning on family content.
**Out of scope** — pooled model training.
**Decides** — owner plus privacy review. **Code now?** — no.

### A4. Human gate on engine changes (gap 4)
**Problem** — "Keep it if it back-tests better" lets an agent change numbers users see.
**Done looks like** — improvement loops may propose a change and its back-test; merge and release stay a
human action (existing PR flow). The verifier result is evidence, not authority.
**Out of scope** — auto-merge or auto-release of engine changes.
**Decides** — owner. **Code now?** — no; this is a rule to add to the engine PRD.

### A5. Two-adult privacy and safeguarding (gap 10)
**Problem** — "Income stops" or "death of an earner" shows one adult's income and risk to the other.
**Done looks like** — shocks run on figures each adult has chosen to share with the household; no engine
output reveals a figure the second adult could not already see; blocked until the safeguarding rules
H23, H25, H26, H29 and PRD-229 are decided.
**Constraints** — Tier 0. Children's data posture (intent 09) applies.
**Decides** — owner and safeguarding review. **Code now?** — no.

### A6. Business graph scope (gap 11)
**Problem** — Customers and suppliers are third-party personal data; segment B is undecided.
**Done looks like** — a go or no-go on owner-managed firms, a data classification for business nodes, and an
erasure plan, before phase 5 of the blueprint.
**Decides** — owner. **Code now?** — no.

### A7. Patent secrecy versus the trust story (gap 17)
**Problem** — "Keep the mechanism off the website" conflicts with the openness of the Trust page.
**Done looks like** — a written rule: nothing describing the two-graph shock mechanism is published before
an attorney's filing; the Trust page may describe behaviour and limits, not method.
**Decides** — owner plus attorney. **Code now?** — no.

### A8. Go-to-market and the second-adult loop (gap 16)
**Problem** — The blueprint does not say why a family uploads ten documents, who pays, or how it helps the
real launch risk (a second adult looking within a week).
**Done looks like** — one activation path stated: which single document the first session asks for, what the
user sees in two minutes, and the measure (second adult looks within 7 days).
**Decides** — owner. **Code now?** — no. See `docs/research/platform-story-and-gtm-2026-11-08.md`.

## Group B: design intents (can be written into a PRD now)

### B1. Define "correct" and the verifier (gap 5)
**Problem** — Hand-calculated households test arithmetic, not whether the model reflects reality; back-test
needs outcome data that will not exist at launch.
**Done looks like** — the verifier has three layers, each named and measured: (1) arithmetic cases with
known answers, extending `detector-evals/` format; (2) invariants (cover never counted twice, monthly x12,
shock never improves a margin); (3) back-test, explicitly marked "not measurable before outcome data",
dropped from launch success measures.
**Becomes** — PRD in `docs/prd/`. **Code now?** — layer 1 and 2 can start as eval files for one shock.

### B2. Event frequency and duration table (gap 6)
**Problem** — No UK table of how often each event happens and how long it lasts; the ranking depends on it.
**Done looks like** — a sourced table (ONS, DWP) with each value's source, date and range, held as a data
file with a test that every row cites a source. Rows with no source are absent, not guessed.
**Constraints** — population rates only, never an individual's health or job.
**Code now?** — data file and source-required test, after the owner approves the source list.

### B3. Erasure versus two-date history (gap 7)
**Problem** — "When LifeKeel learned it" keeps history; UK GDPR deletion requires removal.
**Done looks like** — history lives in tenant-scoped collections classified in `architecture-claims.test.ts`
and added to `DELETABLE_COLLECTIONS`; a deletion test proves history rows go too; no history is kept for
fields marked sensitive beyond the retention in `docs/data-retention.md`.
**Code now?** — with the store, not before.

### B4. Datastore decision (gap 8)
**Problem** — Postgres two-date tables would be a second datastore beside MongoDB.
**Done looks like** — a short decision record. Recommendation: keep MongoDB and store `valid_from` and
`recorded_at` on records; revisit Postgres only if a query cannot be done. Cost and ops of a second store
named.
**Decides** — owner. **Code now?** — no.

### B5. Map the engine onto what exists (gap 9)
**Problem** — The blueprint calls LifeKeel a vault; the repo already has much of the engine's first layers.
**Done looks like** — the table below, kept in this file and reviewed before any engine PRD.

| Blueprint part | Already in the repo | Missing |
|---|---|---|
| Verifier set | `detector-evals/` goldens, F1 gate | shock cases, invariants |
| Extraction | document upload paths, AI task gateway | schema per document type, confirm step |
| Graph | domain packs, financial profile, policies | two-date facts, business nodes |
| Simulation | emergency-fund months, protection-gap detector | monthly model, events in combination |
| Ranking | detector insights | with/without ranking (blocked by A1) |
| Output | landing "on file + estimate" language | range display, plain-English reason |
| Learning | none (federated code is dormant, gated) | blocked by A3 |
| MCP | none | blocked by A2 |

### B6. Document ingestion design (gap 12)
**Problem** — Risks mention mailboxes; no design for Gmail Limited Use, health data in policies or retention.
**Done looks like** — an ingestion note: upload first, mailbox later; Gmail-derived data excluded from any
cross-tenant scorer; health-bearing fields treated as sensitive (envelope-encrypted, TTL); each document
type lists fields kept and fields dropped.
**Code now?** — no.

### B7. Benefits output is a statement, so treat it as information (gap 13)
**Problem** — "What the state would pay" from PolicyEngine UK reads as a benefits statement and AGPL needs a
solicitor.
**Done looks like** — output wording "an estimate from the figures you entered; check with the benefit
provider", a hard separation of the service (own process, unmodified), and a solicitor's licence opinion
recorded before integration.
**Decides** — solicitor. **Code now?** — no.

### B8. Friction and cost budget (gap 14)
**Problem** — Whole-document accuracy of 42–63% means confirming fields on every document; cost per household
has no budget.
**Done looks like** — a stated cap: at most three fields to confirm per document in the first session, and a
cost-per-household-per-month ceiling set by the owner; both measured in staging with fictional households.
**Decides** — owner for the ceiling. **Code now?** — no.

### B9. Thin first slice (gap 15)
**Problem** — First user-facing output is phase 4 of the blueprint.
**Done looks like** — one shock, income stops, on figures the family already entered, showing months of
expenses covered by savings and by income protection on file, as an estimate. The emergency-fund detector
covers savings today; the new part is adding income protection on file and a range.
**Constraints** — advice check on every line; add a golden case in `detector-evals/`.
**Becomes** — the first engine PRD. **Code now?** — yes, after A1 is approved (same copy rules).

## Order

1. Owner decides A1, A2, A3, A4 (one sitting; they decide whether the engine can ship).
2. B1, B2, B5 into one PRD with the verifier first.
3. B9 as the first shipped slice.
4. A5, A6, A7, A8, B3, B4, B6, B7, B8 resolved before phases 3 to 5.

## Not done here

No engine code, no data store, no MCP server, no external claims. Source figures in the blueprint were not
re-verified.
