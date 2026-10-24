# Intent 44: guide revival job

**Problem** — `draftBlogPromoPost` promotes a guide once, then the evergreen
content goes stale. Top-visited guides deserve periodic re-promotion with a
fresh format/hook so old content keeps earning attributed visits.

**Done looks like**
- Weekly job: pick the top-visited guide (journey/rollup by blog slug) not
  promoted in the last 30 days → `draftBlogPromoPost` with a different
  format/hook than last time → new draft (new `post_tag`) into the queue.
- Never approves or publishes — drafts only.
- Tests: picks highest-visit slug, skips recently-promoted, produces draft.

**Constraints** — Tier 1; copy guard + hash gate unchanged.

**Out of scope** — editing guide content itself.

**Becomes** — PRD-226.
