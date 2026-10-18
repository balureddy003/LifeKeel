# PRD-144: Email signal agent — read-only, opt-in, matched messages only

## Problem

PRD-004 shipped Gmail scanning and an AI-summarised inbox, but its own gap
analysis says scanned signals sit in `inbox_items` with no path into the financial
profile, and only Gmail is real (`connectors/gmail.yaml` is `status: planned`;
the Settings copy overstates other providers). Reading a mailbox is the most
trust-sensitive thing the product can ask for; the design has to be narrower than
the feature suggests.

## Who it's for

Keel Plus users who choose to connect a mailbox. Never default-on.

## What "done" looks like

1. **Read-only, narrowest scope** the provider offers. Gmail's `gmail.readonly` is
   what the connector requests today; record whether a narrower scope can do the
   job and what the provider's security assessment requires before launch.
2. **Match first, read second:** sender-domain and subject patterns for a fixed set
   of categories (renewal notices, statements, expiry reminders) select messages;
   only matched messages are fetched in full. The rest of the inbox is neither read
   nor retained.
3. Matched attachments enter the PRD-143 pipeline exactly as if the user had uploaded
   them, including the confirm-before-commit step. Email-derived values never reach
   the profile without that gate (this closes PRD-004's enrichment gap safely).
4. A visible **"what we've read"** log (message date, sender, category, what was
   extracted), a one-tap disconnect, and revoke-and-delete that removes derived data.
5. Incremental sync with provider change notifications where available, plus a
   scheduled fallback. Failures surface through the existing connector-health alert.
6. Settings copy lists only providers that actually work.

## Constraints

- **Trust tier:** 0. Read and extract only. No message is sent, replied to, labelled or
  deleted. Outbound drafts remain PRD-103 (Tier 1, human sends).
- **Regulated-advice check:** extracted facts populate the profile; no output compares
  or recommends products.
- **Data/privacy:** only through PRD-142's registry. Message bodies are processed
  transiently and not kept beyond what the extracted fields and the "what we've
  read" log require. Email content is treated as untrusted input with no tool access.

## Builds on

PRD-004, `apps/api/src/email/gmail-oauth.ts`, `apps/api/src/jobs/email-scan.ts`,
`connector-health-alert.ts`, PRD-143, PRD-142.

## Success metrics

Share of connected users who keep the connection at 30 days; fields confirmed per
connected user; disconnect-and-delete rate (a signal that it feels unsafe); matched
messages that turn out irrelevant.

## Out of scope

Outlook, Yahoo and iCloud (trim the copy instead), reading outside matched
categories, sending or modifying mail, reading other people's mailboxes.

## Open questions

Provider security-assessment cost and timeline for restricted Gmail scopes. Confirm
before promising a launch date; this PRD does not assume it.

## Becomes

docs/prd/144-email-signal-agent.md
