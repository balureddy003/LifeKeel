# PRD-004 (backfill): Email/Gmail connector and Inbox

*Retroactive PRD. See [001](001-family-onboarding-twin-graph.md) for the
template note.*

## Problem it solves

Financial life arrives by email — insurance renewal notices, mortgage
rate changes, investment statements — and nobody reads all of it
carefully. Scanning connected email for financially-relevant messages is
the second passive-intake channel the data-intake principle calls for,
alongside document upload.

## Market bar

See [000](000-market-landscape-and-positioning.md). None of the three
reference categories do this well: money apps (Monarch, Copilot) read
bank feeds, not email; life-admin apps (Trustworthy, Everplans) store
documents you upload yourself, not documents that arrive passively. An
AI-summarized financial inbox is a genuine differentiation opportunity if
executed well — which makes the current sample-data gap (below) more
costly than it would be for a me-too feature.

## Who it's for

Households who connect an email account and want the financial signal
extracted from the noise of a normal inbox.

## What's shipped

`POST /connectors/email/scan` and a dedicated `scanAllConnectedInboxes`
cron job (registered in `server.ts`, confirmed still running post-cleanup)
feed [family-inbox.ts](../../apps/api/src/routes/family-inbox.ts)'s
`inbox_items` collection (source, AI summary, action label/type,
priority). Verified live: with no email connected, the Inbox page shows
clearly-labeled sample items ("AI Summary [Sample] — These are sample
inbox items. Connect your email to receive AI-summarized financial
notifications automatically") rather than pretending to have real data —
an honest empty state, not a fabricated one.

## Trust tier

**Tier 0.** Summarizes and surfaces; the only mutation is `dismiss`. No
inbox item currently triggers an action.

## Gaps to reach world-class

- **Read-only scanning, not enrichment.** A scanned "mortgage rate change
  notification" doesn't currently update the financial-profile's
  `mortgage_outstanding_minor` or trigger re-evaluation — same structural
  gap as document upload (PRD-003) and the same fix: email-derived
  signals should flow into the same profile schema, not sit in a parallel
  `inbox_items` collection with no connection to the detectors.
  `action_type: 'update'` already exists on the inbox item schema, which
  suggests this was the intent — it's just not wired through yet.
  Connecting it turns the Inbox from "things to read" into "things Keel
  already acted on your behalf to keep the Twin current" (Tier 0,
  passively — no send/act involved, purely updating Keel's own model of
  the family).
- **No connector beyond Gmail is real.** `connectors/gmail.yaml` itself
  says `status: planned` — "live ingestion is not wired" per its own
  header comment. Outlook/Yahoo/iCloud are advertised in the Settings copy
  ("Connect any email provider — Gmail, Outlook, Yahoo, iCloud") but only
  Gmail has any implementation. This is a marketing/reality gap worth
  closing either by building the others or trimming the copy to match
  what's actually connectable today.
- **`action_type: 'renew'/'compare'` have no corresponding UI action** —
  the schema anticipates richer interactions than "read and dismiss"
  (renew a policy, compare quotes) that don't exist yet; natural overlap
  with PRD-103's Tier 1 prepare pattern once that ships.

## Success metrics

- **Email-connection rate** — % of active households with an email
  connected, the gate before any of this feature's value exists.
  Convert-to-connect friction (OAuth flow) should be tracked separately
  from feature quality.
- **Inbox item action rate** (not just dismiss) — the feature currently
  offers only "dismiss"; if that's the only action ever taken, it signals
  the missing renew/compare/update affordances above are the real
  blocker, not summarization quality.
- **False-positive rate on "financially relevant"** — the classification
  step (`email-classify` per the test file name seen in `apps/api`) needs
  a precision metric; a noisy inbox that surfaces grocery receipts as
  "financial" trains users to stop reading it.
