# PRD-129: Youth literacy curriculum

**Status:** Implemented
**Depends on:** PRD-124 (youth twin surface)
**Trust tier:** 0 — static informational content.

## Problem

The youth twin showed a child's savings progress but taught nothing — gap 7's "literacy" half. Content needed to be age-banded and carry the same minors-data hygiene as the rest of the youth surface.

## What shipped

### `youth-curriculum.ts` — two bands of lesson cards

- **younger** (<13): save-a-little-first, money-grows-slowly, needs-before-wants
- **teen** (13–17): compounding, what a pension is, borrowing costs, insurance-as-protection

Each card is a title + body + one "Try it" activity doable with a parent, requiring no account or purchase. Copy rules: no amounts, no products, no providers, no references to the child's actual data (their goals render separately via `savings_goals`).

### Server-side banding

`youth.lessons` rides the redacted twin payload — the same boundary that strips money picks the reading level (`age_band` drives the curriculum), so there's no client path to the wrong band.

### Web

Kid view renders a "Things worth knowing" section — collapsible cards with the lesson body and a highlighted Try-it line.

## Tests

`member-twin.test.ts` (+1 assertion +1 test): younger band serves the younger curriculum (no teen ids), teen DOB serves the teen set.
