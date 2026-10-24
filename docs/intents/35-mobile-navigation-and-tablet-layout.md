# Intent 35: Mobile navigation density and tablet layout

**Problem** — The device test found no layout breakage (no horizontal
overflow at 390/768/1440px, generous tap targets ~356×61px) but the full
primary nav — Home, Inbox, Family, Finances, Events, Settings — is present
at 390px where it risks crowding, and on tablet the extra width gets a
stretched phone layout rather than real use. Mobile easiness scored 6/10
against desktop's 7.5/10.

**Done looks like**
- At phone widths the primary nav collapses to a clear bottom bar or
  hamburger with large targets; the 4–5 most-used items (Home, Events,
  Ask Keel, Family, Settings per the test's suggestion — validate against
  actual usage) are always reachable in one tap.
- At tablet width (≥768px) key screens use the space deliberately —
  e.g. family chart beside key numbers — not a wider phone column.
- No horizontal overflow maintained at all three breakpoints; nav is
  operable one-handed (targets ≥44px).
- Playwright/viewport tests or a visual pass at 390 and 768px cover the
  nav collapse and at least one two-column tablet layout.

**Constraints**
- Trust tier: 0 — layout only.
- Regulated-advice check: n/a.
- Data/privacy: n/a.

**Out of scope** — redesigning screen content itself; native-app navigation
patterns; the PWA install prompt (PRD-147's scope, though dismissal
behaviour noted in the same report should feed it).

**Becomes** — PRD in docs/prd/ covering the responsive-nav + tablet pass.
