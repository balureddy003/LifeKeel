# QA + critic review — 2026-10-24

Two complementary reviews of the live product, consolidated here and triaged
into `docs/intents/` stubs (20–33). Sources: an automated walkthrough across
demographic combinations (employee, self-employed/business-owner, single
parent, blended household, pre-retiree), and a critic/product-expert pass
walking the same personas plus a returning user.

## Combined findings → intent map

| # | Finding | Verdict | Intent |
|---|---------|---------|--------|
| 1 | Readiness score reads consistently harsher than expected (observed 22–50 across normal profiles); no component explanation shown | Fail | 20 |
| 2 | Scenarios silently fall back to "Sample scenario" or "This event could not be found" on incomplete/extreme data | Fail | 21 |
| 3 | Insight cards and "AI Explains" text can show stale figures after profile/policy updates | Partial | 22 |
| 4 | Invite shows "Not joined yet" + a code but no delivery/join status; second adult never engages | Partial | 23 |
| 5 | High-debt/zero-savings cases score correctly but get the same visual treatment as mild gaps | Partial | 24 |
| 6 | No way to distinguish step-children / shared children / different parental responsibility | Partial | 25 |
| 7 | Variable/irregular income hard to note; "second earner" toggle easy to miss | Pass | 26 |
| 8 | Upload works, but no progress feedback, no stored confirmation surface, extraction Plus-gated | Partial | 27 |
| 9 | Extreme values pass intermediate wizard steps; error only at final save; fields don't pre-fill on return | Partial | 28 |
| 10 | Home insight cards all look alike; no severity ordering | Partial | 24 |
| 11 | Signup OTP/security check intermittent; `example.com` addresses fail | Reported | 29 |
| 12 | Ask Keel occasional lag and previous-answer bleed | Reported | 30 |
| 13 | Stripe sandbox checkout launches; payment completion and Plus unlock unverified | Test gap | 31 |
| 14 | No "what would close the gap" affordance on retirement | Suggestion | 32 |
| 15 | Crisis mode: simplify to the three most important next actions | Suggestion (longer-term) | 33 |

## What both reviews agree on

Core maths (runway, cover gaps, income-loss runway) are trustworthy on clean
data. Onboarding is short and humane. The right gaps surface: missing will,
missing PoA, light life cover, no income protection, thin emergency fund.
Multi-demographic input works without breaking. The What-If/Events surface is
the strongest differentiator when data is clean.

The three highest-impact weaknesses, in both reviews' order:

1. **Score trust** — the headline number feels unfair and unexplained.
2. **Scenario reliability** — silent fallbacks destroy confidence exactly when
   the family is stressed or the data is thin.
3. **Second-adult engagement** — the invite is opaque; the "family" promise is
   half-delivered until a partner actually joins and sees the same picture.

## Noted but already covered by existing PRDs

- Family heartbeat email / narrated changes → PRD-136, PRD-138 (proposed).
- Policy extraction from uploaded documents → PRD-143 (proposed); intent 27
  scopes only the free-tier feedback gap, not extraction.
- Per-member twin / youth view prominence → PRD-117, PRD-124, PRD-129 (shipped);
  single-parent education prominence is presentation polish under intent 24.
- Role-based shared household permissions → deferred in PRD-110's scope notes;
  not written as an intent yet.

## Multi-device easiness pass (390×844 / 768×1024 / 1440×900)

Third input, same triage. Ratings: desktop 7.5/10, tablet 7/10, mobile
6/10 — no layout breaks at any width and generous tap targets, but mobile
task completion still costs more effort than a best-in-class family app.

| Finding | Devices | Disposition |
|---|---|---|
| Post-login lands on "Create Family Group" for accounts with a family | All | New intent 34 — routing/state bug, reproduce first |
| Primary nav too dense at 390px; tablet width unused | Mobile/Tablet | New intent 35 |
| Keyboard order, focus rings, contrast, SR labels unconfirmed | All | New intent 36 — audit baseline |
| No save-and-resume; re-entry across devices; no numeric input modes | Mobile esp. | New intent 37 (with intent 28) |
| Invite flow hardest one-handed; needs share sheet + status | All | Folded into intent 23 |
| Severity/score unscannable on small screens | All | Folded into intents 24/20 |
| Late validation worst with keyboard open | Mobile | Folded into intent 28 |
| Install prompt persistence/dismissal on real mobile unverified | Mobile | Feeds PRD-147 (already proposed) |

Positive confirmations worth keeping as regression coverage: zero
horizontal overflow at all three breakpoints, ~356×61px tap targets on
family-setup choices, mobile signup completes, skip-to-content present.

## PMF/competition report (fourth input)

`LifeKeel_Full_PMF_Competition_Report.pdf` — a 2-page synthesis of the same
live-testing findings plus a UK competitor scan (Capsafa, Inheritable/adeus/
SafeKeep, Lyfeguard, Emma/Snoop, Quicken LifeHub/Everplans, WealthR/
PensionBee). Verdict: credible PMF, fragmented competition, nobody owns
"family protection picture + playbooks".

Its recommendations mostly validate the existing triage:

- "Fix score explainability first" → intent 20 (confirms the #1 priority).
- "Partial-data scenario engine that never collapses to sample mode" → intent 21.
- "Partner join as easy as sharing a calendar invite, with visible status" → intent 23.
- "What changed this week" + monthly Quiet Care digest → PRD-136/138.
- "Blended-family, role-aware views" → intent 25 + PRD-110's deferred permissions.
- Adviser/executor partnership channel → PRD-207 (proposed; needs counsel,
  zero-commission constraint already recorded).
- Free/Plus packaging (~£7.99/mo, extraction Plus) → matches PRD-006's
  current gating shape.

New deltas worth recording:

- **Price-creep tracking** (premium history + alert on increase) → new
  intent 38; must stay strictly informational (rule 2 — own-policy data
  only, never a comparison or switch nudge).
- **"Free basic date extraction"** → a pricing/business decision the report
  advocates (free tier gives an "aha": stored doc + renewal date). Intent 27
  already flags this as a business call, not engineering. Deliberately
  deferred.
- **"Emergency pack always current and shareable with a named executor"** →
  tension with PRD-220's deliberate design (owner-generated file, never at a
  URL, no server copy). "Always current + executor-shared" means hosted,
  standing access — a real trust-tier and ZK decision (PRD-134/130
  territory), not a small feature. Recorded here as an open fork in PRD-220's
  direction; needs an explicit decision, not drift.
- **UK estate checklist with "links to solicitors"** → mostly PRD-137's
  legacy map; generic "find a licensed solicitor" pointers are fine under
  rule 2, named-firm referrals are steering and are not.

Caveats on the report itself: competitor pricing/gap claims are unsourced —
treat as directional against PRD-000's researched landscape, not as verified
market data. Its value-add is confirmation, not new evidence.

## Positioning & subscription panel (fifth input)

A three-expert role-play on UK positioning and free→Plus conversion. Its
joint recommendations land almost entirely on existing intents/PRDs —
independent confirmation of the priority order:

- "Explain the score + keep scenarios accurate on partial data" → intents
  20, 21. Panel consensus: fix these first; everything including
  subscription gets easier.
- Free-tier "aha" (stored doc + renewal date + runway before paywall) →
  intent 27.
- Family loop / second-adult join raising willingness to pay → intent 23.
- Plus packaging (extraction, digests, emergency pack, advanced scenarios) →
  PRD-006, PRD-143, PRD-138, PRD-220.
- Engagement cadence → PRD-136/138/141.
- Messaging hierarchy ("clarity and readiness; never advice, never
  insurance selling") → already the product's copy posture; feeds
  PRD-209/210's claims registry.

Genuinely new deltas → captured in intent 39:

- **Annual plan** presented as a lower monthly equivalent — no current
  owner; a PRD-006 pricing decision + Stripe/UX change.
- **Named paywall moment** — post-upload "Keel Plus reads the rest and
  keeps {partner} in the loop"; consistent with PRD-206's
  value-gap-closing rule.
- **Free-tier generosity as an explicit, recorded decision** — the panel's
  "don't starve free" is in tension with the PMF report's "free basic date
  extraction"; intent 39 proposes a line and flags the call as the
  founder's.

Not adopted: "outcome framing" upgrade copy must still pass the advice rule;
"always-current shareable pack" remains the open PRD-220 fork recorded
above.

## Testing notes (not product gaps)

- Automated file upload could not complete in the reviewer's browser harness
  (`setFileInputFiles` disallowed) — upload→extraction→insight path remains
  verified only by hand.
- Blended high-debt scenario (self-employed £6,500/mo, £1,200 savings, £850/mo
  debt payments, two children, partner) scored 22 — directionally correct
  debt/runway punishment; calibration question is whether the *shape* of the
  penalty curve matches persona expectations (intent 20).
