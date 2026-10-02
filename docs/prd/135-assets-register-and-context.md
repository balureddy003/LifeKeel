# PRD-135: Assets register + household context (gap 8's non-sensitive slice)

## The gap

Audit row 8 — the twin knows nothing about **health, real assets, family
context, or individual preferences** — bundled four domains that don't
share a risk profile. Medical records are GDPR special-category and stay
deferred (no product need justifies the risk surface yet). Two of the four
are the same sensitivity class as data already collected:

- **Real assets** — property, vehicles, savings accounts, valuables. No
  medical data, no regulated advice. Estate planning and the continuity
  switch both get sharper when Oak knows what the family actually owns.
- **Family context** — the free-text facts profiles can't express
  ("we're a blended family", "the flat in Leeds is Mum's"). Ask Oak's
  answers are noticeably poorer without them.

**Individual preferences** stay deferred: modeling decision-rights
properly needs the consent model to mature past organizer-centric
rosters first.

## What shipped

### Assets register (`apps/api/src/routes/family-assets.ts`)

- `GET /family/assets` — entries + `total_minor` / `by_kind` summary.
  Adult members only (children get 403 — same boundary as the twin).
- `POST /family/assets` — `{ kind, name, value_minor, notes? }`; kinds:
  property, vehicle, savings_account, investment, valuable, other.
- `PATCH /family/assets/:id` / `DELETE /family/assets/:id` — value and
  notes stay editable because declared values drift.
- Tenant-scoped `family_assets` collection; declared values in minor
  units like everything else.
- `/assets` page (web) — kind picker, GBP input, totals card,
  `Money`/`MoneyText` redaction in child mode.

### Household context note (`family-group.ts` + `assistant.ts`)

- `context_note` on `FamilyGroupDoc` — organizer-editable via
  `PATCH /family/context` (≤500 chars, the same constraint class as
  member names).
- A "Household Context" card on `/settings` (organizer-only) with
  "please don't include medical details" guidance in the copy.
- `buildContext` in `assistant.ts` appends the note to Ask Oak's
  assembled context — it's user-authored background, labeled as such,
  and deletable by clearing the field.

## What deliberately did NOT ship

- **Medical/health records** — GDPR special-category. Not gated by
  engineering effort but by proportionality: nothing in the current
  product needs it enough to justify storing it. Revisit only with a
  named product requirement and a DPIA-style pass.
- **Per-member preference modeling / decision-rights** — needs the
  consent model to mature (today everything is organizer-centric);
  building it now would produce a facade.
- **Asset valuation feeds** (house-price APIs, vehicle valuations) —
  declared values only; auto-valuation is a connector problem (PRD-133's
  path is the template).

## Trust tier

Tier 0 — storage + context only. Nothing reads assets as investable
capital, nothing recommends products against them.
