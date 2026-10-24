# PRD-218: Per-post attribution — tags, post features, and the weekly table

## Problem

Every social link carries `utm_content=<brief id>` (via `siteLink` in
`routes/marketing-posts.ts`), so all posts written from one brief are
indistinguishable, and posts from the weekly plan cannot be told apart by
format. The existing learning loop (`learningContextBlock`) scans every user
and lead on each draft and credits conversions by blog slug, so weekly-plan
posts earn zero conversion credit. The operator cannot answer "which post, and
which kind of post, brought visits?" — the early signal every later marketing
step (Content Studio, learner) needs.

## Who it's for

The operator (a readable weekly answer to "what worked"); the marketing engine
itself (the per-post features every later selection/learning step keys on).

## What "done" looks like

1. **A short post tag on every social link.** When a post is created it gets a
   tag `p` + 8 lowercase hex chars (matches the UTM token rule; collision-
   checked). `siteLink` puts the tag in `utm_content`; the brief id moves to
   the post document (`brief_id`, already implied by `content_item_id` /
   `pillar`). Blog-slug posts keep working: `utm_content` is the tag and
   `source_blog_slug` stays on the post.
2. **Features recorded at draft time** on the post, additively:
   `features: { format, hook, pillar, channel, length_bucket, hour_bucket,
   has_media }`. `format`/`hook` are `null` until PRD-219 supplies them.
   Length buckets: `short` (<=140 chars) / `medium` (<=400) / `long`; hour =
   scheduled hour in Europe/London, bucketed morning (5–11) / midday (11–15) /
   afternoon (15–19) / evening (19–24, 0–5).
3. **Visits and signups per tag.** `utm_content` already reaches
   `growth_events.meta` on `landing_view`/`blog_view`/`guide_view`/
   `signup_view` (verified — `currentUtm()` in `apps/web/src/lib/
   growth-track.ts`); no client change needed. Add `utm_content` to the
   per-day rollup so visits and signups per tag come from `growth_events`
   and the journey rollup, not a live all-users scan. Posts published before
   this change keep slug-tagged links live on the platforms, so their clicks
   never join — early weeks undercount; expected, not a bug.
4. **Replace the all-users scan in `learningContextBlock`** with the tag
   join: the winner/flop section ranks by visits then signups per tag, with a
   sample-size note ("3 visits" is not a winner). Aggregates only — never a
   person.
5. **Weekly table** in Operator → Marketing (a "Posts" section on the Plan
   tab): last 8 weeks, one row per post (channel, format, hook, pillar,
   posted at, visits, signups, engagement from existing read-back), plus a
   group-by toggle for format / hook / pillar / channel / hour bucket with
   visits-per-post and a Wilson interval (reuse `economics.ts` helpers);
   groups under 5 posts show "not enough data", never a rank. CSV export
   optional.
6. **No backfill.** Older posts show "untagged" and are excluded from grouped
   stats but stay in the table.

## Constraints

- **Trust tier:** 0 (observe and rank). Nothing publishes differently except
  the `utm_content` value inside a link. The link is inside `content`, so the
  approve-the-week hash covers it — tag at creation, never rewrite an
  approved post.
- **Regulated-advice check:** no new public copy. The winner/flop block feeds
  the existing drafting prompt, which still passes `checkCopy`.
- **Data/privacy:** anonymous aggregates only; no new trackers or
  identifiers; the tag identifies a post, never a person. Visits are
  first-party events already collected.

## Out of scope

Choosing formats or hooks (PRD-219), any automatic change to what gets posted
(PRD-221), A/B significance tests, Search Console/GA4, dashboards beyond the
table.

## Builds on

PRD-210 (the marketing engine), intent 14 (channels/health groundwork).
Build spec: `docs/intents/15-per-post-tagging-and-weekly-table.md`; shared
context in `docs/intents/marketing-engine-build-notes.md`.

## Success metrics

Every new post carries a distinct `post_tag`; the weekly table answers
"which post brought visits" without a code query; `learningContextBlock` no
longer reads `users`/`leads`.
