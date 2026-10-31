// Seeds one household with data for every narrative, prints login details for the browser run.
import { call, must, household } from './lib.mjs'

const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const h = await household()
const memberA = h.group.family.members[0].id
const policies = [
  {
    type: 'life',
    provider: 'Acme Mutual',
    coverage_amount_minor: 20_000_000,
    monthly_premium_minor: 3000,
    policy_number: 'POL-1',
    contact_phone: '0800 000 000',
    member_id: memberA,
    last_payment_date: days(100),
    nomination: { nominated_label: 'Jo', is_ex_partner: true, nomination_date: '2019-05-01' },
  },
  {
    type: 'life',
    provider: 'Beta Life',
    coverage_amount_minor: 10_000_000,
    monthly_premium_minor: 1500,
  },
  { type: 'car', provider: 'Motor Co', coverage_amount_minor: 0, monthly_premium_minor: 4000 },
]
await must(
  'profile',
  call('POST', '/family/financial-profile', h.tokenA, {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 250000,
      mortgage_outstanding_minor: 20_000_000,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 900000,
      monthly_expenses_minor: 300000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 35,
      target_retirement_age: 65,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 2_000_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies,
    generate_insights: true,
  }),
)
await must(
  'ob1',
  call('POST', '/family/obligations', h.tokenA, {
    label: 'Mortgage',
    category: 'housing',
    named_person: 'Alex Tester',
    next_due_date: '2026-12-01',
    recurrence: 'monthly',
    if_unavailable: 'Sam knows the lender',
  }),
)
await must(
  'ob2',
  call('POST', '/family/obligations', h.tokenA, {
    label: 'Home insurance',
    category: 'insurance',
    named_person: 'Sam Tester',
    next_due_date: '2026-11-15',
    recurrence: 'annual',
  }),
)
await must(
  'cov',
  call('POST', '/family/employer-cover', h.tokenA, {
    member_label: 'Alex',
    type: 'death_in_service',
    name_as_printed: '4x salary death in service',
    source: 'staff handbook',
    last_seen_at: '2026-09-01',
  }),
)
console.log(
  JSON.stringify({
    emailA: `${h.u}@example.com`,
    emailB: `${h.u}b@example.com`,
    password: 'e2e-pass-12345',
    tokenA: h.tokenA,
    tokenB: h.tokenB,
  }),
)
