# Intent 43: stat-of-the-week cards

**Problem** — every post needs a hook, and real numbers are the best hooks we
have. The card pipeline already renders branded PNGs; a stat format turns a
hand-maintained facts file into weekly content at zero marginal cost.

**Done looks like**
- `definitions/marketing-stats.yaml`: curated, sourced stats (UK family/
  bereavement/cover facts), each `{id, stat, source, claim_id}` — every line
  must map to a live claim so it passes the trust registry.
- New format `stat_of_week` (headline card): stat as the headline, one-line
  context as sub; plan may pick it like any active format.
- checkCopy passes on every stat+fallback (test).

**Constraints** — Tier 1 (drafts only); facts informational, no product push.

**Out of scope** — live stat computation from family data (privacy: never).

**Becomes** — PRD-225.
