# Intent: Mission Control and shadow mode for the operator

**Problem** — The operator console is 14 pages the single operator must visit
to find out what needs them (the overview "attention" list is built in the
browser from a few counters). Autopilot rules are binary off/live, so the only
way to learn whether a rule is precise is to turn it on against real data.
Neither scales toward an operator that runs marketing, sales, support and infra
with a human only deciding.

**Done looks like**
- `GET /operator/mission-control` returns one ranked list of decisions the
  caller is permitted to act on (proposals, open alerts, support cases past
  SLA, draft posts/campaigns awaiting approval, pending four-eyes approvals,
  failed publishes), each with evidence, effect, undo, and links.
- Batch approve/reject exists only for autopilot proposals and alert acks;
  each item still passes its own permission, step-up, atomic claim and audit.
  Posts, campaigns, erasure and four-eyes items are "open", never batched.
- A rule can run in `shadow`: it collects candidates, writes ledger rows
  (`status: 'shadow'`) with `would_do`, and performs **no** act, alert,
  proposal or external call. Switching to `live` later still acts on those
  targets (shadow rows use a separate dedup namespace).
- Operators mark shadow rows right/wrong; promotion shadow→live is refused
  server-side until a rule has >= 20 reviewed rows and >= 90% marked right.
- A platform kill switch pauses the whole sweep; only a human can resume.
- Tests fail without each of the above; `trust-tier-gate` still passes with no
  new `ActionExecutor` caller.

**Constraints**
- Trust tier touched: 0 (shadow, read-only) and 1 (proposals already exist);
  approval gate: unchanged per-item human approval, batch is a UI convenience
  over the same gate. No Tier 2/3 added.
- Regulated-advice check: no customer-facing copy produced; item text is
  operator-facing and descriptive. Advice-rule test unaffected.
- Data/privacy limits: items carry ids, counts, subjects/ages only — no
  message bodies, no financial profile, no LLM. Shadow rows TTL 30 days.

**Out of scope** — AI-written briefings, content calendar, nurture/win-back
drafts, support theme clustering, self-healing rules, Ask-Keel-Ops chat (later
slices, each its own intent); any new autonomous external effect; auto-flipping
config (`configuration.update` stays never-autonomous).

**Becomes** — docs/prd/NNN-operator-mission-control.md once accepted.
