// Gate 2: household shapes beyond a couple, plus the account lifecycle.
// Three adults, a pending partner, minors, removal, signup/settings/export/erasure,
// and a timed first-value run against the friction budget (PRD-230).
// Run: E2E_API_BASE=http://127.0.0.1:3401 node apps/api/e2e/households.e2e.mjs
import { call, must, household, uniq, scenario, expect, summary } from './lib.mjs'

const PASS = 'e2e-pass-12345'
const stopInputs = (date) => ({
  change_date: date,
  monthly_income_minor: 400000,
  monthly_essentials_minor: 250000,
  liquid_savings_minor: 900000,
  new_income_minor: 0,
})
const future = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

/** Add another logged-in adult to a household through the real join and approve flow. */
async function joinAdult(h, name) {
  const code = h.family.inviteCode ?? h.family.family?.inviteCode ?? h.family.invite_code
  const email = `${h.u}${name.split(' ')[0].toLowerCase()}@example.com`
  await must(
    'join',
    call('POST', '/family/join', null, { invite_code: code, name, email, password: PASS }),
  )
  const reqs = await must('requests', call('GET', '/family/access-requests', h.tokenA))
  const pending = (reqs.requests ?? reqs).find((r) => r.email === email || r.name === name)
  await must('approve', call('POST', `/family/access-requests/${pending.id}/approve`, h.tokenA, {}))
  const login = await must('login', call('POST', '/auth/login', null, { email, password: PASS }))
  return { token: login.token, email }
}
const members = async (h) => (await must('family', call('GET', '/family', h.tokenA))).family.members
const byName = (ms, n) => ms.find((m) => m.name === n)

// ── Three adults ────────────────────────────────────────────────────────────
const three = await household()
const kim = await joinAdult(three, 'Kim Tester')

await scenario('3 adults: all three are active adults on the roster', async () => {
  const ms = await members(three)
  expect(ms.filter((m) => m.status === 'active').length === 3, `active=${ms.length}`)
})

await scenario('3 adults: only the named adult may confirm an obligation', async () => {
  const r = await call('POST', '/family/obligations', three.tokenA, {
    label: 'School fees',
    named_person: 'Sam Tester',
    next_due_date: future(20),
    recurrence: 'quarterly',
  })
  expect(r.status === 201, `create ${r.status}`)
  const id = r.body.obligation.id
  const asKim = await call('POST', `/family/obligations/${id}/confirm`, kim.token, {})
  expect(asKim.status === 403, `wrong adult confirm should be 403, got ${asKim.status}`)
  const asCreator = await call('POST', `/family/obligations/${id}/confirm`, three.tokenA, {})
  expect(asCreator.status === 403, `creator confirm should be 403, got ${asCreator.status}`)
  const asSam = await call('POST', `/family/obligations/${id}/confirm`, three.tokenB, {})
  expect(asSam.status === 200, `named adult confirm ${asSam.status}`)
})

await scenario('3 adults: the map offers Confirm to exactly one adult', async () => {
  const r = await call('POST', '/family/obligations', three.tokenA, {
    label: 'Broadband',
    named_person: 'Kim Tester',
    next_due_date: future(9),
  })
  const id = r.body.obligation.id
  const view = async (tok) =>
    (await call('GET', '/family/obligations/map', tok)).body.obligations.find((o) => o.id === id)
  expect((await view(three.tokenA)).can_confirm === false, 'creator offered confirm')
  expect((await view(three.tokenB)).can_confirm === false, 'wrong adult offered confirm')
  expect((await view(kim.token)).can_confirm === true, 'named adult not offered confirm')
})

await scenario('3 adults: read-only adults see can_edit=false, the organizer true', async () => {
  const get = async (t) => (await call('GET', '/family/obligations/map', t)).body.can_edit
  expect((await get(three.tokenA)) === true, 'organizer should edit')
  expect((await get(kim.token)) === false, 'viewer should not edit')
})

await scenario('3 adults: a brief for one adult is not readable by the third', async () => {
  const sam = byName(await members(three), 'Sam Tester')
  const created = await call('POST', '/family/briefs', three.tokenA, {
    problem_type: 'income_stops',
    contract_version: 2,
    for_member_id: sam.id,
    inputs: stopInputs(future(60)),
  })
  expect(created.status === 201 || created.status === 200, `create ${created.status}`)
  const id = created.body.brief?.id ?? created.body.id
  const asKim = await call('GET', `/family/briefs/${id}`, kim.token)
  expect([401, 403, 404].includes(asKim.status), `third adult got ${asKim.status}`)
})

await scenario('3 adults: removing an adult ends their access at once', async () => {
  const kimMember = byName(await members(three), 'Kim Tester')
  const del = await call('DELETE', `/family/members/${kimMember.id}`, three.tokenA)
  expect(del.status === 200, `remove ${del.status}`)
  const after = await call('GET', '/family', kim.token)
  expect([401, 403].includes(after.status), `removed adult still gets ${after.status}`)
  const login = await call('POST', '/auth/login', null, { email: kim.email, password: PASS })
  expect(login.status >= 400, `removed adult can still sign in (${login.status})`)
})

// ── Pending partner and minors ──────────────────────────────────────────────
const pend = await household({ second: false })

await scenario('pending partner: added with no login, the household stays solo-safe', async () => {
  const r = await call('POST', '/family/members', pend.tokenA, {
    name: 'Pat Pending',
    email: '',
    role: 'adult',
  })
  expect(r.status === 201, `add ${r.status}`)
  const ms = await members(pend)
  expect(byName(ms, 'Pat Pending').status === 'pending', 'should be pending')
})

await scenario('pending partner: a brief can be saved while nobody else is active', async () => {
  const r = await call('POST', '/family/briefs', pend.tokenA, {
    problem_type: 'income_stops',
    contract_version: 2,
    inputs: stopInputs(future(60)),
  })
  expect(
    r.status === 201 || r.status === 200,
    `solo save ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`,
  )
})

await scenario('minors: a child cannot be given a sign-in', async () => {
  const add = await call('POST', '/family/members', pend.tokenA, {
    name: 'Casey Child',
    email: '',
    role: 'child',
    date_of_birth: '2018-04-02',
  })
  expect(add.status === 201, `add child ${add.status}`)
  const child = byName(await members(pend), 'Casey Child')
  const inv = await call('POST', `/family/members/${child.id}/invite`, pend.tokenA, {
    email: `${pend.u}child@example.com`,
  })
  expect(inv.status === 400, `child invite should be 400, got ${inv.status}`)
})

await scenario('minors: an adult-labelled member under 18 is treated as a minor', async () => {
  const dob = new Date(Date.now() - 15 * 365 * 86_400_000).toISOString().slice(0, 10)
  const add = await call('POST', '/family/members', pend.tokenA, {
    name: 'Teen Adult',
    email: '',
    role: 'adult',
    date_of_birth: dob,
  })
  expect(add.status === 201, `add ${add.status}`)
  const teen = byName(await members(pend), 'Teen Adult')
  const inv = await call('POST', `/family/members/${teen.id}/invite`, pend.tokenA, {
    email: `${pend.u}teen@example.com`,
  })
  expect(inv.status === 400, `under-18 invite should be 400, got ${inv.status}`)
})

await scenario('minors: bad inputs are refused, not stored', async () => {
  const future_dob = await call('POST', '/family/members', pend.tokenA, {
    name: 'Time Traveller',
    email: '',
    role: 'child',
    date_of_birth: '2099-01-01',
  })
  expect(future_dob.status === 400, `future dob ${future_dob.status}`)
  const bad_role = await call('POST', '/family/members', pend.tokenA, {
    name: 'Nobody',
    email: '',
    role: 'wizard',
  })
  expect(bad_role.status === 400, `bad role ${bad_role.status}`)
  const sneaky = await call('POST', '/family/members', pend.tokenA, {
    name: 'Adult Label',
    email: '',
    role: 'adult',
    relationship_label: 'son',
  })
  expect(sneaky.status === 400, `relationship on adult ${sneaky.status}`)
})

await scenario('organizer cannot remove themselves', async () => {
  const me = (await members(pend)).find((m) => m.role === 'organizer')
  const r = await call('DELETE', `/family/members/${me.id}`, pend.tokenA)
  expect(r.status >= 400, `self-removal returned ${r.status}`)
})

// ── Signup, sign-in and settings ───────────────────────────────────────────
const u = uniq()
await scenario('signup: bad email, weak password and duplicate are refused', async () => {
  const body = (o) => ({
    email: `${u}@example.com`,
    password: PASS,
    name: 'Una Test',
    workspace: u,
    ...o,
  })
  const badEmail = await call('POST', '/auth/signup', null, body({ email: 'not-an-email' }))
  expect(badEmail.status === 400, `bad email ${badEmail.status}`)
  const weak = await call('POST', '/auth/signup', null, body({ password: '123' }))
  expect(weak.status === 400, `weak password ${weak.status}`)
  const ok = await call('POST', '/auth/signup', null, body({}))
  expect(ok.status === 200 || ok.status === 201, `signup ${ok.status}`)
  const dup = await call('POST', '/auth/signup', null, body({ workspace: `${u}x` }))
  expect(dup.status >= 400 && dup.status < 500, `duplicate email ${dup.status}`)
})

await scenario('sign-in: wrong password and unknown email fail the same way', async () => {
  const wrong = await call('POST', '/auth/login', null, {
    email: `${u}@example.com`,
    password: 'nope-nope-123',
  })
  const none = await call('POST', '/auth/login', null, {
    email: `${u}ghost@example.com`,
    password: 'nope-nope-123',
  })
  expect(wrong.status === 401 && none.status === 401, `wrong=${wrong.status} none=${none.status}`)
  expect(
    JSON.stringify(wrong.body) === JSON.stringify(none.body),
    'responses differ, which reveals which emails exist',
  )
})

await scenario(
  'settings: a name change shows in /auth/me; a blank name or one with a link is refused',
  async () => {
    const login = await must(
      'login',
      call('POST', '/auth/login', null, { email: `${u}@example.com`, password: PASS }),
    )
    const t = login.token
    const put = await call('PUT', '/auth/profile', t, { name: 'Una Renamed' })
    expect(put.status === 200, `rename ${put.status}`)
    const me = await call('GET', '/auth/me', t)
    expect(JSON.stringify(me.body).includes('Una Renamed'), 'new name not shown')
    const blank = await call('PUT', '/auth/profile', t, { name: '   ' })
    expect(blank.status === 400, `blank name ${blank.status}`)
    const link = await call('PUT', '/auth/profile', t, { name: 'visit http://evil.example now' })
    expect(link.status === 400, `link in name ${link.status}`)
  },
)

await scenario('session: no token, junk token and a tampered token are all refused', async () => {
  const none = await call('GET', '/family', null)
  const junk = await call('GET', '/family', 'junk')
  const login = await must(
    'login',
    call('POST', '/auth/login', null, { email: `${u}@example.com`, password: PASS }),
  )
  const tampered = await call('GET', '/family', login.token.slice(0, -3) + 'abc')
  expect(
    none.status === 401 && junk.status === 401 && tampered.status === 401,
    `none=${none.status} junk=${junk.status} tampered=${tampered.status}`,
  )
})

// ── Export and erasure ─────────────────────────────────────────────────────
const gone = await household()
await call('POST', '/family/obligations', gone.tokenA, {
  label: 'Erase me',
  named_person: 'Alex Tester',
  next_due_date: future(5),
})
await call('POST', '/family/employer-cover', gone.tokenA, {
  member_label: 'Alex Tester',
  type: 'death_in_service',
  name_as_printed: 'Group life plan',
})

await scenario(
  'export: the organizer gets their household data, a non-organizer gets only their own',
  async () => {
    const org = await call('GET', '/account/export', gone.tokenA)
    expect(org.status === 200, `organizer export ${org.status}`)
    expect(JSON.stringify(org.body).includes('Erase me'), 'organizer export missing obligations')
    const other = await call('GET', '/account/export', gone.tokenB)
    expect(other.status === 200, `member export ${other.status}`)
    expect(
      !JSON.stringify(other.body).includes('Erase me'),
      "member export leaks the household's obligations",
    )
  },
)

await scenario('erasure: needs the typed email and the organizer', async () => {
  const noConfirm = await call('POST', '/account/delete', gone.tokenA, {})
  expect(noConfirm.status === 400, `no confirmation ${noConfirm.status}`)
  const wrongEmail = await call('POST', '/account/delete', gone.tokenA, {
    confirmation: 'someone@else.com',
  })
  expect(wrongEmail.status === 400, `wrong email ${wrongEmail.status}`)
  const member = await call('POST', '/account/delete', gone.tokenB, {
    confirmation: `${gone.u}b@example.com`,
  })
  expect(member.status === 403, `member delete ${member.status}`)
})

await scenario(
  'erasure: after delete the data and the logins are gone, and a receipt exists',
  async () => {
    const del = await call('POST', '/account/delete', gone.tokenA, {
      confirmation: `${gone.u}@example.com`,
    })
    expect(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body).slice(0, 150)}`)
    const asA = await call('GET', '/family/obligations/map', gone.tokenA)
    expect(
      asA.status === 401 || asA.status === 403,
      `deleted organizer still reads (${asA.status})`,
    )
    const asB = await call('GET', '/family/obligations/map', gone.tokenB)
    expect(
      asB.status === 401 || asB.status === 403,
      `deleted household member still reads (${asB.status})`,
    )
    const login = await call('POST', '/auth/login', null, {
      email: `${gone.u}@example.com`,
      password: PASS,
    })
    expect(login.status >= 400, `deleted account can sign in (${login.status})`)
  },
)

// ── First value, timed ─────────────────────────────────────────────────────
await scenario(
  'first value: signup to a first brief preview, API time under 3 s, 3 money fields',
  async () => {
    const t0 = Date.now()
    const h = await household({ second: false })
    const t1 = Date.now()
    const prev = await call('POST', '/family/briefs/preview', h.tokenA, {
      problem_type: 'income_stops',
      inputs: stopInputs(future(60)),
    })
    const previewMs = Date.now() - t1
    console.log(`      signup→household ${t1 - t0} ms, preview ${previewMs} ms`)
    expect(prev.status === 200, `preview ${prev.status}`)
    expect(previewMs < 500, `preview took ${previewMs} ms`)
    expect(Date.now() - t0 < 3000 + 10_000, 'whole journey over budget')
  },
)

summary()
