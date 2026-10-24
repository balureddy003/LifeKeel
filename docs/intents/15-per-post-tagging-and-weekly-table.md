# Intent 15: Per-post tagging and the weekly visits-per-post table

**Problem** — Every social link carries `utm_content=<brief id>` (via `siteLink` in
`routes/marketing-posts.ts`), so all posts written from one brief are indistinguishable, and
posts from the weekly plan cannot be told apart by format. The existing learning loop scans every
user and lead on each draft and credits conversions by blog slug, so weekly-plan posts earn zero
conversion credit. The operator cannot answer "which post, and which kind of post, brought visits?"
That answer is the early signal every later step (Content Studio, learner) needs.

**Done looks like**
1. **A short post tag on every social link.** When a post is created, it gets a tag
   `p` + 8 lowercase hex chars (matches the UTM token rule; collision-checked per tenant).
   `siteLink` puts the tag in `utm_content`; the brief id moves to the post document
   (`brief_id`, already implied by `content_item_id`/`pillar`) so nothing is lost.
   Blog-slug posts keep working: for a post that links a blog page, `utm_content` is the tag and
   `source_blog_slug` stays on the post (the old slug join is replaced by the tag join, see 4).
2. **Features recorded at draft time** on the post, additively: `features: { format, hook,
   pillar, channel, length_bucket, hour_bucket, has_media }`. `format` and `hook` are `null`
   until intent 16 supplies them (pillar and channel come from the plan today). Buckets:
   length `short` (<=140 chars) / `medium` (<=400) / `long`; hour = scheduled hour in Europe/London,
   bucketed morning (5-11) / midday (11-15) / afternoon (15-19) / evening (19-24, 0-5).
3. **Visits and signups per tag.** Verified: the web client already forwards `utm_content` in
   `meta` on `landing_view`, `blog_view`, `guide_view` and `signup_view` (`currentUtm()` in
   `apps/web/src/lib/growth-track.ts`), and `eventMeta` passes it through — so no client change is
   needed. `eventMeta` does *not* token-clamp generic events today; the token→`other` bucketing is
   `bucket()` in `utm.ts`, applied via `attributionContent` at rollup time. Add `utm_content` to
   the per-day rollup so visits (`landing_view`, `blog_view`) and signups per tag are computed
   from `growth_events` and the journey rollup, not by scanning users. Note: posts published
   before this change keep `utm_content=<slug>` links live on the platforms, so their clicks won't
   join the table — early weeks undercount; that is expected, not a bug.
4. **Replace the all-users scan in `learningContextBlock`** with the tag join: the winner/flop
   section ranks by visits then signups per tag, with a sample-size note ("3 visits" is not a
   winner). Must not call out any person; aggregates only.
5. **Weekly table** in Operator -> Marketing (new "Posts" section on the Economics tab or the Plan
   tab, whichever has less churn): last 8 weeks, one row per post (channel, format, hook, pillar,
   posted at, visits, signups, engagement from existing read-back), plus a group-by toggle for
   format / hook / pillar / channel / hour bucket with visits-per-post and an interval
   (reuse the Wilson/confidence helpers from `economics.ts`; with fewer than 5 posts in a group
   show "not enough data", never a rank). Export as CSV is optional and cheap.
6. **Backfill is not required.** Posts before this change show "untagged" and are excluded from
   per-group stats but stay in the table.

**Constraints**
- Trust tier: 0 (observe and rank). Nothing here publishes anything or changes what is published
  except the `utm_content` value in a link. Approval hashes: the link is inside `content`, so the
  content hash changes with the tag; tag at creation, never rewrite an approved post.
- Regulated-advice check: no new public copy. The winner/flop block feeds the existing drafting
  prompt, which still passes `checkCopy`.
- Data/privacy: anonymous aggregates only; no new trackers, cookies or identifiers; the tag
  identifies a post, never a person. Visits are first-party events already collected.

**Out of scope** — choosing formats or hooks (intent 16), any automatic change to what gets
posted (intent 19), A/B significance tests, Search Console/GA4, new dashboards beyond the table.

**Becomes** — docs/prd/218-per-post-attribution.md (next free number at time of writing is 218).

---

## Build spec

**Files likely touched**
- `apps/api/src/routes/marketing-posts.ts`: tag generation at post creation — all `insertOne`
  sites, which are: the `/marketing/posts/generate` route (manual), `draftBlogPromoPost` (used by
  both the daily generator and the autopilot-approve path), `planWeek` posts, and campaign posts.
  Plus `siteLink` call sites, `learningContextBlock`, and the post type gets `post_tag` and
  `features`.
- `apps/api/src/marketing/content-plan.ts`: pass tag and brief id through `planWeek`.
- `apps/api/src/marketing/utm.ts`: add `newPostTag()` helper and a unit test for the token rule.
- `apps/api/src/marketing/journeys.ts`, `funnel.ts`, `jobs/metrics-rollup.ts`: roll up by
  `utm_content` (the `journey` rollup already keys on source|campaign|content; extend the visit
  side the same way). Keep `metrics_daily` row counts bounded (tokens only; `other` bucket).
- New `apps/api/src/marketing/post-stats.ts`: pure function `postStats(posts, visits, signups)`
  returning rows and grouped stats; route `GET /operator/marketing/post-stats?weeks=8`
  (`marketing.read`, read only — the scope is `read`, not `view`) next to the other marketing
  operator routes.
- `apps/web/src/lib/api.ts` and a new `PostStatsPanel.tsx` in the marketing `_components`.
- `apps/web` landing/blog client: forward `utm_content` in event `meta` if absent.
- Index on `{ post_tag: 1 }` (unique, sparse) in `db.ts` — global uniqueness, not per tenant:
  `growth_events` are anonymous with no `tenant_id`, so a tag collision across tenants would
  silently cross-attribute visits.

**Tests (each must fail without the change)**
- `newPostTag` always matches the UTM token rule; 1,000 draws without collision handling still
  retry correctly when a collision is forced.
- Every post-creation path stores `post_tag`, `features`, and the link contains
  `utm_content=<post_tag>`; the brief id is on the post, not in the link.
- `postStats` joins visits and signups by tag; untagged posts are excluded from groups; groups with
  fewer than 5 posts return `insufficient: true`; intervals match the economics helper.
- `eventMeta`/growth-events: a valid `utm_content` token is kept, free text becomes `other`.
- Route: role gating (`marketing.read`), response never contains user ids or emails.
- Learning block: ranks by tag join, labels small samples, includes no per-person data.
- Web: panel renders rows, group toggle, "not enough data" state.
- Existing plan/approve/hash tests stay green.

**Verification** — isolated stack per the build notes, `dry_run_mode: true`: generate a week,
confirm each link has a distinct tag, simulate three `landing_view` events with a tag via the
public endpoint, confirm the table shows 3 visits against that post.

**Open decisions for the owner** — none blocking. Default: ship the table on the Plan tab.
