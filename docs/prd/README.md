# PRDs

Requirement briefs for Agent Oak, following the PRD→production process in
[CLAUDE.md](../../CLAUDE.md#prd--production-using-claude-code): problem,
who it's for, what "done" looks like, and the trust tier it touches.
Grounded in [000](000-market-landscape-and-positioning.md)'s market
research and in hands-on verification of the current codebase — every
"what's shipped" and "current gap" claim below was checked against real
code, not assumed.

## 000 — shared reference

[000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md) —
competitive landscape (AI money apps, family life-admin platforms,
insurance-gap tools) and the "world-class bar" each PRD below is written
against. Read this first; other PRDs cite it instead of repeating it.

## 00x — backfilled: what's already shipped

Retroactive PRDs for live functionality, written against the same
template as forward-looking work so the full product surface is legible
in one place, plus a product-owner's "gaps to reach world-class" pass on
each — not just documentation, a refinement backlog.

1. [001-family-onboarding-twin-graph.md](001-family-onboarding-twin-graph.md) —
   conversational onboarding, the Family Twin's people domain.
2. [002-financial-domain-intelligence.md](002-financial-domain-intelligence.md) —
   the financial profile + 4 detectors, the one domain where the vision is
   fully real today.
3. [003-document-intake-ocr.md](003-document-intake-ocr.md) — upload +
   free storage / paid AI extraction.
4. [004-email-connector-inbox.md](004-email-connector-inbox.md) — Gmail
   scanning and the AI-summarized inbox.
5. [005-emergency-mode-scenario-simulator.md](005-emergency-mode-scenario-simulator.md) —
   the "What If?" simulator. **Flagged as the strongest differentiation
   candidate in the product** — market research found no comparable
   consumer product; see its market-bar section.
6. [006-oak-plus-billing.md](006-oak-plus-billing.md) — the Stripe-backed
   paid tier, currently dormant pending production cutover.

## 10x — forward: closing the vision gap

Sequenced to match ARCHITECTURE.md's roadmap — deepen the financial
domain before going wide, prepare-only actions before anything that acts.

1. [101-live-ai-assistant.md](101-live-ai-assistant.md) — replace the
   hardcoded assistant response map with real reasoning over the tenant's
   actual data. Tier 0.
2. [102-protection-insurance-domain.md](102-protection-insurance-domain.md) —
   extend the financial domain's bolted-on life/income-protection fields
   into a real Protection domain (multi-policy, renewal tracking,
   coverage-type gaps). Tier 0.
3. [103-tier1-prepare-actions.md](103-tier1-prepare-actions.md) — Oak
   drafts an outreach message for an insight; a human copies/sends it
   themselves. Tier 1, and deliberately stops there.

## 20x — marketing: the same engine as the growth mechanic

Uses Agent Oak's own detector engine and content infrastructure
(`blog.ts`, `growth-events.ts`) as the acquisition mechanism, rather than
building disconnected marketing tooling.

1. [201-public-readiness-score-lead-magnet.md](201-public-readiness-score-lead-magnet.md) —
   a public, no-signup readiness quiz that runs the *real* detector
   engine anonymously, not a simplified marketing-only approximation.
2. [202-detector-driven-content-engine.md](202-detector-driven-content-engine.md) —
   one explainer post per detector rule, cross-linked from both the
   marketing site and real in-product insight cards.

## Deliberately not written as PRDs yet

Per ARCHITECTURE.md's own sequencing, these aren't ready for an
engineering PRD:

- **Health & Life/Assets domains** — GDPR special-category data; the
  architecture doc says to sequence this after the trust/consent model is
  proven on lower-stakes domains, not before.
- **Action Network partnerships** (bank/insurer/airline API integrations) —
  "mostly a business-development problem wearing an engineering costume."
  Nothing here to write a technical PRD against until a partner exists.
- **Any Tier 2+ autonomous action** (auto-filing a claim, moving money) — not
  proposed until PRD-103's Tier 1 pattern has shipped and been trusted in
  production, and even then needs its own named trust-tier decision per
  CLAUDE.md's rule, not a default next step.
