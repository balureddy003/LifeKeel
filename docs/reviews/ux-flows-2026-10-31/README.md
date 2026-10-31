# UX flow review, 31 Oct 2026 (phone width, 375 x 812)

Local stack (API, Mongo, Redis, Next dev) on `main` at #355, walked in the in-app browser. Screens
are in this folder. The seeded household is the one from `apps/api/e2e/seed-ui.mjs`.

| # | Flow | Screen | Verdict |
|---|------|--------|---------|
| 1 | Landing, logged out | 01-landing | Clear, one primary action |
| 2 | Signup | 02-signup | Three fields or Google |
| 3 | Sign in | 03-sign-in | Fine |
| 4 | First brief, step 1 | 04-first-brief-form | Three money fields and the date on one screen |
| 5 | Home (seeded) | 05-home | Works; confidence question sits above the first action |
| 6 | Obligations map | 06-obligations-map | Clear; names who and when |
| 7 | Employer cover | 07-employer-cover | Raw ISO date fixed here |
| 8 | Claim packet | 08-claim-packet | One tap per policy |
| 9 | Family | 09-family | Works; "Full map" is the obligations map under another name |
| 10 | Financial profile | 10-financial-profile | Five steps; the deepest form in the app |
| 11 | Ask Keel | 11-ask-keel | Starter questions, no sign-up wall |
| 12 | Life events | 12-life-events | Seven kinds of bad day, one tap |
| 13 | Job loss | 13-job-loss-form | Everything optional, one button to a plan |

## Fixed in this change
- A third "Assistant" button in every page header, next to the floating button and the tab bar, removed.
- Raw `2026-09-01` style dates on Employer cover and Settings > Automation now read "1 Sep 2026".
- The "Who does this affect?" select on a life event had no accessible label; it has one now.

## Found, not fixed (needs a decision)
- Home asks a confidence question (1 to 5) before the first action card.
- Family's "Full map" link is the obligations map; the two names differ.
- Financial profile is five steps; the brief path is the light one and the profile is the deep one.

## Not walked
Partner invite and join on a second device, the share-link recipient page, document upload, Safari, a real screen
reader, and the other seven briefs.

Screens taken in a background tab show pages mid-fade; those were retaken in the foreground.
