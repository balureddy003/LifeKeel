# Intent 69: FAB stack anchored above the bottom nav

**Problem** — screenshot review (2026-10-25): the SOS + gold floating buttons sat at bottom-52/bottom-32 — 208/128px up on tall phones — hovering mid-screen over card content at first paint.

**Done looks like**
- Both buttons sit inside the page's pb-56 reserved band, stacked conventionally just above the bottom nav; no card overlap at rest.

**Constraints**
- Tier 0 — layout only; the pr-16 text gutter behaviour is unchanged.

**Out of scope** — redesigning the FAB set.

**Becomes** — PRD in docs/prd/ on acceptance.


**Status: implemented** — bottom-40/bottom-20; verified via re-screenshot (PR #275).
