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

## Partner invite and share link (second walk)

| # | Step | Screen | Verdict |
|---|------|--------|---------|
| 14 | Partner opens the invite link | 14-join-by-link | Three fields; does not say whose family it is |
| 15 | Request sent | 15-join-waiting | Names the organizer's family; tells them to sign in once approved |
| 16 | Organizer's home | 16-organizer-sees-request | Was: nothing. Now: "Pat Partner asked to join your family" |
| 17 | Approve | 17-approve-in-settings | Approve and Deny are labelled; now confirmed with a note and a refreshed roster |
| 18 | Brief link, signed out | 18-share-link-sign-in | Clear; returns the reader to the brief after sign-in |
| 19 | Brief link, recipient | 19-share-link-recipient | Clear; dates were raw ISO |

## Fixed in this change
- Invite: the home prompt went to Family, which has no invite control. It now opens Add Member directly, and Settings has a one-tap "Copy link" for the invite link (before, only a six-character code to read aloud).
- Organizer never learned a partner had asked to join unless they opened Settings. Home now shows "asked to join your family" with a Review link that scrolls to the request; approving shows a note and refreshes the roster.
- Brief recipient page: raw `2026-12-30` and `31/10/2026` now read "30 Dec 2026"; sign-in notice mentions the invite link as well as the email.
- Confidence scale on home broke words mid-way ("Slightl / y"); it no longer does.
- A third "Assistant" button in every page header, next to the floating button and the tab bar, removed.
- Raw `2026-09-01` style dates on Employer cover and Settings > Automation now read "1 Sep 2026".
- The "Who does this affect?" select on a life event had no accessible label; it has one now.

## Found, not fixed (needs a decision)
- Home asks a confidence question (1 to 5) before the first action card.
- Family's "Full map" link is the obligations map; the two names differ.
- Financial profile is five steps; the brief path is the light one and the profile is the deep one.

## Not walked
Document upload, Safari, a real screen reader, the other seven briefs, and a real second device (the second adult was
simulated by signing out and in on the same browser; the join and share pages only need a session).

The join page cannot name the family before the request is sent: that would need a public lookup of a family name from a
short code, which is a privacy trade I did not make unasked.

Screens taken in a background tab show pages mid-fade; those were retaken in the foreground.
