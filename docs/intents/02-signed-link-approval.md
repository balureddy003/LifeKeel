# Intent: signed-link approval strengthening

**Problem** — `POST /a/:token` is unauthenticated and runs the full
`approveInsightDecision` including real SendGrid/Twilio/CRM dispatch, for 7
days, for anyone holding the link. The confirmation page shows hypothesis text
but no exact-effect preview (unlike authenticated `action-preview`).
`DELIVERY_SIGNING_SECRET` falls back to `'change-me'`. `approvedBy` is required
at call sites but never persisted on per-action `ActionReceipt`s.
Evidence: `routes/insights.ts:1101-1143`, `delivery/delivery-router.ts:116-117`,
`actions/action-executor.ts:238-250`.

**Done looks like**
- `GET /a/:token` renders the same classified effect preview as in-app
  `action-preview` (channel, recipient, exact effect).
- `POST` requires authenticated continuation (session or magic-link step-up)
  before any external dispatch; dismiss/snooze may keep bearer semantics only
  after a documented threat decision.
- `ActionReceipt` persists `approved_by` + `approved_via` (asserted by the
  Stage-0 fitness test).
- Boot fails in production without `DELIVERY_SIGNING_SECRET`.

**Constraints**
- Trust tier touched: 2 — strengthens the approval gate, does not widen it.
- Regulated-advice check: preview copy must stay informational, no provider
  steering.
- Data/privacy limits: link payload stays non-content-bearing; token TTL may
  shorten.

**Out of scope** — new action types; changing in-app approval UX.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
