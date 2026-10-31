// End-to-end combinations for PRD-231..235 against a running API.
// Run: E2E_API_BASE=http://127.0.0.1:3401 node apps/api/e2e/use-cases.e2e.mjs
import { call, must, household, scenario, expect, summary } from './lib.mjs'

const baseProfile = (policies) => ({
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
})

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const arr = (b) => b?.insights ?? b?.items ?? (Array.isArray(b) ? b : [])
const text = (i) => JSON.stringify(i).toLowerCase()

async function saveProfile(token, policies) {
  const cur = await call('GET', '/family/financial-profile', token)
  const version = cur.body?.version
  return call('POST', '/family/financial-profile', token, {
    ...baseProfile(policies),
    ...(typeof version === 'number' && cur.body?.profile ? { version } : {}),
  })
}
const insightsFor = async (token) => arr((await call('GET', '/insights?limit=100', token)).body)
const hasFlag = (list, needle) => list.some((i) => text(i).includes(needle))

const life = (extra = {}) => ({
  type: 'life',
  provider: 'Acme Mutual',
  coverage_amount_minor: 20_000_000,
  monthly_premium_minor: 3000,
  policy_number: 'POL-1',
  contact_phone: '0800 000 000',
  ...extra,
})

// ───────────────────────── PRD-231 obligations map ─────────────────────────
const ob = (over = {}) => ({
  label: 'Mortgage',
  category: 'housing',
  named_person: 'Alex Tester',
  next_due_date: '2026-12-01',
  recurrence: 'monthly',
  ...over,
})

await scenario('231 creator naming self is confirmed immediately', async () => {
  const h = await household()
  const r = await call('POST', '/family/obligations', h.tokenA, ob())
  expect(r.status === 201, `status ${r.status}`)
  expect(r.body.obligation.pending_confirmation === false, 'self-named row should not be pending')
})

await scenario('231 naming the other adult is pending; creator cannot confirm', async () => {
  const h = await household()
  const r = await must(
    'create',
    call('POST', '/family/obligations', h.tokenA, ob({ named_person: 'Sam Tester' })),
  )
  expect(r.obligation.pending_confirmation === true, 'should be pending')
  const self = await call('POST', `/family/obligations/${r.obligation.id}/confirm`, h.tokenA, {})
  expect(self.status === 403, `creator confirm should be 403, got ${self.status}`)
})

await scenario('231 named adult confirms; summary counts update', async () => {
  const h = await household()
  const r = await must(
    'create',
    call('POST', '/family/obligations', h.tokenA, ob({ named_person: 'Sam Tester' })),
  )
  const c = await call('POST', `/family/obligations/${r.obligation.id}/confirm`, h.tokenB, {})
  expect(c.status === 200, `confirm status ${c.status}`)
  expect(c.body.obligation.pending_confirmation === false, 'still pending after confirm')
  const map = await must('map', call('GET', '/family/obligations/map', h.tokenB))
  expect(map.summary.dependent_count >= 1, `dependent_count ${map.summary.dependent_count}`)
})

await scenario('231 second adult (role adult, not editor) can read but not write', async () => {
  const h = await household()
  await must('create', call('POST', '/family/obligations', h.tokenA, ob()))
  const read = await call('GET', '/family/obligations', h.tokenB)
  expect(read.status === 200 && read.body.obligations.length === 1, `B read ${read.status}`)
  const w = await call('POST', '/family/obligations', h.tokenB, ob({ named_person: 'Alex Tester' }))
  expect(w.status === 403, `B write expected 403, got ${w.status}`)
})

await scenario(
  '231 confirming a row that names someone else is refused (named-person binding)',
  async () => {
    const h = await household()
    // Row names Alex Tester (organizer), created by organizer -> self-confirmed; B confirming must not flip state.
    const r = await must(
      'create',
      call('POST', '/family/obligations', h.tokenA, ob({ named_person: 'Alex Tester' })),
    )
    const wrong = await call('POST', `/family/obligations/${r.obligation.id}/confirm`, h.tokenB, {})
    expect(
      wrong.status === 403,
      `B confirming a row naming Alex should be 403, got ${wrong.status}`,
    )
  },
)

await scenario('231 secret-shaped free text is rejected', async () => {
  const h = await household()
  for (const field of ['pays_from', 'notices_to', 'if_unavailable']) {
    const r = await call(
      'POST',
      '/family/obligations',
      h.tokenA,
      ob({ [field]: 'password: hunter2hunter2' }),
    )
    expect(r.status === 400, `${field}: expected 400 got ${r.status}`)
  }
})

await scenario('231 validation: bad date, unknown field, empty label', async () => {
  const h = await household()
  expect(
    (await call('POST', '/family/obligations', h.tokenA, ob({ next_due_date: 'tomorrow' })))
      .status === 400,
    'bad date',
  )
  expect(
    (await call('POST', '/family/obligations', h.tokenA, { ...ob(), extra: 1 })).status === 400,
    'unknown field',
  )
  expect(
    (await call('POST', '/family/obligations', h.tokenA, ob({ label: '  ' }))).status === 400,
    'empty label',
  )
})

await scenario(
  '231 tenant isolation: another household cannot read/edit/delete/confirm',
  async () => {
    const h1 = await household()
    const h2 = await household({ second: false })
    const r = await must('create', call('POST', '/family/obligations', h1.tokenA, ob()))
    const id = r.obligation.id
    const list = await must('list', call('GET', '/family/obligations', h2.tokenA))
    expect(list.obligations.length === 0, 'h2 sees h1 rows')
    expect(
      (await call('PUT', `/family/obligations/${id}`, h2.tokenA, { label: 'x' })).status === 404,
      'PUT not 404',
    )
    expect(
      (await call('DELETE', `/family/obligations/${id}`, h2.tokenA)).status === 404,
      'DELETE not 404',
    )
    expect(
      (await call('POST', `/family/obligations/${id}/confirm`, h2.tokenA, {})).status !== 200,
      'confirm leaked',
    )
  },
)

await scenario('231 unauthenticated requests are refused', async () => {
  for (const [m, p] of [
    ['GET', '/family/obligations'],
    ['POST', '/family/obligations'],
    ['GET', '/family/obligations/map'],
  ]) {
    const r = await call(m, p, null, m === 'POST' ? ob() : undefined)
    expect(r.status === 401, `${m} ${p} -> ${r.status}`)
  }
})

await scenario('231 rename re-opens confirmation', async () => {
  const h = await household()
  const r = await must('create', call('POST', '/family/obligations', h.tokenA, ob()))
  const u = await must(
    'rename',
    call('PUT', `/family/obligations/${r.obligation.id}`, h.tokenA, { named_person: 'Sam Tester' }),
  )
  expect(u.obligation.pending_confirmation === true, 'rename to other adult should be pending')
})

await scenario('231 delete removes the row and is audited path returns ok', async () => {
  const h = await household()
  const r = await must('create', call('POST', '/family/obligations', h.tokenA, ob()))
  expect(
    (await call('DELETE', `/family/obligations/${r.obligation.id}`, h.tokenA)).status === 200,
    'delete',
  )
  expect(
    (await must('l', call('GET', '/family/obligations', h.tokenA))).obligations.length === 0,
    'row remains',
  )
})

// ───────────────────────── PRD-232 employer cover ─────────────────────────
const cover = (over = {}) => ({
  member_label: 'Alex',
  type: 'death_in_service',
  name_as_printed: '4x salary death in service',
  ...over,
})

await scenario('232 employer cover CRUD round trip, both adults can read', async () => {
  const h = await household()
  const c = await must(
    'create',
    call(
      'POST',
      '/family/employer-cover',
      h.tokenA,
      cover({ source: 'handbook', last_seen_at: '2026-09-01' }),
    ),
  )
  expect(c.fact.ends_with_employment === true, 'default ends_with_employment')
  const read = await must('read', call('GET', '/family/employer-cover', h.tokenB))
  expect(read.facts.length === 1, 'B cannot read')
  await must(
    'put',
    call('PUT', `/family/employer-cover/${c.fact.id}`, h.tokenA, { ends_with_employment: false }),
  )
  expect(
    (await call('DELETE', `/family/employer-cover/${c.fact.id}`, h.tokenA)).status === 200,
    'delete',
  )
})

await scenario('232 each cover type accepted, unknown type rejected, tenant isolated', async () => {
  const h = await household({ second: false })
  const other = await household({ second: false })
  for (const type of ['death_in_service', 'income_protection', 'health_cover', 'other'])
    expect(
      (await call('POST', '/family/employer-cover', h.tokenA, cover({ type }))).status === 201,
      type,
    )
  expect(
    (await call('POST', '/family/employer-cover', h.tokenA, cover({ type: 'pension' }))).status ===
      400,
    'bad type',
  )
  expect(
    (await must('l', call('GET', '/family/employer-cover', other.tokenA))).facts.length === 0,
    'leak across tenants',
  )
})

await scenario('232 job-change brief preview still works with cover facts present', async () => {
  const h = await household({ second: false })
  await must('cover', call('POST', '/family/employer-cover', h.tokenA, cover()))
  const r = await call('GET', '/briefs/catalogue', h.tokenA)
  expect(r.status < 500, `catalogue ${r.status}`)
})

// ───────────────────────── PRD-233/234 detectors via the profile ─────────────────────────
await scenario('233 stale last_payment_date flags; recent and absent do not', async () => {
  const h = await household({ second: false })
  const stale = await saveProfile(h.tokenA, [
    life({ last_payment_date: daysAgo(90), nomination: { nominated_label: 'Sam' } }),
  ])
  expect(stale.status < 300, `save ${stale.status} ${JSON.stringify(stale.body).slice(0, 200)}`)
  expect(hasFlag(await insightsFor(h.tokenA), 'no payment recorded'), 'stale payment not flagged')

  const h2 = await household({ second: false })
  await saveProfile(h2.tokenA, [
    life({ last_payment_date: daysAgo(10), nomination: { nominated_label: 'Sam' } }),
  ])
  expect(!hasFlag(await insightsFor(h2.tokenA), 'no payment recorded'), 'recent payment flagged')

  const h3 = await household({ second: false })
  await saveProfile(h3.tokenA, [life({ nomination: { nominated_label: 'Sam' } })])
  expect(!hasFlag(await insightsFor(h3.tokenA), 'no payment recorded'), 'absent date flagged')
})

await scenario('233 premium change alone must not trigger the stopped-payment flag', async () => {
  const h = await household({ second: false })
  await saveProfile(h.tokenA, [life({ nomination: { nominated_label: 'Sam' } })])
  await saveProfile(h.tokenA, [
    life({ monthly_premium_minor: 4000, nomination: { nominated_label: 'Sam' } }),
  ])
  expect(
    !hasFlag(await insightsFor(h.tokenA), 'no payment recorded'),
    'premium_history used as payments',
  )
})

await scenario('234 no-nomination flag: life only, never income protection', async () => {
  const h = await household({ second: false })
  // One nominated policy shows the household has engaged; the bare one is then a real gap.
  await saveProfile(h.tokenA, [
    life({ policy_number: 'L0', nomination: { nominated_label: 'Sam' } }),
    life({ policy_number: 'L1', provider: 'Bare Life' }),
  ])
  expect(
    hasFlag(await insightsFor(h.tokenA), 'no nomination'),
    'life without nomination not flagged',
  )
  const h2 = await household({ second: false })
  await saveProfile(h2.tokenA, [
    {
      type: 'income_protection',
      provider: 'IP Co',
      monthly_premium_minor: 2000,
      coverage_amount_minor: 0,
    },
  ])
  expect(!hasFlag(await insightsFor(h2.tokenA), 'no nomination'), 'income protection flagged')
})

await scenario('234 ex-partner nomination flag is visible to the nominating adult', async () => {
  const h = await household()
  const memberA = h.group.family.members[0].id
  await saveProfile(h.tokenA, [
    life({ member_id: memberA, nomination: { nominated_label: 'Jo', is_ex_partner: true } }),
  ])
  expect(
    hasFlag(await insightsFor(h.tokenA), 'ex-partner'),
    'nominating adult cannot see their flag',
  )
})

await scenario(
  '234 ex-partner flag must NOT be visible to the other adult (Intent 82)',
  async () => {
    const h = await household()
    const memberA = h.group.family.members[0].id
    await saveProfile(h.tokenA, [
      life({ member_id: memberA, nomination: { nominated_label: 'Jo', is_ex_partner: true } }),
    ])
    const seenByB = await insightsFor(h.tokenB)
    expect(!hasFlag(seenByB, 'ex-partner'), 'second adult sees the ex-partner flag in /insights')
    const cons = arr((await call('GET', '/insights/consolidated', h.tokenB)).body)
    expect(!hasFlag(cons, 'ex-partner'), 'second adult sees the flag in /insights/consolidated')
  },
)

await scenario(
  '234 combos: ex-partner x stale payment x no nomination on separate policies',
  async () => {
    const h = await household()
    const memberA = h.group.family.members[0].id
    const res = await saveProfile(h.tokenA, [
      life({
        policy_number: 'A',
        member_id: memberA,
        nomination: { nominated_label: 'Jo', is_ex_partner: true },
        last_payment_date: daysAgo(100),
      }),
      life({ policy_number: 'B', provider: 'Beta Life' }),
    ])
    expect(res.status < 300, `save ${res.status}`)
    const list = await insightsFor(h.tokenA)
    expect(hasFlag(list, 'ex-partner'), 'ex-partner missing')
    expect(hasFlag(list, 'no payment recorded'), 'stale payment missing')
    expect(hasFlag(list, 'no nomination'), 'no-nomination missing')
  },
)

await scenario(
  '233/234 flag copy never gives advice or names a provider to switch to',
  async () => {
    const h = await household()
    const memberA = h.group.family.members[0].id
    await saveProfile(h.tokenA, [
      life({
        member_id: memberA,
        nomination: { nominated_label: 'Jo', is_ex_partner: true },
        last_payment_date: daysAgo(100),
      }),
    ])
    const all = text(await insightsFor(h.tokenA))
    for (const bad of [
      'you should buy',
      'switch to',
      'we recommend',
      'name your partner',
      'has lapsed',
      'grace period',
    ])
      expect(!all.includes(bad), `copy contains "${bad}"`)
  },
)

// ───────────────────────── PRD-235 claim packet ─────────────────────────
await scenario(
  '235 packet for a complete life policy: no send, template draft, gaps listed',
  async () => {
    const h = await household()
    await saveProfile(h.tokenA, [
      life({
        nomination: { nominated_label: 'Sam', provider_form_url: 'https://acme.example/form' },
      }),
    ])
    const r = await call('POST', '/family/policies/0/claim-packet', h.tokenA, {})
    expect(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    const p = r.body.packet
    expect(p.draft_notification.includes('Acme Mutual'), 'draft lacks provider')
    expect(
      p.gaps.some((g) => g.includes('not located')),
      'missing-paper gaps not shown',
    )
    expect(p.authority_note.toLowerCase().includes('authority'), 'authority note missing')
  },
)

await scenario('235 packet: missing number/contact shown as gaps, not invented', async () => {
  const h = await household()
  await saveProfile(h.tokenA, [
    { type: 'life', provider: 'Bare Life', monthly_premium_minor: 1000, coverage_amount_minor: 0 },
  ])
  const p = (await must('packet', call('POST', '/family/policies/0/claim-packet', h.tokenA, {})))
    .packet
  expect(p.gaps.includes('Policy number not on file'), 'policy number gap')
  expect(p.gaps.includes('Claims contact not on file'), 'contact gap')
  expect(p.policy_number === null, 'invented number')
})

await scenario(
  '235 packet: non-life 400, bad index 404/400, unauthenticated 401, other tenant 404',
  async () => {
    const h = await household({ second: false })
    await saveProfile(h.tokenA, [
      { type: 'car', provider: 'Motor Co', monthly_premium_minor: 4000, coverage_amount_minor: 0 },
      life(),
    ])
    expect(
      (await call('POST', '/family/policies/0/claim-packet', h.tokenA, {})).status === 400,
      'non-life',
    )
    expect(
      [400, 404].includes(
        (await call('POST', '/family/policies/9/claim-packet', h.tokenA, {})).status,
      ),
      'out of range',
    )
    expect(
      [400, 404].includes(
        (await call('POST', '/family/policies/-1/claim-packet', h.tokenA, {})).status,
      ),
      'negative',
    )
    expect(
      (await call('POST', '/family/policies/1/claim-packet', null, {})).status === 401,
      'unauth',
    )
    const o = await household({ second: false })
    expect(
      (await call('POST', '/family/policies/1/claim-packet', o.tokenA, {})).status === 404,
      'cross-tenant',
    )
  },
)

await scenario(
  '235 packet addressed by a client-supplied pol_ id survives reordering',
  async () => {
    const h = await household({ second: false })
    await saveProfile(h.tokenA, [
      life({ id: 'pol_first', provider: 'First Life', policy_number: 'F1' }),
      life({ id: 'pol_second', provider: 'Second Life', policy_number: 'S1' }),
    ])
    const prof = await must('get', call('GET', '/family/financial-profile', h.tokenA))
    await saveProfile(h.tokenA, [...(prof.profile ?? prof).policies].reverse())
    const r = await must(
      'packet',
      call('POST', '/family/policies/pol_second/claim-packet', h.tokenA, {}),
    )
    expect(r.packet.provider === 'Second Life', `got ${r.packet.provider}`)
  },
)

await scenario('235 a policy saved WITHOUT an id gets a stable id from the server', async () => {
  const h = await household({ second: false })
  await saveProfile(h.tokenA, [life({ provider: 'No Id Life' })])
  const prof = await must('get', call('GET', '/family/financial-profile', h.tokenA))
  const id = (prof.profile ?? prof).policies[0]?.id
  expect(
    typeof id === 'string' && id.startsWith('pol_'),
    `no server-assigned id (got ${id}); the web app addresses packets by index`,
  )
})

summary()
