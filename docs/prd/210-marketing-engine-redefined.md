# PRD-210: The marketing engine, redefined

## Problem

The marketing engine was built in pieces, each sound on its own: social drafts with human approval, a
cron publisher, segment campaigns, lifecycle emails, a blog seeded from detector content, a lead form
and a funnel. Read as a whole it has four weaknesses.

1. **Copy is not gated.** Social drafts, lifecycle emails, campaigns and the seeded blog are written
   to the advice rule by prompt and by habit. No test or runtime check covers them, and the claims
   registry that now controls the website is not used.
2. **It still describes the old product.** The draft generator, the seeded posts and two lifecycle
   emails talk about a two-minute readiness check and a score. The quiz is retired (PRD-209) and the
   story is now "the chart", signup first.
3. **Content cannot be corrected.** Seeded blog posts are inserted once by a migration, so editing the
   source changes nothing that is already live.
4. **It is built for posts, not for presence.** There is no place for the *profiles* (name, bio,
   links, pictures), no content plan or calendar, blog pages that search engines cannot read well,
   and a performance view that scans whole collections.

This PRD defines the engine as one system with one source of truth for what may be said, one
approval gate, and one funnel.

## Who it's for

The operator running LifeKeel's public presence, who needs a plan they can approve in minutes a
week; families, who should only ever see accurate, plainly worded material; counsel, who needs to see
that nothing unreviewed goes out.

## What "done" looks like

### A. One source of truth for what may be said
1. The claims registry (today `apps/web/src/components/landing/claims.ts`) moves to a shared package
   used by web and API. Each claim keeps `id`, `text`, `status` (live, planned, blocked), evidence and
   forbidden wording.
2. A pure **copy guard** checks any text before it is stored, approved or sent: blocked claims and
   phrases, advice patterns (recommendation verbs, named providers, comparison or switching language),
   missing "informational only" line where one is required, unverified numbers, over-length, missing UTM link.
   Result is pass, or fail with reasons shown beside the draft.
3. Every producer calls the guard: LLM drafts, template fallbacks, campaigns, lifecycle emails,
   detector-driven blog posts, profile text. A failing draft can be saved and edited but **cannot be approved
   or sent**.
4. A CI test runs the guard over all static copy (seeded posts, email templates, prompts' examples), so a
   change that breaks the rule fails the build. This extends the advice-rule test rather than replacing it.

### B. Content as objects, not single posts
5. A **content item** has a pillar, a source (guide, blog post, claim, product milestone), a plain-words
   brief, and one variant per channel. The pillars are the story's: the chart, a hard day, cover on file,
   your data, how-to guides.
6. A **calendar** places items on dates per channel. The operator approves a *week at a time* in one
   screen; each variant is still shown and individually reviewable, and approval records who and when.
   Nothing publishes without that approval (unchanged from today's rule).
7. The daily draft job fills the calendar from the pillar plan instead of only promoting unpromoted blog
   posts, so it does not run out of material. It only ever creates drafts.
8. **Content sync:** seeded or source-controlled content is upserted by slug with a content hash, so a
   corrected source reaches live pages. Human edits made in the console are not overwritten; they are
   flagged as diverged.

### C. Profiles as a managed thing
9. A **channel profile** records the desired state per network: display name, handle, bio, link with UTM,
   avatar and banner versions, and whether verification is done.
10. A drift check reads each connected network's actual profile where its API allows and shows
    differences. Where the API allows an update (Bluesky and Mastodon fully; others limited), an update is
    **proposed** and applied only on approval. Where it does not, the console shows the exact text and image
    to paste and a checkbox.
11. **Account creation, password setup and two-factor enrolment stay with a person.** The engine never
    creates an account and never stores an account password; connection uses the narrowest token or app
    password created for that purpose.

### D. Search and discovery
12. **Blog pages are real pages.** Posts are fetched at build and rendered as static HTML with their own title,
    description, canonical URL and Article structured data, as the guides already are. A scheduled rebuild or a
    revalidation hook publishes new posts; the client-only placeholder route goes away.
13. The sitemap lists every public page with `lastmod`; retired URLs redirect (as `/readiness` does) and are
    removed. `llms.txt` and the FAQ structured data are generated from the registry so they cannot drift.
14. A public **links page** carries the UTM-tagged destinations for bios, so profile links are stable.
15. Structured data is validated in tests (required fields present, no claim outside the registry).
16. Site verification for the search engines' webmaster tools is recorded as an operator checklist item.

### E. One funnel and cheap measurement
17. One UTM scheme: `utm_source` = network, `utm_medium` = social | email | content,
    `utm_campaign` = pillar, `utm_content` = content item id.
18. The performance view reads the daily rollups, not whole collections. The funnel is visit, signup
    started, account created, profile completed, first insight; each step by source and pillar.
19. A weekly digest to the operator: what published, what earned replies and signups, drift found, content
    needing review. Learning feeds the *drafting prompt* as today, never an automatic change of rules.

### F. Email and leads, re-baselined
20. Lifecycle sequences are rewritten for signup-first: welcome, finish-setup, upgrade, trial, win-back. Quiz
    and score wording is removed. Consent, suppression, list-unsubscribe, claim-before-send and the pause
    switch are unchanged.
21. The lead form stays as an optional newsletter ("family-readiness tips") with its own consent text.

## Constraints

- **Trust tier:** 0 for everything the engine writes (drafts, plans, drift reports, proposals). Anything
  public, outbound or that changes a profile is Tier 2 and **always** passes a human approval gate. This
  matches the existing `NEVER_AUTONOMOUS` list (`marketing.publish`, `social.post`), which gains
  `marketing.profile_update` and `marketing.dm_reply`. No auto-replies to messages or comments.
- **Regulated-advice check:** the guard enforces CLAUDE.md rule 2 on all marketing text. No provider is named,
  no policy ranked, no switching or comparison flow, no personal recommendation. Educational posts and emails
  point to "a licensed professional".
- **Data/privacy:** no family content in drafts or prompts (rule 3); prompts carry only registry claims, public
  guides and aggregate performance. No individual user data in social material. Financial-promotion rules for
  paid ads are a counsel question and ads are out of scope here.
- **Spend:** model calls go through the AI task gateway and the spend ledger as now; a per-week budget stops
  drafting, never publishing.
- **Kill switch:** `marketing_paused` continues to halt all sends and publishes.

## Builds on

PRD-209 (the chart story and claims registry), PRD-202 (detector-driven content), the existing
`marketing-posts` publisher, campaigns and lifecycle engine, `metrics_daily`, the AI task gateway, the
`docs/marketing/social-presence-kit.md` profile kit.

## Audit: what exists today

Strengths worth keeping: the approval invariant is tested (a fitness test ties the publisher to
`NEVER_AUTONOMOUS`); lifecycle sends are claimed before sending and deduplicated; consent, suppression and
unsubscribe are enforced; a global pause exists; UTM links are built for every post; dry-run mode rehearses the
pipeline; engagement is read back and fed into prompts as a comparative signal.

| # | Finding | Evidence |
|---|---|---|
| 1 | Marketing copy is outside every automated copy check | `advice-rule.test.ts` has no marketing files; the generator rules are prose in `GENERATE_SYSTEM` |
| 2 | Generator prompt and seeded posts describe the retired quiz ("in two minutes how ready", "try the free check", "60-second readiness check") | `marketing-posts.ts` `GENERATE_SYSTEM`; `detector-content-posts.ts`; `lifecycle-emails.ts` score and 2-minute lines |
| 3 | Seeded blog content is insert-once, so source edits never reach live posts | `migrate.ts` inserts `DETECTOR_CONTENT_POSTS` once |
| 4 | Blog posts render client-side behind a placeholder route; sitemap is built from the API at build time | `blog/[slug]/page.tsx`, `BlogPostClient.tsx`, `sitemap.ts` |
| 5 | The sitemap still lists `/readiness` until the quiz retirement merges | `sitemap.ts` |
| 6 | Performance view scans whole collections (events, users, leads, blogs) although `metrics_daily` exists | `marketingPerformance` |
| 7 | No model of the profiles themselves; nothing detects drift | no collection or route |
| 8 | The Calendar tab only displays scheduled posts; there is no content plan, and the daily draft job only promotes unpromoted blog posts, so it exhausts | `generateDailyMarketingDrafts` |
| 9 | Channel credentials are mixed: global env tokens for some, per-tenant connection for Bluesky; the LinkedIn token lasts about 60 days without refresh, so publishes then land in `publish_failed` | `social-publisher.ts` header |
| 10 | Instagram needs an image and there is no media pipeline beyond a `media_url` string | `social-publisher.ts` |
| 11 | Lifecycle nurture is defined around quiz captures | `lifecycle-emails.ts` header |

## Phases

Effort figures are estimates, not from the repo.

| Phase | Scope | Rough size |
|---|---|---|
| 0 | Copy guard (A1 to A4); rewrite generator prompt and seeded copy; content sync (B8); drop quiz wording from emails (F20) | 1 week |
| 1 | Static blog pages, sitemap with `lastmod`, structured data tests, links page, generated `llms.txt` (D12 to D16) | 1 week |
| 2 | Channel profiles, drift check, proposed updates, paste checklist (C9 to C11) | 1 to 2 weeks |
| 3 | Content items, pillar plan, calendar, weekly batch approval, calendar-filling draft job (B5 to B7) | 2 weeks |
| 4 | UTM scheme, rollup-based performance and funnel, weekly digest (E17 to E19) | 1 week |

Phase 0 ships first and alone: it removes the risk (ungated, stale copy) before anything is added.

## Success metrics

Zero published items that fail the guard (checked weekly); the share of drafts approved without edit
(quality of drafting); signups per source and pillar over a four-week window against the profile-kit
baseline; organic search impressions and clicks for blog and guide pages from the search console; profile drift
items open for more than a week (target none).

## Out of scope

Paid ads; auto-replying to comments or messages; video production; influencer or partner programmes
(PRD-207); changing the claims themselves; automatically creating accounts on any network.

## Open questions

- Does counsel want a recorded review step for the claims registry itself, since the guard trusts it?
- Which networks justify the upkeep of a connection (token refresh, media) after the four-week review?
- Should the weekly batch approval require two people for the first month?
- Is a rebuild-on-publish hook acceptable for static blog pages, or does the blog move to a server-rendered host?

## Amendments

- **Phase 0 built.** The claims registry stays in `apps/web` (moving it to a shared package is deferred); `definitions/marketing-copy-rules.json` is generated from it and a web test fails on drift. The guard is `apps/api/src/marketing/copy-guard.ts`, applied to social drafts (create, edit, approve, scheduled sweep), campaigns and, by test, every seeded post and lifecycle email body. Content sync is `apps/api/src/content-sync.ts`, run at startup. Not yet done: the guard is not applied to free-form blog edits in the content editor, and the "informational only" line is not required yet.
- **Phase 1 built.** Blog posts and the blog index are prerendered at build from the public API, each with its own title, description, canonical URL and `BlogPosting` structured data; a post newer than the last build is still served through the placeholder page and tagged in the browser. The root cause of the page text being invisible to crawlers was wider than the blog: the app shell showed a loading skeleton until the sign-in check finished, so every public page's static HTML held only "Skip to content". Public content pages (`/blog`, `/guides`, `/terms`, `/privacy`, `/support`) now render immediately, and `/` renders the landing while the check runs (a device with a stored session sees the skeleton, with no flash of the landing). `scripts/check-public-html.mjs` runs in CI and fails if a public page has no real text. Still open from phase 1: the links page, generated `llms.txt`, and structured-data validation beyond the blog post.
