# PRD-216: IP workstream — provisional filings and defensive publication (non-engineering)

## Problem

The redefined architecture concentrates LifeKeel's differentiation in
mechanisms that are genuinely ownable (existing M1–M7 analysis, plus the
verified-answer and boundary-flow mechanisms). None of them is protected.
Without filings or defensive publication, a better-funded competitor can
either copy freely or — worse — patent adjacent mechanisms and constrain
LifeKeel's own roadmap.

## Who it's for

The founder/board (asset protection); engineering (knows what to keep
novel-vs-published). **Not a legal deliverable** — this brief scopes the
work for patent counsel.

## What "done" looks like

1. **Provisional filings (cheap, 12-month runway)** prepared with counsel
   for the top three:
   - **M1 LifeGraph** — versioned evidence dependency graph with minimal
     invalidation (recompute only conclusions whose evidence changed):
     technical effect is compute efficiency plus auditability.
   - **Verified-answer composition** (PRD-212) — natural-language query →
     authorized deterministic operation → provenance-bound rendering where
     the generation model is structurally unable to introduce numbers
     (presence-requiring guard). Concrete and claimable.
   - **M5 Earned-Scope Contracts** — autonomy as a collapsible, versioned
     credential adjusted by demonstrated behaviour. Uncrowded space; file
     before the Act-layer surface ships publicly (PRD-214).
2. **Boundary-flow enforcement** documented as candidate four: data-boundary
   labels flowing through the task gateway such that the *screening decision
   itself* cannot cross the boundary it screens (the quarantine insight from
   the October 2026 serving review). File only if counsel sees a clean
   technical-effect story.
3. **Defensive publication** for the rest: the escalation cascade with
   managed escalation rate, trust-tier action gating, receipt-chain UX,
   per-tenant permission-scoped provenance caching — publish enough detail
   to establish prior art, cheaply and quickly.
4. Freedom-to-operate scan on any mechanism before public claims are made
   in marketing (PRD-208 trust marks).

## Constraints

- **Trust tier:** n/a — process workstream.
- **Jurisdiction reality:** UK/EPO is strict on computer-implemented
  business methods; claims must be framed on technical effect (compute
  graphs, invalidation, capability enforcement), not on the financial-domain
  idea. US provisional-first keeps options open.
- **No engineering rewrites to "look patentable":** mechanisms are filed as
  they genuinely work. Publication cadence must not leak detector content
  strategy.

## Builds on

`docs/reviews/proprietary-mechanisms-and-future-architecture-2026-10.md`
(M1–M7 scoring) and `mechanism-foundations-research-2026-10.md` (prior-art
lineage — cite in filings what already exists to avoid overclaiming);
section 6 of the mechanisms doc (filing guidance).

## Success metrics

Three provisional applications filed; defensive publications posted for the
cascade/tier-gate/caching patterns; a standing one-afternoon-per-month
IP review slot established. Explicitly *not* a metric: number of filings —
the workstream stays cheap and secondary to shipping.

## Out of scope

Enforcement strategy, trademark work, contributor/CLA questions, anything
that delays a product milestone for a filing.

## Open questions

File the three provisionals on the same day (shared priority date) to reduce
counsel cost, or stagger to spread spend?
