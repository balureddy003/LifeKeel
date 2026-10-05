# PRD-103: Tier 1 "prepare" actions — Keel drafts, a human sends

## Problem

Every insight today is Decide/Escalate-shaped but not Prepare-shaped: an
insight moves through `identified → approve/dismiss/archive`
([insights.ts](../../apps/api/src/routes/insights.ts)) with no
intermediate step where Keel actually does anything to reduce the family's
effort. ARCHITECTURE.md's roadmap names this the natural next step: "Keel
drafts something — a checklist, a pre-filled form, a draft email — but a
human sends/submits it... stays Tier 1."

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
This is not a novel pattern to invent — it's the emerging 2026 fintech
consensus for agentic HITL design: the agent drafts, plans, and proposes;
a human owns anything that sends, pays, commits, or deletes. "Never
auto-send" is the load-bearing phrase across the current guidance. The bar
for this PRD isn't "be cautious for caution's sake" — it's "match the
pattern every serious fintech agent design converges on," which happens
to also be what CLAUDE.md's trust-tier model already specifies
independently.

## Who it's for

Families who get a protection-gap or (post-PRD-102) renewal-window insight
and would act on it, but won't, because drafting the actual outreach is
the part that makes them close the tab.

## What "done" looks like

A new insight action, `insight.prepare`, available on eligible insights
(starting with the existing `family_protection_gap` rules and PRD-102's
renewal-window rule). Triggered by an explicit "Draft this for me" button
— never automatic — it generates a draft artifact (e.g., "Email to your
insurer asking about renewal terms," pre-filled with the insight's actual
numbers) stored alongside the insight, fully editable, with exactly two
exit actions: **copy to clipboard** and **open in your email client**
(`mailto:`). There is no send button anywhere in this feature, on purpose.

## Trust tier

**Tier 1 — Decide + Prepare.** Not Tier 2: no per-action consent flow is
needed because nothing external ever happens — the draft never leaves the
app except through the user's own email client, which they control after
that point. If a future PRD proposes Keel sending on the family's behalf,
that is a new, separately-justified Tier 2 decision per CLAUDE.md's rule
("name its tier in the PR description... if you can't confidently name
one, it's not ready to ship") — not an incremental extension of this one.

## Scope

- **Backend**: extend the insight document with a `draft` field
  (content, `generated_at`, `edited_at`) populated on-demand by an LLM
  call, reusing PRD-101's LLM plumbing (same router, same budget guard) —
  don't stand up a second LLM integration path. New route or extension to
  the existing insight action routes in `insights.ts`
  (`action_type: 'insight.prepare'`, matching the existing
  `insight.approve`/`insight.dismiss` pattern already in that file).
- **Frontend**: "Draft a message" affordance on eligible insight cards; a
  review/edit textarea; "Copy" and "Open in email" (`mailto:`) buttons.
  Explicitly no "Send" button, no outbound API call, no stored recipient
  credentials.
- **Guardrail, stated loudly because it's the entire point of the
  feature**: this code path must never touch the existing SendGrid
  integration (`@sendgrid/mail`, already a dependency for password-reset
  and other transactional email) or any other outbound-send capability.
  That's the line between Tier 1 and Tier 2 — enforce it in code review,
  not just in this document.

## Success metrics

- **Draft → copy/open rate** — of drafts generated, what fraction the user
  actually copies or opens in their email client (vs. abandoning). This is
  the feature's entire value proposition; if it's low, the drafts aren't
  good enough to act on, which is a prompt-quality problem to fix before
  ever considering Tier 2.
- **Insight action rate, prepare-eligible vs. not** — compare
  approve/dismiss/act rates on insights that got a "Draft this for me"
  button against ones that didn't, as the causal case for whether
  Prepare actually reduces the friction ARCHITECTURE.md's roadmap
  predicts it will.
- **Zero occurrences** of the guardrail above being violated — a code-level
  test asserting no path from the new route reaches the SendGrid client is
  a release-blocking check, not a nice-to-have.

## Acceptance criteria

- Given an eligible insight, triggering `insight.prepare` generates a draft
  referencing the insight's real numbers (not generic boilerplate).
- The UI renders no send affordance anywhere in this feature.
- A test asserts the `insight.prepare` code path has no reachable call
  into `@sendgrid/mail` or any other outbound-send integration.
- Draft edits by the user persist and are reflected in the copy/`mailto:`
  output.
