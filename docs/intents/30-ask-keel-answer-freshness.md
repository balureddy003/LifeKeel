# Intent 30: Ask Keel answer freshness and session bleed

**Problem** — The critic review reports Ask Keel is "fast and mostly
accurate" but shows occasional lag and previous-answer bleed — figures from
an earlier answer appearing after the underlying data changed. Combined with
the freshness gaps in intent 22, stale assistant output is the highest-trust
surface to get wrong: it's the thing a user checks the score against.

**Done looks like**
- Reproduce the bleed: a profile/policy change followed by the same
  question must never echo the pre-change figure. Likely surfaces: cached
  context in the member twin / profile snapshot assembled for the call
  (`getMemberTwin`, PRD-122) or conversation context carrying stale numbers.
- Answers are grounded on a snapshot taken at request time; if conversation
  history carries prior figures, the current numbers win and the answer
  reflects them.
- Latency investigated against the deadline/cancellation work in PRD-211 —
  a regression there (e.g. retry path firing) is fixed, not worked around.
- A test mutates a profile field between two asks and asserts the second
  answer uses the new value.

**Constraints**
- Trust tier: 0 — assistant remains read-only.
- Model calls stay behind the AI task gateway (`definitions/ai-tasks.yaml`);
  this intent aligns with PRD-212's direction (factual questions resolved
  deterministically with provenance — the fix may be "resolve, don't
  generate" for figure answers).
- Data/privacy: unchanged task-minimized context.

**Out of scope** — new assistant capabilities, PRD-212's full resolver
build (this intent fixes the *freshness* bug, which the resolver would also
subsume).

**Becomes** — fast-path fix PR if the root cause is a stale snapshot/cache;
otherwise folded into PRD-212's scope.

---

**Status: honesty layer shipped — PR #245.** Investigation found no
server-side bleed path: `/assistant/ask` is stateless (no history sent, no
answer cached; every ask reloads live data). What users perceived as bleed
was an undated older answer still in the transcript — now stamped with
"From your data as of HH:MM" via `data_as_of`. Remaining: stale *figures*
inside a fresh answer are the upstream freshness problem → intent 22;
latency → PRD-211.
