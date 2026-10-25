# Intent 37: Interruptible setup and cross-device continuity

**Problem** — The device test found the multi-step financial profile
demanding on mobile (repeated number entry, no auto-advance, no observed
numeric input modes) and found no evidence a user can start setup on phone
and continue on desktop without re-entry. For a busy parent, an
uninterruptible 5-step form is abandonment bait — the "save & resume" gap
compounds intent 28's missing pre-fill.

**Done looks like**
- Every financial-profile step auto-saves (server-side, so it survives
  device switch) — a "saved" indicator is visible, and a failed save shows
  "This step couldn't be saved — your answers are kept" with retry rather
  than losing input.
- A persistent "Continue setup" card on Home links to the first incomplete
  step while profile completeness < 100% (the existing
  `profileCompleteness` signal on `apps/web/src/app/page.tsx` is the
  natural driver).
- Money/number fields use `inputMode="decimal"`/`numeric` and sane
  steppers so the right keyboard appears.
- A returning session on a different device resumes at the same step with
  the same values — verified, not assumed.

**Constraints**
- Trust tier: 0 — profile writes the user already performs.
- Regulated-advice check: n/a.
- Data/privacy: auto-saved partial profiles are the same tenant-scoped
  profile record — covered by existing erasure; the honesty rule from
  PRD-114 applies (a partially-saved profile doesn't fake "evaluated"
  state).

**Out of scope** — offline-first drafts/local-only storage, real-time
multi-device sync, the "saved locally vs synced" indicator's deeper offline
story (a small honest label yes; an offline mode no).

**Becomes** — PRD in docs/prd/, adjacent to intent 28's wizard UX work
(28 is validation + pre-fill; 37 is autosave + resume + input modes — they
should land together or adjacent).

---

**Status: implemented — PR #257.** Every done-criterion is now met:
per-step server autosave + "couldn't be saved — answers kept" banner
(pre-existing), "Profile X% complete" resume affordance on Home
(pre-existing), `inputMode="decimal"` on money fields (pre-existing),
and — new here — a returning session lands on the first incomplete step
on any device, since the resume point derives from the server-stored
draft. `?step=` deep links still win.
