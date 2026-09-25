# PRD-113: on-device inference for crisis-flow drafts

## Problem

Agent Oak's most sensitive single flow — the life-event playbooks
(bereavement, disability, medical) this session spent the most
validation effort on — routes its one real LLM call through a cloud
provider like everything else. `renderPlaybook()` itself is fully
deterministic (template text filled with real profile numbers, no LLM
involved); the actual generation touchpoint is narrower and more
specific than "the crisis flow" broadly: `POST
/family/life-events/:id/steps/:stepId/prepare` in
[life-events.ts](../../apps/api/src/routes/life-events.ts), which calls
[generateDraft()](../../apps/api/src/insights/generate-draft.ts) to turn
a rendered step's body into a short outreach-email draft. That's the one
moment a bereaved family's situation — who died, what policies are
involved — leaves the device.

## Market bar

No competitor researched (see
[competitive-differentiation-deep-dive-2026.md](../reviews/competitive-differentiation-deep-dive-2026.md#angle-4--technicalprivacy-on-device-inference-for-the-most-sensitive-flows))
offers on-device inference in the family life-admin or AI-money-app
categories — everyone routes through cloud inference unconditionally.
2026 tooling (WebGPU, WebLLM/MLC) made browser-side inference genuinely
practical, not a research project, which is what makes this a real,
buildable claim rather than aspirational.

**Grounded correction to the original research:** WebGPU mobile support
is real but not universal in 2026 — iOS 26+ Safari has full support;
Android needs Chrome 121+ on Android 12+ with a Qualcomm/ARM GPU; Firefox
Android doesn't yet. Since a bereaved or panicked family is statistically
more likely to be on a phone than a desktop, this **must** degrade
invisibly to the existing cloud path on unsupported devices — a feature
that silently doesn't work on the platform it matters most on would be
worse than not shipping it. Smallest usable instruct models run
~200MB–2GB (4-bit quantized, MLC format), a one-time download cached in
IndexedDB, not per-request.

## Who it's for

A privacy-conscious family who'd rather a bereavement/disability draft
never touch a cloud provider — an opt-in for people who care enough to
turn it on, not a silent default-on behavior change for everyone.

## What "done" looks like

A Settings toggle ("Generate crisis drafts on this device") appears only
when `navigator.gpu` indicates WebGPU support; absent or unsupported
hardware, the row doesn't appear at all — no dead toggle, no error state
to explain. Turning it on triggers an explicit, disclosed one-time model
download (size shown before the download starts, progress shown during
it) into IndexedDB via WebLLM. Once enabled, opening the "prepare a
draft" affordance on a life-event step
([LifeEventPlaybookClient.tsx](../../apps/web/src/app/life-events/[eventId]/LifeEventPlaybookClient.tsx)
only — this PRD's crisis-flow scope, not the general Ask Oak assistant or
regular insight drafts, both of which stay on the existing cloud path)
runs inference **entirely client-side**, using the step's already-
fetched `body` text as context and mirroring `generateDraft()`'s exact
system prompt and constraints. Nothing about the insight, the family's
policies, or the draft's content is sent to any server for that request.
A tiny audit-only ping (no content, just the fact it happened) still
reaches the backend so the feature's usage is observable the same way
every other action is. If the toggle is off, or WebGPU is unsupported, or
local generation itself fails for any reason, the flow falls back to the
existing cloud `POST .../prepare` path unchanged — never a dead end.

## Trust tier

**Tier 1 — Prepare, don't send**, identical to the existing draft
feature it's replacing the transport for. Nothing about the trust tier
changes: this PRD changes *where* the draft is generated, never *what*
happens to it afterward — a human still reviews and sends it themselves,
exactly as today. CLAUDE.md's "second rule" applies identically to the
on-device output: the client-side system prompt must independently
enforce "never recommend a specific product or provider," since there's
no backend to validate a locally-generated draft the way a server-side
call could be. This is a real, named risk (a small local model could in
principle drift from its instructions with nothing catching it) —
mitigated, not eliminated, by the fact that a human already reviews every
draft before sending, on-device or not, so a bad local draft costs a
moment's edit, not a sent recommendation.

## Scope

1. **Support detection** — a small `apps/web/src/lib/onDeviceLlm.ts`
   module: `isOnDeviceSupported()` checks `navigator.gpu` existence (best-
   effort; a true capability probe requires requesting an adapter, done
   lazily on first real use, not on every page load).
2. **Settings toggle** — a new row in Settings, visible only when
   supported, persisting the choice in `localStorage` (a per-device
   preference, not synced — the whole point is this device's own
   inference). Toggling on triggers the model download with visible
   progress; toggling off just stops using it (the cached model stays,
   no need to force a re-download if re-enabled).
3. **Local generation** — `generateDraftOnDevice(stepBody: string):
   Promise<string | null>`, using WebLLM
   (`@mlc-ai/web-llm`, new dependency) with a small instruct model
   (default: a ~1–3B quantized model from WebLLM's catalog — the exact
   id is a named constant, not hardcoded inline, so it can be swapped
   after an empirical quality check against `generateDraft()`'s current
   cloud output; that quality comparison is a fast-follow, not blocking
   this PRD's ship, since Tier 1 review is the safety net either way).
   System prompt is byte-identical in intent to `generate-draft.ts`'s
   (draft-only, no invented details, generic sign-off, 2-4 sentences).
4. **Wire into the one call site in scope** —
   `LifeEventPlaybookClient.tsx`'s draft affordance: when the toggle is
   on and support was confirmed, call `generateDraftOnDevice(step.body)`
   instead of `prepareLifeEventStepDraft(eventId, stepId)`; on any local
   failure (model load error, generation error, unsupported mid-flow),
   fall back to the existing cloud call transparently — the UI never
   shows a raw error for this, just proceeds via the path that works.
5. **Audit-only ping** — a new, minimal `POST
   /family/life-events/:id/steps/:stepId/prepare-on-device` route,
   content-free (no body, no draft text), that only logs a new
   `AuditAction` (`'insight.prepare_on_device'`) — gives the success
   metrics below something real to measure without compromising the
   privacy property the feature exists for.

Out of scope: the general Ask Oak assistant (`POST /assistant/ask`) and
regular insight drafts (`InsightGateClient.tsx`) — both stay cloud-only;
open-ended assistant chat is a materially harder quality bar for a small
local model than a narrow, templated draft-polish task, and revisiting
that is a separate, later decision, not bundled into this one. Any
attempt to sync the on-device preference across a family's devices (it's
deliberately per-device, matching where the model actually lives).
Choosing a non-default model or exposing model choice in the UI.

## Success metrics

- **Adoption**: % of eligible (WebGPU-supported) devices that turn the
  toggle on.
- **Fallback rate**: on-device attempts that silently fall back to cloud
  — a high rate here means the local path is unreliable in practice and
  needs attention, not that the feature should be removed.
- **Draft quality, proxy signal**: how often an on-device draft is sent
  unedited vs. edited before sending, compared to the same ratio for
  cloud drafts (requires no new tracking beyond what a future "was this
  draft edited" signal would need generally — noted as a metric to add,
  not blocking this PRD).

## Acceptance criteria

- The Settings toggle is absent on a `navigator.gpu`-less browser (a
  jsdom-based test can only assert the absence-when-unsupported branch,
  since real WebGPU inference can't run in CI — the model-loading and
  generation paths themselves are manually verified, not unit-tested
  end-to-end).
- With the toggle on and support confirmed, opening a life-event step's
  draft affordance never calls `prepareLifeEventStepDraft` (mockable/
  spyable in a test) — confirms the client-side path is actually taken,
  not just present in the bundle unused.
- With the toggle off, or on an unsupported device, the existing cloud
  path behaves byte-identically to before this PRD — a regression test
  against `LifeEventPlaybookClient.tsx`'s existing draft-affordance
  tests.
- The on-device system prompt, read as a string constant, forbids
  recommending a specific product/provider — the same grep-style
  guardrail pattern PRD-111 established, applied here too.
- No draft content, insight text, or profile data appears in any network
  request when local generation succeeds — verified by asserting the
  mocked `fetch`/`prepareLifeEventStepDraft` path is never invoked on the
  local-success branch.

## Implementation status — 2026-09-19

Shipped, matching this PRD's scope. `onDeviceLlm.ts` dynamically imports
`@mlc-ai/web-llm` (new dependency) only when actually used. `StepDraft`
in `LifeEventPlaybookClient.tsx` tries on-device first when both the
localStorage flag and `navigator.gpu` support are true, falling through
to the existing `prepareLifeEventStepDraft` cloud path on any failure —
the existing behavior is byte-identical when either is false. The
Settings toggle is hidden entirely (not shown-disabled) on unsupported
browsers. An audit-only ping (`insight.prepare_on_device`, no content)
fires fire-and-forget after a successful on-device generation.

**Honest gap, as the PRD itself flagged:** this codebase's own test
convention is `.test.ts` logic tests only — no `.tsx`/RTL component
rendering exists anywhere to mirror, so the actual UI branching in
`StepDraft` (does it really call `generateDraftOnDevice` before
`prepareLifeEventStepDraft`?) is manually verified, not unit-tested, same
as the PRD's own acceptance criteria anticipated for anything requiring
real WebGPU. What *is* unit-tested: `isOnDeviceSupported`'s true/false
branches, the enable/disable persistence round-trip, and a guardrail
confirming the system prompt forbids naming a product/provider —
6 tests, all passing. Full gate clean otherwise.
