# Intent 34: Post-login / setup routing state fragility

**Problem** — The multi-device test found that after navigation, some
viewports landed on "Create Family Group" instead of the expected dashboard
— for an account that already had a family. That suggests a race or stale
read in the family-membership gate (`apps/web/src/lib/auth-context.tsx`'s
family state feeding `AppShell.tsx`'s `ConversationalOnboarding` render).
A signed-in family member being shown "create a family" is a
trust-destroying bug, not a cosmetic one — it looks like their data is gone.

**Done looks like**
- Reproduce the race (likely: onboarding renders while `family` is still
  loading or after a failed refetch) and fix the gate so the create-family
  flow only renders when the absence of a family is *confirmed* — a loading
  or error state never falls through to "create".
- A regression test: family state loading → dashboard never flashes the
  create-family screen; genuinely family-less account → create flow renders.
- If the family fetch fails transiently, the user sees a retry, not a
  "create family" prompt that could fork a second roster.

**Constraints**
- Trust tier: 0 — client gating on existing auth/family reads.
- Regulated-advice check: n/a.
- Data/privacy: must not paper over a real authorization failure — a
  genuine 403/empty response stays an error, not a silent retry loop.

**Out of scope** — onboarding flow redesign (PRD-001 shipped it), session
model changes.

**Becomes** — fast-path fix PR if the race is localized; the reproduction
steps come first.

---

**Status: implemented** — fix in PR #243 (`fix/post-login-family-gate`). A failed
`/family` read now sets `familyLoadFailed` → AuthGate shows a retry card;
create-family only renders on a confirmed `family: null`.
