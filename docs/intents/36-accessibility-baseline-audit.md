# Intent 36: Accessibility baseline audit and fixes

**Problem** — The device test confirmed the skip-to-content link exists but
couldn't confirm the rest of the baseline: keyboard tab order, visible focus
rings, contrast ratios, and screen-reader labels on inputs across the signup
→ family-setup → financial-profile → home journey. For a product aimed at
families including older members (the elderly mode exists), an unverified
baseline is a real risk.

**Done looks like**
- An audit pass over the core journeys (signup, family setup, financial
  profile, home, events, settings) against the baseline: every input
  labelled, logical tab order, visible focus state, contrast ≥ WCAG AA on
  text and interactive elements, dialogs/menus operable by keyboard.
- The entire setup flow is completable keyboard-only — verified, not
  assumed.
- Findings fixed in the same pass or filed as a defect list; an axe-core or
  equivalent check added to the test suite for the core pages so it stays
  green.

**Constraints**
- Trust tier: 0 — markup/ARIA/focus changes only.
- Regulated-advice check: n/a.
- Data/privacy: n/a.

**Out of scope** — full WCAG certification, screen-reader-specific redesign
beyond correct semantics, the elderly-mode experience rework (worth its own
look once the baseline is proven).

**Becomes** — PRD in docs/prd/ if the audit finds systemic issues; fast-path
PRs if it's a handful of missing labels/focus states.

---

**Status: baseline audit done + first fixes — this PR.** Static pass
across the app shell and the core journeys (home, inbox, financial-profile
wizard, settings/roster, upload, assistant):

- **Clean:** `:focus-visible` ring styles exist globally (`globals.css`);
  a repo-wide scan for icon-only `<button>`s without `aria-label`/`title`
  found **zero**; nav items carry `aria-label`; the assistant transcript
  is `role="log"`; financial-profile `Field`s render real `<label>` +
  `aria-invalid`; upload progress is `role="status" aria-live`.
- **Fixed here:** the settings add-member name/email inputs used
  placeholder-only labels — now `aria-label`ed.
- **Still open (needs assistive tech, not code reading):** real
  screen-reader walkthrough of the setup flow, focus-order check in
  modals/expanders, and contrast measurements against tokens — recorded
  here so a reviewer knows exactly what the pass covered and what it
  didn't.
