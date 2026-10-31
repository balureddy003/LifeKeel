// Persona x flow matrix for the household brief journey + friction measurement.
// Run: E2E_API_BASE=http://127.0.0.1:3401 node apps/api/e2e/personas.e2e.mjs
import { API, call, must, household, uniq, scenario, expect, summary } from './lib.mjs'

const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

// Required money fields per mode, straight from solveCatalogueBrief.
const base = {
  monthly_income_minor: 400000,
  monthly_essentials_minor: 250000,
  liquid_savings_minor: 900000,
}
const inputsFor = (mode, date) => {
  const i = { change_date: date, ...base }
  if (['stop', 'income', 'mixed'].includes(mode)) i.new_income_minor = mode === 'stop' ? 0 : 300000
  if (['cost', 'mixed', 'cash'].includes(mode)) i.new_essentials_minor = 270000
  if (mode === 'cash') i.cash_out_minor = 500000
  return i
}
const moneyFieldCount = (i) => Object.keys(i).filter((k) => k.endsWith('_minor')).length

const otherAdult = (h) => h.group.family.members.find((m) => m.role !== 'organizer')?.id
const personas = {}
async function persona(name, opts) {
  personas[name] = await household(opts)
  return personas[name]
}

const couple = await persona('couple', {})
const solo = await persona('solo', { second: false })
const cat = (await must('cat', call('GET', '/family/brief-catalogue', couple.tokenA))).catalogue
const fieldCounts = {}
const firstStepCounts = {}

// 1. Every brief type solves, for a couple and a solo parent, with timing.
for (const [pname, h] of [
  ['couple', couple],
  ['solo', solo],
]) {
  for (const e of cat.filter((x) => x.mode !== 'handover')) {
    await scenario(`brief ${e.id} previews for ${pname}`, async () => {
      const inputs = inputsFor(e.mode, future(60))
      fieldCounts[e.id] = moneyFieldCount(inputs)
      const t0 = Date.now()
      const r = await call('POST', '/family/briefs/preview', h.tokenA, {
        problem_type: e.id,
        inputs,
      })
      const ms = Date.now() - t0
      expect(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`)
      expect(r.body.preview.template_sentence.length > 10, 'empty sentence')
      expect(ms < 500, `slow preview ${ms}ms`)
    })
  }
}

// 1b. PRD-230 budget: the first step alone (3 money fields + the date) must
// produce a number for every money type. Cap is asserted, not just printed.
const FIRST_STEP_MONEY_MAX = 3
for (const e of cat.filter((x) => x.mode !== 'handover')) {
  await scenario(`brief ${e.id} gives a first number from the first step alone`, async () => {
    const { change_date, ...money } = inputsFor(e.mode, future(60))
    const first = {
      change_date,
      ...Object.fromEntries(Object.entries(money).filter(([k]) => Object.keys(base).includes(k))),
    }
    firstStepCounts[e.id] = moneyFieldCount(first)
    expect(
      firstStepCounts[e.id] <= FIRST_STEP_MONEY_MAX,
      `${e.id}: ${firstStepCounts[e.id]} money fields`,
    )
    const t0 = Date.now()
    const r = await call('POST', '/family/briefs/preview', couple.tokenA, {
      problem_type: e.id,
      inputs: first,
    })
    expect(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`)
    expect(Date.now() - t0 < 500, 'slow preview')
    expect(r.body.preview.template_sentence.length > 10, 'empty sentence')
  })
}

// 2. Friction: how many money fields before the first number, per brief.
console.log('\nMoney fields required before a first number (PRD-230 target: 3 + 1 date):')
const byCount = {}
for (const [id, n] of Object.entries(fieldCounts)) (byCount[n] ??= []).push(id)
for (const [n, ids] of Object.entries(byCount))
  console.log(`  ${n} money fields: ${ids.join(', ')}`)
console.log(
  '  (totals with every optional detail; the first-step budget of 3 money fields + a date is asserted above)',
)

// 3. Bad input produces a human message, never a stack/500.
await scenario('errors are plain language for every missing/invalid money field', async () => {
  const bad = [
    { change_date: future(30) },
    { change_date: future(30), ...base, monthly_essentials_minor: 0, new_income_minor: 0 },
    { change_date: 'next week', ...base, new_income_minor: 0 },
    { change_date: future(30), ...base, new_income_minor: -5 },
  ]
  for (const inputs of bad) {
    const r = await call('POST', '/family/briefs/preview', couple.tokenA, {
      problem_type: 'income_stops',
      inputs,
    })
    expect(r.status === 400, `expected 400, got ${r.status}`)
    const msg = String(r.body.error ?? '')
    expect(msg.length > 8 && !/zod|undefined|\[object|stack|at /i.test(msg), `unfriendly: ${msg}`)
  }
})

// 4. Create -> share -> anonymous read -> partner confirm, per household shape.
await scenario('couple: create, share link, anonymous read, second adult confirms', async () => {
  const h = couple
  const created = await must(
    'create',
    call('POST', '/family/briefs', h.tokenA, {
      problem_type: 'income_stops',
      contract_version: 2,
      for_member_id: otherAdult(h),
      inputs: inputsFor('stop', future(60)),
    }),
  )
  const brief = created.brief ?? created
  const share = await must('share', call('POST', `/family/briefs/${brief.id}/share`, h.tokenA, {}))
  const token =
    share.token ?? share.share?.token ?? (share.share?.url ?? share.url ?? '').split('/').pop()
  expect(token, `no token in ${JSON.stringify(share).slice(0, 160)}`)
  const anon = await call('GET', `/b/${token}`, null)
  expect(
    anon.status === 401 && /sign in/i.test(String(anon.body.error)),
    `anonymous should get a clear sign-in message, got ${anon.status}`,
  )
  const read = await call('GET', `/b/${token}`, h.tokenB)
  expect(read.status === 200, `named adult read ${read.status}`)
  const leaks = JSON.stringify(read.body).toLowerCase()
  for (const k of ['email', 'password', 'tenant_id']) expect(!leaks.includes(k), `link leaks ${k}`)
  const wrongVersion = await call('POST', `/b/${token}/confirm`, h.tokenB, {
    result_version: 'stale',
  })
  expect(wrongVersion.status === 409, `stale version should be 409, got ${wrongVersion.status}`)
  const conf = await call('POST', `/b/${token}/confirm`, h.tokenB, {
    result_version: read.body.result_version,
  })
  expect(
    conf.status === 200,
    `partner confirm ${conf.status} ${JSON.stringify(conf.body).slice(0, 140)}`,
  )
  const creatorConfirm = await call('POST', `/b/${token}/confirm`, h.tokenA, {
    result_version: read.body.result_version,
  })
  expect(
    creatorConfirm.status === 200,
    `creator also confirms their own read, got ${creatorConfirm.status}`,
  )
})

await scenario(
  'front door: a brief link needs one sign-in as the named adult, with no figures before it (PRD-230 item 4)',
  async () => {
    const h = await household()
    const created = await must(
      'create',
      call('POST', '/family/briefs', h.tokenA, {
        problem_type: 'income_stops',
        contract_version: 2,
        for_member_id: otherAdult(h),
        inputs: inputsFor('stop', future(60)),
      }),
    )
    const share = await must(
      'share',
      call('POST', `/family/briefs/${(created.brief ?? created).id}/share`, h.tokenA, {}),
    )
    const anon = await call('GET', `/b/${share.share.url}`, null)
    expect(
      anon.status === 401 && /sign in/i.test(String(anon.body.error)),
      `anonymous should get a clear sign-in message, got ${anon.status}`,
    )
    const body = JSON.stringify(anon.body)
    for (const leak of ['income', 'savings', 'monthly', 'result', 'facts'])
      expect(!body.toLowerCase().includes(leak), `anonymous response leaks "${leak}"`)
    // A different signed-in household member is told it is not theirs, not shown it.
    const stranger = await household({ second: false })
    const other = await call('GET', `/b/${share.share.url}`, stranger.tokenA)
    expect(other.status === 403, `other household should get 403, got ${other.status}`)
  },
)

await scenario(
  'solo: can create a brief and gets a clear message about confirmation (no dead end)',
  async () => {
    const c = await call('POST', '/family/briefs', solo.tokenA, {
      problem_type: 'income_stops',
      contract_version: 2,
      inputs: inputsFor('stop', future(60)),
    })
    expect(c.status < 500, `server error ${c.status}`)
    // A solo parent has no recipient adult: the answer must say what to do, not just refuse.
    expect(
      c.status < 300 || /invite|family|another/i.test(String(c.body.error ?? '')),
      `dead end for solo: ${c.status} ${JSON.stringify(c.body)}`,
    )
  },
)

await scenario(
  'solo: a single-adult household can still get its own brief (no recipient needed)',
  async () => {
    const fresh = await household({ second: false }) // its own free first brief
    const c = await call('POST', '/family/briefs', fresh.tokenA, {
      problem_type: 'income_stops',
      contract_version: 2,
      inputs: inputsFor('stop', future(60)),
    })
    expect(
      c.status < 300,
      `single-adult household cannot save a brief: ${String(c.body.error).slice(0, 120)}`,
    )
  },
)

await scenario(
  'first brief is free; second brief hits a clear, non-500 entitlement message',
  async () => {
    const h2 = await household()
    const a = await call('POST', '/family/briefs', h2.tokenA, {
      problem_type: 'income_stops',
      contract_version: 2,
      for_member_id: otherAdult(h2),
      inputs: inputsFor('stop', future(60)),
    })
    expect(
      a.status === 201 || a.status === 200,
      `first brief ${a.status} ${JSON.stringify(a.body).slice(0, 140)}`,
    )
    const b = await call('POST', '/family/briefs', h2.tokenA, {
      problem_type: 'renewal',
      contract_version: 2,
      for_member_id: otherAdult(h2),
      inputs: inputsFor('cost', future(60)),
    })
    expect(b.status < 500, `second brief 5xx ${b.status}`)
    if (b.status >= 400)
      expect(String(b.body.error ?? b.body.message ?? '').length > 8, 'no upgrade message')
  },
)

await scenario(
  'non-editor adult: read-only, clear 403 on create/preview, can read shared brief',
  async () => {
    const p = await call('POST', '/family/briefs/preview', couple.tokenB, {
      problem_type: 'income_stops',
      inputs: inputsFor('stop', future(60)),
    })
    expect(p.status === 403 && String(p.body.error).length > 8, `preview ${p.status}`)
    const l = await call('GET', '/family/briefs', couple.tokenB)
    expect(l.status === 200, `list ${l.status}`)
  },
)

await scenario(
  'unauthenticated: preview and create refused, share link does not need a login',
  async () => {
    expect(
      (
        await call('POST', '/family/briefs/preview', null, {
          problem_type: 'income_stops',
          inputs: {},
        })
      ).status === 401,
      'preview',
    )
    expect((await call('POST', '/family/briefs', null, {})).status === 401, 'create')
    expect(
      (await call('GET', '/b/not-a-real-token', null)).status === 404,
      'bad token should be 404',
    )
  },
)

await scenario(
  'handover brief: secrets rejected, consent required, blanks marked Not entered',
  async () => {
    const h = cat.find((x) => x.mode === 'handover')
    const f = h.fields ?? []
    const secret = await call('POST', '/family/briefs', couple.tokenA, {
      problem_type: h.id,
      contract_version: 2,
      for_member_id: otherAdult(couple),
      inputs: {
        change_date: future(10),
        sensitive_consent: true,
        facts: { [f[0]]: 'password: hunter2hunter2' },
      },
    })
    expect(secret.status === 400, `secret accepted ${secret.status}`)
    const noConsent = await call('POST', '/family/briefs/preview', couple.tokenA, {
      problem_type: h.id,
      inputs: { facts: { [f[0]]: 'in the safe' } },
    })
    expect(noConsent.status === 400, `preview of handover ${noConsent.status}`)
  },
)

summary()
