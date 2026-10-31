// Gate 2 leftovers: a child who joins after a nomination, a household with five
// adults, and the deletion-receipts endpoint.
// Run: E2E_API_BASE=http://127.0.0.1:3401 node apps/api/e2e/gate2-gaps.e2e.mjs
import { call, must, household, uniq, scenario, expect, summary } from './lib.mjs'

const PASS = 'e2e-pass-12345'
const profile = (policies) => ({
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 250000,
    mortgage_outstanding_minor: 0,
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
})
const members = async (h) => (await must('family', call('GET', '/family', h.tokenA))).family.members

const flagText = async (t) => {
  const r = await call('GET', '/insights?limit=100', t)
  return JSON.stringify(r.body?.insights ?? r.body?.items ?? r.body)
}

// ── A child joins after a nomination ───────────────────────────────────────
const nom = await household({ second: false })
const life = {
  type: 'life',
  provider: 'Acme Mutual',
  coverage_amount_minor: 20_000_000,
  monthly_premium_minor: 3000,
  nomination: { nominated_label: 'Jo', nomination_date: '2019-05-01' },
}

await scenario('child after nomination: no flag until a child is on the record', async () => {
  const r = await call('POST', '/family/financial-profile', nom.tokenA, profile([life]))
  expect(r.status === 200 || r.status === 201, `save ${r.status}`)
  expect(!(await flagText(nom.tokenA)).includes('joined after'), 'flag with no child')
})

await scenario('child after nomination: adding a child raises a factual flag', async () => {
  const add = await call('POST', '/family/members', nom.tokenA, {
    name: 'Casey Child',
    email: '',
    role: 'child',
    date_of_birth: '2024-04-02',
  })
  expect(add.status === 201, `add child ${add.status}`)
  const cur = await call('GET', '/family/financial-profile', nom.tokenA)
  const r = await call('POST', '/family/financial-profile', nom.tokenA, {
    ...profile([life]),
    version: cur.body?.version,
  })
  expect(r.status === 200 || r.status === 201, `save ${r.status}`)
  const text = await flagText(nom.tokenA)
  expect(text.includes('joined after'), 'no flag after a child was added')
  expect(
    !/you should|buy|switch to/i.test(text.match(/[^"]*joined after[^"]*/)?.[0] ?? ''),
    'copy reads as advice',
  )
})

// ── Five adults ────────────────────────────────────────────────────────────
const big = await household()
const adults = []
for (const name of ['Kim', 'Lee', 'Max']) {
  const code = big.family.inviteCode ?? big.family.family?.inviteCode ?? big.family.invite_code
  const email = `${big.u}${name.toLowerCase()}@example.com`
  await must(
    'join',
    call('POST', '/family/join', null, {
      invite_code: code,
      name: `${name} Tester`,
      email,
      password: PASS,
    }),
  )
  const reqs = await must('requests', call('GET', '/family/access-requests', big.tokenA))
  const p = (reqs.requests ?? reqs).find((x) => x.email === email)
  await must('approve', call('POST', `/family/access-requests/${p.id}/approve`, big.tokenA, {}))
  const login = await must('login', call('POST', '/auth/login', null, { email, password: PASS }))
  adults.push({ name: `${name} Tester`, token: login.token })
}

await scenario('5 adults: all are active and each reads the shared map', async () => {
  const ms = await members(big)
  expect(ms.filter((m) => m.status === 'active').length === 5, `active=${ms.length}`)
  for (const a of adults) {
    const r = await call('GET', '/family/obligations/map', a.token)
    expect(r.status === 200, `${a.name} map ${r.status}`)
  }
})

await scenario('5 adults: Confirm is offered to exactly the named adult', async () => {
  const c = await call('POST', '/family/obligations', big.tokenA, {
    label: 'Car tax',
    named_person: 'Max Tester',
    next_due_date: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
    recurrence: 'annual',
  })
  expect(c.status === 201, `create ${c.status}`)
  const offered = []
  for (const a of [
    { name: 'organizer', token: big.tokenA },
    { name: 'second', token: big.tokenB },
    ...adults,
  ]) {
    const m = await call('GET', '/family/obligations/map', a.token)
    const row = m.body.obligations.find((o) => o.id === c.body.obligation.id)
    if (row?.can_confirm) offered.push(a.name)
  }
  expect(offered.length === 1 && offered[0] === 'Max Tester', `offered to ${offered.join(',')}`)
})

// ── Deletion receipts ──────────────────────────────────────────────────────
await scenario('deletion receipts: needs sign-in and starts empty', async () => {
  const anon = await call('GET', '/account/deletion-receipts', null)
  expect(anon.status === 401, `anonymous ${anon.status}`)
  const mine = await call('GET', '/account/deletion-receipts', big.tokenA)
  expect(mine.status === 200 && Array.isArray(mine.body.receipts), `list ${mine.status}`)
  expect(mine.body.receipts.length === 0, 'unexpected receipts')
})

summary()
