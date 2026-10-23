# Intent: Marketing intelligence — revenue truth, attribution, channel economics

**Problem** — The operator cannot tell which channels or content produce paying
families, what they cost, or how reliable the numbers are. Revenue is a constant,
attribution is first-touch by label, and cost is absent.

**Done looks like**
- Revenue is read from Stripe (read-only) into `revenue_events`, idempotently,
  replacing the hard-coded MRR; when Stripe is not configured the old estimate is
  shown and labelled "estimate".
- Each signup has a server-side **journey**: first touch, lead touch (joined by
  normalized email, consented leads only), last touch (new), referral, activation,
  paid, revenue, churn.
- Operators can record monthly **spend** per channel (audited).
- `GET /operator/marketing/economics` returns per source / pillar / content item:
  visits, CTA clicks, leads, signups, activated, paid, revenue, spend, cost per
  signup, CAC, payback, rates with 95% intervals, and a confidence label
  (`insufficient | directional | solid`). First-touch and last-touch side by side.
- The marketing console has an **Economics** tab; findings are plain sentences
  that state uncertainty ("3 signups from 120 visits, 2.5%, plausible range 0.9-7%; no paid yet").
- Tests fail without each piece; no write path to Stripe exists.

**Constraints**
- Trust tier: 0 (read-only measurement and display). Spend entry is an audited
  human write. No outbound, no public effect, no new autonomous action.
- Regulated-advice check: operator-facing numbers only; no customer or public copy.
- Data/privacy: aggregate-only output to the UI (no per-person rows); journeys
  stay server-side; **no `anon_id` -> person join** (it would profile unconsented
  visitors); only consented lead data is joined; minors, erased users and
  suppressed addresses are excluded; growth events 13 months / leads 2 years
  retention unchanged; Stripe read uses a **restricted read-only key**; no new
  third-party trackers; no LLM in this slice (rule 3 / gateway not engaged).

**Out of scope** — Search Console/GA4 (slice 2), recommendations and AI narration
(3), experiments (4), segments (5), multi-touch beyond first/last, ad-platform
spend APIs, any change to billing behaviour.

---

## Roadmap (each slice has its own intent and sign-off) (each slice = its own intent, plan sign-off and PR set)

| # | Slice | Answers |
|---|---|---|
| **1** | **Revenue truth + attribution + channel economics (this plan)** | Which source/pillar/content brings paid families, at what CAC and payback, and how sure are we |
| 2 | Content intelligence: Search Console + GA4 (read-only OAuth), per-page performance, content -> activation -> paid | Which pages/topics earn traffic and convert; what to write next |
| 3 | Weekly Marketing Brief + recommendation rules **in shadow mode** -> Mission Control proposals (aggregate-only AI narration via a registered gateway task) | What to do this week, with evidence and an earned-trust track record |
| 4 | Experiments: holdouts / A-B with proper stats for email, landing and posts; kill-criteria tracker from the landing doc thresholds | What actually causes conversion |
| 5 | Segments, lifecycle sequence rollups, deliverability guardrails (complaints <0.1%, unsubscribes <1%) | Who to talk to, when, and are we safe to send |
