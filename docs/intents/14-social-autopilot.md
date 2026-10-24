# Intent: Social autopilot — connect every platform, keep profiles checked, keep the week filled

**Problem** — Only one of six platforms receives drafts; connection failures are
silent; profiles are unchecked on five platforms; the weekly plan is a manual
chore the operator can forget.

**Done looks like**
- One function answers "which channels can we post to for this tenant?" across
  both credential stores, with a health state per channel (`connected`,
  `needs_reauth`, `expiring_soon`, `not_configured`, `error`). Drafting, the
  weekly plan and the week view all use it.
- `GET /marketing/channels/health` + a Channels card: per platform, connected or
  not, token expiry, last successful publish, last error, and for unconnected
  ones the exact setup steps (developer portal, redirect URI, env vars).
- A weekly rule prepares next week's plan for **every healthy channel** and puts
  one decision in Mission Control: "Review and approve next week (N posts, M
  channels)". It opens the Plan tab; approval is the existing hash-based
  approve-the-week click. It is **not** batchable.
- Profile drift is read back for X, Facebook, Instagram and Threads (not only
  Bluesky); drift shows as a Mission Control decision with copy-ready text. Apply
  stays a manual checklist where the platform has no write API, and Bluesky's
  existing hash-approved apply stays.
- Expiring or dead connections raise an alert (and a Mission Control item).
- Instagram posts without an image are marked "needs image" in the plan and
  cannot be approved until one is attached.
- Tests fail without each piece; `trust-tier-gate` and advice-rule tests stay green.

**Constraints**
- Trust tier: 0/1 (read-back, prepare drafts). Publishing and profile writes stay
  Tier 2: a human approves the exact text (content hash); `NEVER_AUTONOMOUS`
  keeps `marketing.publish`, `social.post`, `marketing.profile_update`.
- Regulated-advice check: all generated copy still passes `checkCopy`; no named
  providers, no "buy/switch"; "Informational only" line kept on profiles.
- Data/privacy: public marketing text only; no family content in prompts; no
  new trackers; no auto-replies or DMs.

**Out of scope** — auto-publishing without approval (reverses intent 03; would
need its own Tier 3 design), replies/DMs, paid ads, TikTok/YouTube/Pinterest,
Mastodon (kit says skip), creating accounts, video, image generation, LinkedIn
Company Page (see decisions).

---

## Background (exploration summary)

Goal (yours): connect all social platforms, keep their profiles up to date, and
keep posting. You chose: **Keel drafts the week; you approve it in one tap;
posts then go out on schedule.** Platforms: Bluesky, LinkedIn, X, Threads,
Instagram, Facebook. That keeps intent 03 intact (every public post is a human
approval) while removing the weekly chore.

What exists (explored this session, `routes/marketing-*.ts`,
`marketing/social-publisher.ts`, `marketing/content-plan.ts`,
`marketing/channel-profiles.ts`, `routes/connector-credentials.ts`):
- Publish code for all six, behind approve -> `publishPost` -> minute sweep, with
  `marketing_paused`, copy guard, dry-run mode and the weekly "approve the week
  by content hash" flow. OAuth connect for X/LinkedIn/Meta; Bluesky app password.
- Engagement read-back for Bluesky, X, Facebook, Instagram, Threads (not LinkedIn).
- Profile drift check + apply only for Bluesky; the rest are manual checklists.

What blocks "all platforms" (the real gaps):
1. **Only Bluesky is ever drafted for.** `ensureWeeklyPlans`,
   `generateDailyMarketingDrafts`, the week view's `available_channels` and
   autopilot `propose_blog_promo` read `social_connections` (Bluesky) only. OAuth
   channels live in `connector_credentials` and are invisible to planning.
2. **Nobody is told when a connection will die or has.** LinkedIn tokens last ~60
   days with no refresh; `needs_reauth` shows as a generic "error".
3. **Instagram plan drafts can never publish** (no `media_url`, bypasses the
   create-route image check).
4. **Profile freshness is Bluesky-only**; others are never even read.
5. **The weekly plan needs a manual "generate" click**, and approving it is not
   surfaced where you look (Mission Control).

What I cannot do for you, by design: create developer apps, sign in to
platforms, or grant OAuth consent. You create the apps and put the credentials
in `.env`; I give exact steps and a health screen that says what is missing.
