# PRD-101: Live AI assistant (replace the hardcoded response map)

## Problem

The in-app assistant (`/assistant` in `apps/web`, backed by `fetchAIResponse`
in [apps/web/src/lib/api.ts](../../apps/web/src/lib/api.ts)) is a
client-side keyword match against an 11-entry hardcoded string map
(`AI_RESPONSES`), falling back to one generic sentence for anything that
doesn't match. There is no backend call at all — nothing reasons over the
tenant's actual data. Verified live: asking it an off-script question
("Should I sell my house to pay off debt faster?") returns the literal
fallback string, and the UI itself honestly labels it "Sample answer —
connect your data for a personalized response."

ARCHITECTURE.md already names this "a known, honest gap," and it's the
single most visible place where the product's core promise — "Oak
understands your family's life... and reasons over that model" — doesn't
hold up, since it's a chat surface every family will try immediately.

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
Origin's AI Advisor is the reference point competitors will be judged
against — deterministic math grounded in the user's real accounts, not
generic templated output. Agent Oak doesn't need to match Origin's
CFP-exam-scoring breadth (tax, estate, investing) in this PRD — only
needs to stop being *worse than a FAQ page* on the one domain it already
has real data for (financial profile + the 4 family detectors). That's
the honest, achievable bar for v1.

## Who it's for

Every family using Agent Oak, the moment they open `/assistant` and ask
anything not in the 11-entry map.

## What "done" looks like

The assistant answers using the tenant's real submitted financial profile
and generated insights, via an actual LLM call — not sample data, not a
keyword match. It keeps the existing "informational only, not financial
advice" disclaimer and degrades gracefully (not a 500) when no LLM provider
is configured, since `apps/api` already boots fine with `"provider":"none"`
today.

The return shape `{ content: string; isLive: boolean }` already exists in
`fetchAIResponse` with `isLive` hardcoded to `false` — this feature is
finishing something the code already anticipated, not inventing a new
contract.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** The assistant explains and
summarizes the tenant's own data. It never drafts, sends, or acts on
anything in this PRD's scope — see PRD-103 for the Tier 1 follow-on.

## Scope

- **Backend**: new authenticated route, e.g. `POST /assistant/ask`, in a
  new `apps/api/src/routes/assistant.ts`, registered alongside the other
  family routes in `server.ts`. Assembles context from the tenant's stored
  `family_financial_profile` document ([family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts))
  and their open insights (via the same collection `insights.ts` reads),
  then calls an LLM via `createLlmRouterFromEnv` / `getTenantLlmConfig`
  (already used elsewhere in `server.ts` for workflow-adjacent and
  scoring paths) with a system prompt that bakes in the informational-only
  framing. Reuse the existing `LlmResponseCache` / `LlmBudgetGuard`
  plumbing already imported in `server.ts` rather than adding new budget
  infrastructure.
- **Frontend**: `fetchAIResponse` calls the new route first; on any
  failure or "no provider configured" response, falls back to the existing
  `AI_RESPONSES` map/generic sentence with `isLive: false` — so the offline
  fallback stays as a real degradation path, not dead code to delete.
- **Out of scope**: any action-taking, drafting, or connector calls from
  the assistant (that's PRD-103 and beyond); multi-turn memory past the
  current session; voice; changing the disclaimer copy or removing it.

## Success metrics

- **% of assistant questions answered with `isLive: true`** (vs. falling
  back to the hardcoded map or a provider-unavailable state) — the
  headline metric; target >90% once an LLM provider is configured in
  production.
- **Follow-up-question rate** on assistant sessions — a live, grounded
  answer should invite a follow-up ("what about Jordan's cover?") the way
  a dead-end fallback sentence never does; track session depth as a proxy
  for whether the answers feel worth continuing to ask.
- **Zero regressions** in the "no provider configured" fallback path —
  this is a reliability floor, not a growth metric, but a single 500 here
  breaks the whole page.

## Acceptance criteria

- Given a tenant with a submitted financial profile and generated insights,
  `POST /assistant/ask` with a question returns content that references
  the tenant's actual numbers (not a fixed string) and `isLive: true`.
- With no LLM provider configured, the route returns a clean fallback
  response (`isLive: false`, no 500).
- A test that would fail against the old hardcoded map — asserting the
  response differs for two tenants with different profile data — is the
  regression guard per CLAUDE.md's "new backend logic needs a test that
  would fail without it."
- No new external side effects; existing disclaimer text is preserved
  verbatim in the response or the surrounding UI.
