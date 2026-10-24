# Intent 47: Search Console and GA4 read-back

**Problem** — The marketing console can post, schedule and measure its own first-party funnel, but it cannot see
how people find LifeKeel in search or what Google Analytics records. Topics for guides and posts are chosen from a
fixed list of 12 briefs, not from what families actually search for. GA4 is already on the public site (when
`NEXT_PUBLIC_GA_MEASUREMENT_ID` is set and the visitor has consented), but nothing reads it back, so the operator
cannot compare it with the first-party funnel. Search is the largest free source of new visitors for this topic, so
being blind to it is the biggest measurement gap.

**Done looks like**
1. **Search Console read-back, read-only.** A daily job pulls, for the verified site property, clicks, impressions,
   average position and click-through rate by query and by page for the last 3 days (data lags 2 to 3 days), and
   stores rollups. Nothing is written to Google.
2. **GA4 read-back, read-only.** A daily job pulls sessions, engaged sessions and key events (sign-up) by source /
   medium and by landing page, and stores rollups. Used only to cross-check the first-party funnel, never as the
   source of truth for signups.
3. **A "Search" panel in Operator, Marketing:** top queries (clicks, impressions, position), top pages, queries
   with many impressions and few clicks ("near misses"), pages that earn search clicks with signups per page where
   the first-party funnel can join them, and a GA4 versus first-party comparison for visits. Shows "not enough data"
   rather than ranking tiny counts, and states the 2 to 3 day lag.
4. **Topic candidates from real queries.** A weekly job turns high-impression, low-coverage queries into
   *suggested topics* (query text, impressions, position, nearest existing guide or brief). Suggestions are shown in
   the panel and are **never** turned into posts or guides automatically; a person picks one, and the normal
   drafting, copy guard and approval paths apply. No query text goes into a post unreviewed.
5. **Setup and health.** The Connections tab shows both integrations as `connected`, `not_configured` or
   `needs_attention`, with the exact setup steps (service account, granting access, property IDs) and the last
   successful pull. A failed pull raises the same kind of Mission Control item the platform canary does.

**Constraints**
- Trust tier: **0** (observe). No external write, no message, no public text. The suggested-topic list feeds a
  human; it does not create drafts, bank entries or posts.
- Regulated-advice check: queries are shown to the operator as data. Any text derived from a query still goes
  through the existing drafting, `checkCopy` and approval steps. Queries that read like personal financial
  questions are not turned into answer content by this intent.
- Data/privacy: Search Console returns aggregated queries; GA4 returns aggregates. Store only aggregates (no
  user ids, no client ids, no IPs). Discard queries Google withholds. Truncate stored queries to 200 characters
  and drop any containing an email address, phone number or long digit string. No family content is read or sent.
  Both collections are platform-level (no tenant data) but still listed in the erasure catalogue so the architecture
  check passes. Rule 3: nothing here trains or fine-tunes any model.
- Cost: free. Both APIs are free to use within their default quotas; confirm current quotas when building.
- Credentials: a Google service account that **you create** (this repo cannot create accounts). Its key goes in the
  API environment as `GOOGLE_READONLY_SERVICE_ACCOUNT_JSON`, separate from the Vertex key, and is never shown in the
  console (booleans only, as for the social developer apps).

**Out of scope** — writing to Google (sitemap submission, indexing requests), Google Ads reporting, Bing Webmaster
(a possible later copy of this pattern), third-party SEO tools (Ahrefs, Semrush; paid), rank tracking beyond Search
Console averages, automatic creation of guides or posts from queries, AI search citation tracking.

**Becomes** — docs/prd/223-search-and-analytics-readback.md

---

## Build spec

**Setup the owner does once (documented in the Connections tab and in `docs/local-testing.md`)**
1. In Google Cloud, create a service account with no roles; create a JSON key.
2. In Search Console, add the service account's email as a **restricted (read-only) user** on the property.
3. In GA4, add the service account's email as a **Viewer** on the property; note the numeric property ID.
4. Set `GOOGLE_READONLY_SERVICE_ACCOUNT_JSON`, `SEARCH_CONSOLE_SITE_URL` (for example `sc-domain:lifekeel.co.uk`) and
   `GA4_PROPERTY_ID` on the API.

**Reuse**
- Service-account token exchange: `packages/platform/src/vertex-auth.ts` already signs an RS256 JWT and exchanges it
  at `oauth2.googleapis.com/token` with no extra dependency. Generalise that into a small shared helper that takes a
  scope (`https://www.googleapis.com/auth/webmasters.readonly`, `https://www.googleapis.com/auth/analytics.readonly`)
  rather than copying it, and keep the existing Vertex behaviour and tests unchanged.
- Rollup storage and cron wiring: `apps/api/src/jobs/metrics-rollup.ts` (`metrics_daily`) and the daily jobs in
  `server.ts` under `withCronLock`.
- Health surface: `marketing/channels.ts` health states and the daily canary pattern from the LinkedIn version
  work, plus `operator/mission-control.ts` for attention items.
- UI: a new panel next to `EconomicsPanel`; the Connections tab for setup and status.

**Files likely touched**
- New `apps/api/src/marketing/search-console.ts` and `ga4.ts`: typed clients (`searchanalytics.query`, GA4
  `properties.runReport`) behind an injectable `fetch`, with paging, a 25,000 row cap, and a per-run time budget.
- New `apps/api/src/marketing/search-rollup.ts`: daily rollups into new collections `search_queries_daily`,
  `search_pages_daily`, `ga4_daily` (aggregates only), with indexes, plus `topic_suggestions` (query, impressions,
  position, nearest brief, status `suggested|dismissed|used`).
- New `apps/api/src/routes/marketing-search.ts`: `GET /operator/marketing/search?days=` (permission
  `marketing.read`), `POST /operator/marketing/search/suggestions/:id/dismiss` (`marketing.manage`).
- `server.ts`: one daily cron (after the 3 day lag, for example 06:30) and the weekly suggestion job.
- `erasure.ts`: add the four collections to the catalogue (aggregate, no tenant data; classify as exempt with a
  reason, or deletable if tenant-keyed).
- Web: `SearchPanel.tsx`, a Connections entry, `lib/api.ts` types.
- `.env.example`: the three variables, commented.

**Tests (each must fail without the change)**
- Clients: request bodies carry the right dimensions, date range and row limits; paging stops at the cap; a 403
  becomes `needs_attention` with a clear reason; a missing credential becomes `not_configured`; no credential value
  appears in any response or log line.
- Rollup: idempotent for the same day; withheld-query rows are skipped; queries containing an email, phone or long
  digit string are dropped; stored query length is capped; only aggregates are stored.
- Suggestions: a query is suggested only above an impressions threshold and when no existing brief or guide covers
  it; a dismissed query does not return; suggestions never create a post, bank entry or draft (assert collection
  counts unchanged).
- Routes: role gating; the response has no user identifiers; "not enough data" below the sample threshold.
- Shared auth helper: scope parameter respected; Vertex behaviour unchanged (existing tests stay green).
- Erasure and architecture-claims tests pass with the new collections classified.
- Web: panel renders each state (not configured, needs attention, data, near-misses, lag note).

**Verification** — With the service account set up, run the pull against the real property once from a throwaway
database and compare ten top queries and the page-view total with the Search Console and GA4 web UIs. Expect small
differences (sampling, thresholds, 2 to 3 day lag). Without credentials the panel must show `not_configured` and the
daily job must be a no-op. Do not claim live verification in the PR unless that comparison was done.

**Open decisions for the owner** — the Search Console property type (domain versus URL prefix); whether GA4 stays
consent-gated on the public site (default: yes, which means GA4 undercounts versus the first-party funnel, and the
comparison panel should say so); the impressions threshold for suggestions (default 20 over 28 days).
