# Detector coverage audit (PRD-213 first pass — 2026-10)

Maps every detector family against the family's protection surface — policies,
members, estate, cash flow, renewal windows — and records each gap as either
filled or deliberately deferred. The PRD's coverage metric is "every major
protection state has a detector or a documented reason not to."

## Coverage map

| Protection state | Detector / rule | Status |
|---|---|---|
| Emergency fund adequacy & months of cover | `family_emergency_fund_adequacy` (4 rules) | covered |
| Fund trajectory (depleting / improving) | `family_emergency_trajectory` | covered |
| High-interest / unhealthy debt | `family_debt_health` | covered |
| Education funding gap & pacing | `family_education_shortfall`, `family_education_pacing` | covered |
| Retirement trajectory vs target | `family_retirement_gap` | covered |
| Life cover below household need | `family_protection_gap.life_insurance_below_household_needs` | covered |
| No income protection for an earner | `family_protection_gap.no_income_protection` (per-earner events) | covered |
| Second earner without life cover | `family_protection_gap.member_no_life_cover` | covered |
| Dependents without health/CI cover | `family_protection_gap.no_health_or_critical_illness_cover` | covered |
| Estate documents missing / stale | `family_estate_readiness` (11 rules, legacy-aware) | covered |
| Renewal approaching (≤60d) | `family_protection_gap.policy_renewal_window` | covered |
| **Renewal date already past** | `family_policy_review.policy_renewal_date_in_past` | **filled 2026-10** |
| Duplicate cover on same (type, holder) | `family_policy_review.duplicate_policy_coverage` | covered |
| Attribution to a removed roster member | `family_policy_review.policy_attributed_to_removed_member` | covered |
| Unreported life change (drift) | PRD-111 nudges | covered, information-only |

## Gap found and fixed

`soonestPolicyRenewal()` in `family-financial-profile.ts` skips negative
`renewal_date` deltas, so a policy whose recorded renewal has passed generated
no signal at all — the register could not distinguish "renewed but not updated"
from "cover ended". Filled by `policy_renewal_date_in_past` (register-hygiene
framing, informational only, per the advice rule).

## Documented deferrals (with reasons)

- **Premium drift per policy** (premiums increasing at renewal): needs a
  price history the profile doesn't store. Candidate schema extension;
  deferred until the profile records premium history or renewal offers.
- **Provider concentration** (all policies with one insurer): recordable but
  weak signal — concentration isn't a protection gap, and flagging it risks
  reading as a "diversify providers" recommendation (rule 2). Deferred;
  revisit only if copy can stay purely descriptive.
- **Per-member education-fund staleness** (fund not contributed to recently):
  contribution cadence isn't stored — `years_remaining` is a target, not a
  transaction log. Covered indirectly by education_pacing; revisit if
  contribution events land.
- **Cash-flow signals beyond the emergency fund** (monthly surplus trend):
  the profile holds point-in-time expenses, not a series — a trend detector
  needs repeated snapshots. Deferred to snapshot history work.
- **Mortgage term/rate windows**: mortgage is a balance figure only; no
  term or rate-fix expiry field exists. Candidate schema extension if
  families ask for it.
