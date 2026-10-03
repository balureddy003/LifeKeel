# PRD-136: Readiness feed + family heartbeat ("What changed?")

## The problem

Oak already *does* a lot in the background — 9 detectors re-evaluate on
every data change and on a daily sweep, member-agent nudges reconcile
daily, scenarios are recomputed on every read, score snapshots are
persisted, insight→action attribution is recorded. But none of that is
*narrated* to the family. A member who logs in sees the current state;
they never see what moved, why, or who it affects. Between logins, the
only thing Oak sends is a per-insight notification or a flat digest of
queued insights (`DeliveryRouter.sendDigest`).

The positioning claim is "a system that watches while you don't." Today
the watching is real but silent. This PRD makes it legible: a
chronological **readiness feed** in-app and a **weekly heartbeat** by
email/push, both built from events the backend already produces.

Who it's for: every active adult in a family. Children see a redacted
slice (same rule as the youth twin).

Trust tier: **Tier 0** (read models + notifications). No new Act surface.

## What "done" looks like

1. `/` (signed-in home) shows a **"What changed"** feed: the last 30 days
   of readiness events, newest first, each with what changed → why it
   matters → who it affects → evidence → next check.
2. Every event is explainable: it links to the detector rule, score
   component, document, scenario, or profile field that produced it.
3. Material score movement (≥5 points composite, or ≥10 on a component)
   produces a feed event *and* a notification through the existing
   `DeliveryRouter`, honouring quiet hours / urgency floor / digest mode.
4. A **weekly heartbeat** email goes out Monday 08:00 tenant-local to
   each adult with: score movement, new/resolved insights, renewals in
   the next 30 days, documents processed, unfinished playbook steps,
   stale fields. Zero-change weeks send a one-line "nothing moved, next
   sweep Tuesday" — or nothing, per preference.
5. Saved scenarios become **watchlist** entries: when a recompute changes
   runway/depletion month by ≥ 0.5 months, a feed event is emitted
   ("your 'one income' scenario improved from 3.8 to 4.6 months").
6. A **notification preference center** on `/settings` exposes what the
   router already supports (channels, quiet hours, digest mode, urgency
   floor) plus the new per-domain and per-member scopes and heartbeat
   cadence (weekly / monthly / off). Critical alerts (renewal ≤7 days,
   continuity check-in) are exempt from "off" and the UI says so.
7. Each feed event has feedback controls: *Useful · Not relevant ·
   Already handled · Remind me later · Data is wrong*. "Not relevant"
   suppresses only that rule+entity for 90 days and the feed shows why
   something was muted; nothing silently disappears.

## Why this is the right next turn of the flywheel

Flywheel stage: **Trust & Engagement → Data Depth**. Leading metric:
30-day return rate. The feed is the surface that turns detector output
into a reason to come back, and the "Data is wrong" / "Already handled"
responses are a new, cheap data-freshness channel.

Competitive: Origin's proactive checks surface as a conversation;
LifeOS requires a conversation; Trustworthy "Next" surfaces deadlines.
Nobody shows a family a *timeline of their own readiness*. This is the
visible form of Claim 1 + Claim 3.

## What exists (verified) and what's new

| Need | Exists today | New |
|---|---|---|
| Score history | `readiness_score_history` snapshots, `GET /family/readiness/history` (`routes/family-readiness.ts`) | Diff consecutive snapshots → `score_moved` events |
| Insight lifecycle | `insights-persist.ts` (identified/sent/approved/completed/resolved, `repeat_count`) | Emit `insight_opened` / `insight_resolved` / `insight_repeated` events |
| Acted-on attribution | `lib/insight-attribution.ts` | Emit `action_attributed` events ("you acted on this within 30 days") |
| Member nudges | `member-nudges.ts`, `jobs/member-agent-loop.ts` (attention/insight/progress) | Emit member-scoped events with `member_id` |
| Scenarios | `routes/family-scenarios.ts` recomputes on read | Nightly recompute job + delta events (watchlist) |
| Renewals | `jobs/policy-renewal-reminders.ts` | Emit `renewal_approaching` events (30/14/7 days) |
| Documents | `routes/documents.ts`, `routes/vault.ts` | Emit `document_processed` / `document_applied` events |
| Life events | `routes/life-events.ts`, `checklist-reminder.ts` | Emit `playbook_steps_pending` events |
| Delivery | `delivery/delivery-router.ts` (channels, quiet hours, urgency floor, digest, dedup) | Add `heartbeat` notification type and per-domain/per-member filters |
| Prefs | `delivery_preferences` (account.ts), push toggle on `/settings` | Full preference center UI + new fields |
| Digest | `sendDigest` over `digest_queue` | Replace body with heartbeat renderer; keep queue semantics |

## Design

### 1. Event model — `readiness_events` (tenant-scoped)

```ts
interface ReadinessEventDoc {
  id: string
  tenant_id: string
  type:
    | 'score_moved'          // composite or component delta
    | 'insight_opened'       // new insight surfaced
    | 'insight_repeated'     // same rule+entity re-fired (adaptive copy)
    | 'insight_resolved'     // rule stopped firing
    | 'action_attributed'    // family acted within 30d of an insight
    | 'scenario_moved'       // watchlist recompute delta
    | 'renewal_approaching'  // 30 / 14 / 7 days
    | 'document_processed'   // uploaded / extracted / applied
    | 'profile_changed'      // field-level diff (reuses profile-review diff)
    | 'playbook_steps_pending'
    | 'milestone'            // child age band, target reached, 6-month fund hit
    | 'sweep_quiet'          // daily sweep ran, nothing changed (feed-only, collapsed)
  severity: 'info' | 'notice' | 'attention' | 'critical'
  direction: 'up' | 'down' | 'flat' | null
  member_id: string | null          // null = household
  domain: ReadinessComponentKey | 'debt' | 'documents' | 'scenarios' | null
  title: string                     // "Protection improved by 8 points"
  summary: string                   // what changed + why it matters (≤280 chars)
  evidence: { label: string; value?: string; value_minor?: number }[]
  links: { kind: 'insight'|'component'|'document'|'scenario'|'member'|'profile_field'; id: string }[]
  next_check_at: Date | null        // "Oak checks again tomorrow 06:00"
  dedupe_key: string                // type + subject + day, idempotent writes
  created_at: Date
  feedback?: { user_id: string; value: 'useful'|'not_relevant'|'handled'|'remind_later'|'data_wrong'; at: Date }[]
}
```

Writes go through one helper `emitReadinessEvent(db, tenantId, evt)`
in `apps/api/src/feed/emit.ts`, which: upserts on `dedupe_key`, is
fire-and-forget with a try/catch (never breaks the write path that
triggered it — same discipline as `insight-attribution.ts`), and
registers an `event-schema-registry` Zod schema so bad shapes log
rather than throw.

Children: `GET /family/feed?mode=youth` returns only `milestone`,
`progress`-style `score_moved` for their own member_id, with
`value_minor` stripped (same redaction as `member-twin.ts`'s youth mode).

### 2. Emitters (hook points)

| Emitter | Hook | Rule |
|---|---|---|
| `score_moved` | after snapshot write in `family-readiness.ts` | compare with previous snapshot; composite Δ≥5 or component Δ≥10 → `attention`; smaller → `info` |
| `insight_*` | `persistAndDeliverInsights` | opened on insert; repeated when `repeat_count` increments; resolved in the stale-resolution pass |
| `action_attributed` | `recordInsightAction` | one event per (insight, action_type) |
| `scenario_moved` | new `jobs/scenario-watchlist.ts` (nightly 05:30) | recompute each persisted scenario; emit when `runway_months` or `depletion_month` Δ ≥ 0.5 |
| `renewal_approaching` | `policy-renewal-reminders.ts` | at 30/14/7-day marks; 7-day = `critical` |
| `document_processed` | `documents.ts` upload / extraction complete / apply-to-profile | one event per stage |
| `profile_changed` | profile POST, reusing the field-diff humanizer from `profile-review` | summarise up to 3 fields |
| `playbook_steps_pending` | `checklist-reminder.ts` | once per reminder |
| `milestone` | `member-agent-loop.ts` (age bands), `score.ts` (fund target met) | `notice` |
| `sweep_quiet` | `stale-profile-evaluation.ts` | one per day; feed collapses runs into "Quiet for 4 days" |

### 3. Read API

- `GET /family/feed?since=&member_id=&domain=&limit=` — adult-only, newest
  first, `sweep_quiet` collapsed server-side.
- `GET /family/feed/summary?window=7d|30d` — counts by type/direction +
  composite Δ; powers the home header ("3 things moved this week").
- `POST /family/feed/:id/feedback` — body `{ value }`; `not_relevant`
  writes a `feed_mutes` row `{rule_id, entity_key, until}` honoured by
  the emitter; `data_wrong` deep-links to the profile field.
- `GET /family/scenarios/watchlist` / `PATCH /family/scenarios/:id`
  `{ watch: boolean }` — opt a saved scenario in/out of nightly
  recompute (default **on** for new scenarios).

### 4. Heartbeat

`jobs/family-heartbeat.ts`, cron Monday 08:00 (and 1st of month for
monthly cadence), per tenant under `withCronLock`:

1. Load `readiness_events` for the window, `readiness_score_history`
   endpoints, open insights, renewals ≤30d, pending playbook steps,
   stale fields (profile `updated_at` > 180d).
2. Render with `renderHeartbeat()` → `{ subject, text, html, push_title,
   push_body }` using the existing email HTML shell from `auth-email.ts`.
3. Hand to `DeliveryRouter.deliver()` as notification type `heartbeat`,
   urgency `low` (so the urgency floor and digest mode behave), one per
   **adult** — not per tenant — using each member's `email`/push
   subscription. Children never receive it.
4. Zero-change weeks: send the one-liner only if `heartbeat_quiet_weeks:
   true`.

Annual: reuse the existing annual-review endpoints; the heartbeat for
the week the review is due links to it rather than duplicating.

### 5. Preference center

Extend `DeliveryPreferences`:

```ts
heartbeat_cadence: 'weekly' | 'monthly' | 'off'   // default weekly
heartbeat_quiet_weeks: boolean                      // default false
domains_muted: ReadinessComponentKey[]              // default []
member_scope: 'all' | 'mine'                        // default 'all'
```

`/settings` → "Notifications" card: channel order, quiet hours, digest
mode, urgency floor, the four fields above, and a read-only list of
**exempt critical alerts** (renewal ≤7d, continuity check-in,
emergency-mode vault awareness). Every notification Oak sends gets a
footer line "Why you got this · Manage" deep-linking here.

### 6. Web

- `/` → new `ReadinessFeed` component above the inbox preview: summary
  header + event cards (icon by type, direction chevron, member chip,
  evidence disclosure, feedback row). `ReadinessSparkline` stays; feed
  cards for `score_moved` link to it.
- `/member/[id]` → the same component filtered to `member_id`.
- `/scenarios` list → "Watching" toggle + last-delta badge per scenario.
- `/settings` → Notifications card.

## Acceptance tests

API (`apps/api/src/feed/__tests__/`, fake-collection style like
`profile-review.test.ts`):

- `emit.test.ts`: dedupe on `dedupe_key`; never throws when the
  collection lacks `updateOne`; youth mode strips `value_minor`.
- `score-moved.test.ts`: two snapshots 74→82 emit `attention`/`up`
  with evidence; 74→76 emits `info`; identical emits nothing.
- `scenario-watchlist.test.ts`: recompute delta 3.8→4.6 months emits
  `scenario_moved`; 3.8→4.1 does not; `watch:false` skipped.
- `heartbeat.test.ts`: renders a week with 1 score move + 1 renewal +
  2 pending steps; quiet week renders one-liner only when enabled;
  goes to each adult, never to a child; respects `heartbeat_cadence:
  'off'` except for exempt criticals.
- `feedback.test.ts`: `not_relevant` creates a 90-day mute honoured by
  the emitter; the muted event is still listed with `muted_reason`.

Web (`vitest` + jsdom): feed renders 0 / N events, collapses
`sweep_quiet`, feedback POST fires, youth mode hides amounts.

Golden eval: none (no detector change).

## Sizing

| Piece | Size |
|---|---|
| Event model + emit helper + schema | S |
| 10 emitter hooks | M |
| Scenario watchlist job | S |
| Feed read API + feedback/mutes | S |
| Heartbeat job + renderer + router type | M |
| Preference center (API + UI) | M |
| Web feed component + placements | M |

Total: **~L**, splittable into three PRs: (a) events + feed read + web
feed, (b) heartbeat + prefs, (c) watchlist + feedback/mutes.

## Explicitly out of scope

- Any new autonomous action — the feed narrates, never acts.
- Behavioural signals from Open Banking (PRD-133 / G8) — when feeds land
  they become emitters here, nothing in this PRD depends on them.
- "Families like yours" comparisons — no population data.
- Pushing the feed to children's devices.
