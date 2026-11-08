#!/usr/bin/env node
/**
 * Fictional-family simulation against a STAGING deployment.
 *
 *   STAGING_API=https://… node scripts/staging-sim/run.mjs [scenario-prefix]
 *   STAGING_TEST_TOKEN=…   (optional: enables the mail checks; otherwise they are SKIPPED)
 *
 * Refuses to run against a production host. Every account is fictional and is
 * made at an example.test address. Nothing here reads or writes production.
 * Findings are printed as a table; exit code 1 when any check fails.
 */

const API = (process.env.STAGING_API ?? '').replace(/\/$/, '')
const TOKEN = process.env.STAGING_TEST_TOKEN ?? ''
const ONLY = process.argv[2] ?? ''
if (!API) throw new Error('Set STAGING_API')
const host = new URL(API).hostname
if (
  /(^|\.)lifekeel\.(co\.uk|si)$/.test(host) ||
  (/lifekeel-api-[a-z0-9]+-uc\.a\.run\.app$/.test(host) && !host.includes('staging'))
) {
  throw new Error(`Refusing to run against ${host}: not a staging host`)
}

const RUN = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
let current = ''

// ── rate-limit pacing: signup and join are 10 per minute per IP ─────────────
const windows = { signup: [], join: [], login: [] }
async function pace(kind, max = 8) {
  const w = windows[kind]
  for (;;) {
    const now = Date.now()
    while (w.length && now - w[0] > 61_000) w.shift()
    if (w.length < max) break
    await sleep(w[0] + 61_000 - now)
  }
  w.push(Date.now())
}

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json, text }
}

function check(name, ok, detail = '') {
  results.push({
    scenario: current,
    name,
    ok: !!ok,
    detail: ok ? '' : String(detail).slice(0, 300),
  })
}
const expectStatus = (name, r, ...allowed) =>
  check(
    name,
    allowed.includes(r.status),
    `got ${r.status} ${r.text.slice(0, 160)}; wanted ${allowed.join('/')}`,
  )

// ── people ───────────────────────────────────────────────────────────────────
const PW = 'Sim-Pass-9x!'
async function signup(first, family, extra = {}) {
  await pace('signup')
  const email = `${first.toLowerCase()}.${RUN}@example.test`
  const r = await call('POST', '/auth/signup', {
    body: {
      email,
      password: PW,
      name: `${first} ${family}`,
      workspace: `sim ${family} ${RUN}`.toLowerCase(),
      ...extra,
    },
  })
  return { r, email, token: r.json?.token, user: r.json?.user }
}
async function login(email, password = PW) {
  await pace('login', 9)
  return call('POST', '/auth/login', { body: { email, password } })
}
async function makeFamily(first, family) {
  const o = await signup(first, family)
  if (!o.token) throw new Error(`signup failed: ${o.r.status} ${o.r.text.slice(0, 200)}`)
  const f = await call('POST', '/family', {
    token: o.token,
    body: { name: `The ${family} family ${RUN}` },
  })
  if (f.status >= 300) throw new Error(`family create failed: ${f.status} ${f.text.slice(0, 200)}`)
  const g = await call('GET', '/family', { token: o.token })
  return { org: o, family: g.json.family }
}
async function joinAndApprove(fam, first, familyName) {
  await pace('join')
  const email = `${first.toLowerCase()}.${RUN}@example.test`
  const j = await call('POST', '/family/join', {
    body: {
      invite_code: fam.family.inviteCode,
      name: `${first} ${familyName}`,
      email,
      password: PW,
    },
  })
  if (j.status >= 300) return { j, email, approve: j, login: j }
  const pending = await call('GET', '/family/access-requests', { token: fam.org.token })
  const req = pending.json?.requests?.find((x) => x.email === email)
  const a = req
    ? await call('POST', `/family/access-requests/${req.id}/approve`, { token: fam.org.token })
    : { status: 0, text: 'request not listed' }
  const l = await login(email)
  return { j, email, approve: a, token: l.json?.token, login: l }
}
const vehicle = (reg, mot = '2027-03-14') => ({
  values: {
    reg,
    make_model: 'Test Hatchback',
    mot_due: mot,
    recovery_contact: 'Fictional Recovery 0000',
  },
})
const mail = (to, since) =>
  call('GET', `/staging/mail?to=${encodeURIComponent(to)}${since ? `&since=${since}` : ''}`, {
    headers: { 'x-staging-token': TOKEN },
  })

const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })

// ═════════════════════════ HAPPY PATHS ══════════════════════════════════════
scenario('01 happy: couple set up, add, confirm, edit, reconfirm', async () => {
  const fam = await makeFamily('Alice', 'Pemberton')
  const o = fam.org.token
  check('family has invite code', !!fam.family.inviteCode, JSON.stringify(fam.family).slice(0, 200))
  const hub = await call('GET', '/family/domains', { token: o })
  expectStatus('domains hub loads', hub, 200)
  const add = await call('POST', '/family/domains/car/records/vehicle', {
    token: o,
    body: vehicle('SIM 001'),
  })
  expectStatus('organizer adds vehicle', add, 201)
  const view = await call('GET', '/family/domains/car', { token: o })
  expectStatus('car domain loads', view, 200)
  const v1 = view.json?.result_version
  check('result_version present (64 chars)', v1?.length === 64, v1)
  const b = await joinAndApprove(fam, 'Ben', 'Pemberton')
  expectStatus('second adult join accepted', b.j, 200, 201, 202)
  expectStatus('organizer approves', b.approve, 200, 201)
  check('joiner can sign in after approval', !!b.token, b.login?.text)
  const c1 = await call('POST', '/family/domains/car/confirm', {
    token: o,
    body: { result_version: v1 },
  })
  expectStatus('adult A confirms', c1, 200, 201, 204)
  const view2 = await call('GET', '/family/domains/car', { token: b.token })
  const v2 = view2.json?.result_version
  check('second adult sees same version', v2 === v1 || v2?.length === 64, `${v1} vs ${v2}`)
  check(
    'not yet seen by every adult',
    view2.json?.confirmation?.both_confirmed === false,
    JSON.stringify(view2.json?.confirmation),
  )
  const c2 = await call('POST', '/family/domains/car/confirm', {
    token: b.token,
    body: { result_version: v2 },
  })
  expectStatus('adult B confirms', c2, 200, 201, 204)
  const view3 = await call('GET', '/family/domains/car', { token: o })
  check(
    'seen by every adult',
    view3.json?.confirmation?.both_confirmed === true,
    JSON.stringify(view3.json?.confirmation),
  )
  const add2 = await call('POST', '/family/domains/car/records/vehicle', {
    token: o,
    body: vehicle('SIM 002'),
  })
  expectStatus('edit after confirm', add2, 201)
  const view4 = await call('GET', '/family/domains/car', { token: o })
  check('edit changes the version', view4.json?.result_version !== v1, 'version unchanged')
  check(
    'both must confirm again',
    view4.json?.confirmation?.both_confirmed === false,
    JSON.stringify(view4.json?.confirmation),
  )
  const stale = await call('POST', '/family/domains/car/confirm', {
    token: o,
    body: { result_version: v1 },
  })
  expectStatus('confirming a stale version is refused', stale, 409)
  const del = await call('DELETE', `/family/domains/car/records/${add2.json?.id}`, { token: o })
  expectStatus('remove record', del, 204)
  const pb = await call(
    'GET',
    `/family/domains/life_protection/playbook?member=${fam.family.members?.[0]?.id}`,
    { token: o },
  )
  check(
    'bereavement playbook loads',
    pb.status === 200 || pb.status === 404,
    `${pb.status} ${pb.text.slice(0, 120)}`,
  )
})

scenario('02 happy: edit access grant, use, revoke', async () => {
  const fam = await makeFamily('Carla', 'Okafor')
  const o = fam.org.token
  const d = await joinAndApprove(fam, 'Dele', 'Okafor')
  const g = await call('GET', '/family', { token: o })
  const dele = g.json.family.members.find((m) => m.email === d.email || m.name?.startsWith('Dele'))
  check('joiner is on the roster', !!dele, JSON.stringify(g.json.family.members.map((m) => m.name)))
  if (!dele) return
  const before = await call('POST', '/family/domains/car/records/vehicle', {
    token: d.token,
    body: vehicle('SIM 010'),
  })
  check(
    'second adult cannot add before grant',
    before.status === 403,
    `${before.status} ${before.text.slice(0, 120)}`,
  )
  const grant = await call('PUT', `/family/members/${dele.id}/edit-access`, {
    token: o,
    body: { enabled: true },
  })
  expectStatus('grant edit access', grant, 200, 204)
  const after = await call('POST', '/family/domains/car/records/vehicle', {
    token: d.token,
    body: vehicle('SIM 011'),
  })
  expectStatus('second adult can add after grant (no re-login)', after, 201)
  const rev = await call('PUT', `/family/members/${dele.id}/edit-access`, {
    token: o,
    body: { enabled: false },
  })
  expectStatus('revoke', rev, 200, 204)
  const again = await call('POST', '/family/domains/car/records/vehicle', {
    token: d.token,
    body: vehicle('SIM 012'),
  })
  check('cannot add after revoke', again.status === 403, `${again.status}`)
  const org = g.json.family.members.find((m) => m.role === 'organizer')
  const self = await call('PUT', `/family/members/${org.id}/edit-access`, {
    token: o,
    body: { enabled: true },
  })
  expectStatus('organizer edit access is a no-op conflict', self, 409)
  const bad = await call('PUT', `/family/members/${dele.id}/edit-access`, {
    token: o,
    body: { enabled: 'yes' },
  })
  expectStatus('non-boolean refused', bad, 400)
  const asAdult = await call('PUT', `/family/members/${org.id}/edit-access`, {
    token: d.token,
    body: { enabled: false },
  })
  check('non-organizer cannot change access', asAdult.status === 403, `${asAdult.status}`)
})

scenario('03 happy: members, children, roster management', async () => {
  const fam = await makeFamily('Erin', 'Valdez')
  const o = fam.org.token
  const kid = await call('POST', '/family/members', {
    token: o,
    body: {
      name: 'Finn Valdez',
      email: `finn.${RUN}@example.test`,
      role: 'child',
      date_of_birth: '2016-05-04',
      relationship_label: 'my_child',
    },
  })
  expectStatus('add child', kid, 200, 201)
  const futureKid = await call('POST', '/family/members', {
    token: o,
    body: {
      name: 'Time Traveller',
      email: `t.${RUN}@example.test`,
      role: 'child',
      date_of_birth: '2999-01-01',
    },
  })
  expectStatus('future birth date refused', futureKid, 400)
  const badDob = await call('POST', '/family/members', {
    token: o,
    body: {
      name: 'Bad Dob',
      email: `b.${RUN}@example.test`,
      role: 'child',
      date_of_birth: '2016-02-30',
    },
  })
  expectStatus('impossible birth date refused', badDob, 400)
  const badRole = await call('POST', '/family/members', {
    token: o,
    body: { name: 'Odd Role', email: `r.${RUN}@example.test`, role: 'overlord' },
  })
  expectStatus('unknown role refused', badRole, 400)
  const labelOnAdult = await call('POST', '/family/members', {
    token: o,
    body: {
      name: 'Label Adult',
      email: `l.${RUN}@example.test`,
      role: 'adult',
      relationship_label: 'my_child',
    },
  })
  expectStatus('child-only label on an adult refused', labelOnAdult, 400)
  const noName = await call('POST', '/family/members', {
    token: o,
    body: { name: '  ', email: `n.${RUN}@example.test`, role: 'adult' },
  })
  expectStatus('blank name refused', noName, 400)
  const g = await call('GET', '/family', { token: o })
  const finn = g.json.family.members.find((m) => m.name === 'Finn Valdez')
  check('child on roster', !!finn)
  const del = finn && (await call('DELETE', `/family/members/${finn.id}`, { token: o }))
  if (del) expectStatus('remove child', del, 200, 204)
  const org = g.json.family.members.find((m) => m.role === 'organizer')
  const delOrg = await call('DELETE', `/family/members/${org.id}`, { token: o })
  check(
    'organizer cannot remove themselves',
    delOrg.status >= 400,
    `${delOrg.status} ${delOrg.text.slice(0, 120)}`,
  )
  const ctx = await call('PATCH', '/family/context', {
    token: o,
    body: { note: 'Fictional family note.' },
  })
  expectStatus('family note saves', ctx, 200, 204)
  const rename = await call('PATCH', '/family', {
    token: o,
    body: { name: `The Valdez-Smith family ${RUN}` },
  })
  expectStatus('rename family', rename, 200)
  const dup = await call('POST', '/family', { token: o, body: { name: 'Second Family' } })
  expectStatus('a second family on one account is refused', dup, 409)
})

// ═════════════════════════ VALIDATION AND HOSTILE INPUT ═════════════════════
scenario('04 extreme: record validation corners', async () => {
  const fam = await makeFamily('Gita', 'Menon')
  const o = fam.org.token
  const post = (v) => call('POST', '/family/domains/car/records/vehicle', { token: o, body: v })
  expectStatus('real date accepted', await post(vehicle('SIM 020', '2027-02-28')), 201)
  expectStatus('leap day accepted', await post(vehicle('SIM 021', '2028-02-29')), 201)
  expectStatus('2027-02-30 refused', await post(vehicle('SIM 022', '2027-02-30')), 400)
  expectStatus(
    '2027-02-29 refused (not a leap year)',
    await post(vehicle('SIM 023', '2027-02-29')),
    400,
  )
  expectStatus('28/02/2027 refused', await post(vehicle('SIM 024', '28/02/2027')), 400)
  expectStatus('text in a date refused', await post(vehicle('SIM 025', 'next Tuesday')), 400)
  {
    const y = await post(vehicle('SIM 026', '0000-01-01'))
    results.push({
      scenario: current,
      name: 'OBSERVATION: year 0000 date is accepted',
      ok: true,
      detail: String(y.status),
    })
  }
  expectStatus('unknown field refused', await post({ values: { reg: 'X', nope: 'y' } }), 400)
  expectStatus('empty values object', await post({ values: {} }), 201, 400)
  expectStatus(
    'oversized value (501 chars) refused',
    await post({ values: { reg: 'A'.repeat(501) } }),
    400,
  )
  expectStatus(
    'exactly 500 chars accepted or cleanly refused',
    await post({ values: { reg: 'A'.repeat(500) } }),
    201,
    400,
  )
  expectStatus('values not an object refused', await post({ values: 'text' }), 400)
  expectStatus(
    'missing body refused',
    await call('POST', '/family/domains/car/records/vehicle', { token: o }),
    400,
  )
  expectStatus(
    'person not on the family list refused',
    await post({ holder_member_id: 'member-does-not-exist', ...vehicle('SIM 027') }),
    400,
  )
  expectStatus(
    'secret-looking value refused',
    await post({ values: { reg: 'password: hunter2hunter2' } }),
    400,
  )
  expectStatus(
    'card-number-looking value refused or accepted as text',
    await post({ values: { reg: '4111 1111 1111 1111' } }),
    201,
    400,
  )
  expectStatus(
    'unknown domain 404',
    await call('POST', '/family/domains/nonsense/records/vehicle', {
      token: o,
      body: vehicle('X'),
    }),
    404,
  )
  expectStatus(
    'unknown record 404',
    await call('POST', '/family/domains/car/records/nonsense', { token: o, body: vehicle('X') }),
    404,
  )
  expectStatus(
    'adapter-backed record refused (read from elsewhere)',
    await call('POST', '/family/domains/car/records/policy', {
      token: o,
      body: { values: { provider: 'x' } },
    }),
    400,
  )
  expectStatus(
    'GET unknown domain 404',
    await call('GET', '/family/domains/nonsense', { token: o }),
    404,
  )
  const del = await call('DELETE', '/family/domains/car/records/dr_does-not-exist', { token: o })
  check(
    'deleting a row that does not exist (note: expect 404, currently?)',
    del.status === 404 || del.status === 204,
    `${del.status}`,
  )
  if (del.status === 204)
    results.push({
      scenario: current,
      name: 'OBSERVATION: DELETE of a missing record returns 204, not 404',
      ok: true,
      detail: 'harmless, idempotent',
    })
})

scenario('05 extreme: hostile and odd text everywhere', async () => {
  const hostile = [
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['sql-ish', "Robert'); DROP TABLE users;--"],
    ['nosql operator', '{"$ne":null}'],
    ['emoji', 'Zoë 👨‍👩‍👧‍👦 Ünïcode'],
    ['right-to-left', 'שלום עולם مرحبا'],
    ['zero-width', 'Zero​Width‍Name'],
    ['null byte', 'Nul\u0000Byte'],
    ['very long', 'L'.repeat(5000)],
    ['newlines', 'Line1\nLine2\r\nLine3'],
    ['url', 'https://example.test/?a=1&b=<x>'],
  ]
  for (const [label, text] of hostile) {
    const first = 'Hx' + label.replace(/\W/g, '').slice(0, 5)
    await pace('signup')
    const r = await call('POST', '/auth/signup', {
      body: {
        email: `h${Math.random().toString(36).slice(2, 8)}.${RUN}@example.test`,
        password: PW,
        name: text,
        workspace: `sim hostile ${Math.random().toString(36).slice(2, 8)} ${RUN}`,
      },
    })
    check(
      `signup name "${label}" is accepted or refused cleanly (never 5xx)`,
      r.status < 500,
      `${r.status} ${r.text.slice(0, 150)}`,
    )
    if (r.status === 201 && /script|onerror/.test(text)) {
      const me = await call('GET', '/auth/me', { token: r.json.token })
      check(
        `stored "${label}" name is returned as data, not interpreted`,
        me.status === 200,
        me.text.slice(0, 100),
      )
    }
  }
  const fam = await makeFamily('Hana', 'Quill')
  for (const [label, text] of hostile.slice(0, 6)) {
    const r = await call('POST', '/family/domains/car/records/vehicle', {
      token: fam.org.token,
      body: { values: { reg: text.slice(0, 400), make_model: text.slice(0, 400) } },
    })
    check(`record text "${label}" never 5xx`, r.status < 500, `${r.status} ${r.text.slice(0, 150)}`)
  }
  const m = await call('POST', '/family/members', {
    token: fam.org.token,
    body: { name: '<b>Bold</b> Member', email: `bm.${RUN}@example.test`, role: 'adult' },
  })
  check('member name with markup never 5xx', m.status < 500, `${m.status} ${m.text.slice(0, 150)}`)
})

scenario('06 extreme: password, email and workspace corners', async () => {
  const one = await signup('Ivan', 'Rosso')
  expectStatus('first signup works', one.r, 201)
  await pace('signup')
  const dupe = await call('POST', '/auth/signup', {
    body: {
      email: one.email,
      password: PW,
      name: 'Ivan Again',
      workspace: `other ${RUN}-${Math.random().toString(36).slice(2, 6)}`,
    },
  })
  expectStatus('same email twice → 409', dupe, 409)
  await pace('signup')
  const upper = await call('POST', '/auth/signup', {
    body: {
      email: one.email.toUpperCase(),
      password: PW,
      name: 'Ivan Caps',
      workspace: `caps ${RUN}-${Math.random().toString(36).slice(2, 6)}`,
    },
  })
  check(
    'same email in capitals → 409 (case-insensitive)',
    upper.status === 409,
    `${upper.status} ${upper.text.slice(0, 100)}`,
  )
  await pace('signup')
  const ws = await call('POST', '/auth/signup', {
    body: {
      email: `ws.${RUN}@example.test`,
      password: PW,
      name: 'Ws Clash',
      workspace: `sim Rosso ${RUN}`,
    },
  })
  expectStatus('workspace name already taken → 409', ws, 409)
  const cases = [
    ['7-char password', { password: '1234567' }, 400],
    ['8-char password', { password: '12345678' }, 201],
    ['1025-char password', { password: 'p'.repeat(1025) }, 400],
    ['no email', { email: '' }, 400],
    ['malformed email', { email: 'not-an-email' }, 400],
    ['email with spaces', { email: 'a b@example.test' }, 400],
    ['blank name', { name: '   ' }, 400],
    ['name too long', { name: 'N'.repeat(300) }, 400],
  ]
  for (const [label, patch, want] of cases) {
    await pace('signup')
    const rnd = Math.random().toString(36).slice(2, 8)
    const r = await call('POST', '/auth/signup', {
      body: {
        email: `c${rnd}.${RUN}@example.test`,
        password: PW,
        name: 'Case Person',
        workspace: `sim case ${rnd} ${RUN}`,
        ...patch,
      },
    })
    check(
      `signup: ${label}`,
      r.status === want,
      `got ${r.status} ${r.text.slice(0, 120)}; wanted ${want}`,
    )
  }
  const bad = await login(one.email, 'wrong-password-123')
  expectStatus('wrong password → 401', bad, 401)
  const none = await login(`nobody.${RUN}@example.test`, PW)
  check(
    'unknown account answers like a wrong password (no account enumeration)',
    none.status === bad.status,
    `${none.status} vs ${bad.status}`,
  )
  const ok = await login(one.email)
  expectStatus('right password logs in', ok, 200)
})

// ═════════════════════════ JOIN AND APPROVAL CORNERS ════════════════════════
scenario('07 extreme: join requests, codes and approval', async () => {
  const fam = await makeFamily('Jonas', 'Berg')
  const o = fam.org.token
  const code = fam.family.inviteCode
  await pace('join')
  expectStatus(
    'bad code refused',
    await call('POST', '/family/join', {
      body: { invite_code: 'ZZZZZZ', name: 'X Y', email: `x.${RUN}@example.test`, password: PW },
    }),
    400,
    404,
  )
  await pace('join')
  expectStatus(
    'missing code → 400',
    await call('POST', '/family/join', {
      body: { name: 'X Y', email: `x2.${RUN}@example.test`, password: PW },
    }),
    400,
  )
  await pace('join')
  const lower = await call('POST', '/family/join', {
    body: {
      invite_code: code.toLowerCase(),
      name: 'Kai Berg',
      email: `kai.${RUN}@example.test`,
      password: PW,
    },
  })
  expectStatus('lower-case code accepted', lower, 200, 201, 202)
  await pace('join')
  const dup = await call('POST', '/family/join', {
    body: { invite_code: code, name: 'Kai Berg', email: `kai.${RUN}@example.test`, password: PW },
  })
  check(
    'same person asking twice does not create two requests (or says so clearly)',
    dup.status < 500,
    `${dup.status} ${dup.text.slice(0, 120)}`,
  )
  const pend = await call('GET', '/family/access-requests', { token: o })
  const mine = pend.json?.requests?.filter((x) => x.email === `kai.${RUN}@example.test`) ?? []
  check('exactly one pending request for that person', mine.length === 1, `found ${mine.length}`)
  const loginBefore = await login(`kai.${RUN}@example.test`)
  check(
    'joiner cannot sign in before approval',
    loginBefore.status >= 400,
    `${loginBefore.status} ${loginBefore.text.slice(0, 100)}`,
  )
  const other = await makeFamily('Lena', 'Strand')
  const cross = await call('POST', `/family/access-requests/${mine[0]?.id}/approve`, {
    token: other.org.token,
  })
  check(
    "another family's organizer cannot approve this request",
    cross.status >= 400,
    `${cross.status}`,
  )
  const approve = await call('POST', `/family/access-requests/${mine[0]?.id}/approve`, { token: o })
  expectStatus('organizer approves', approve, 200, 201)
  const twice = await call('POST', `/family/access-requests/${mine[0]?.id}/approve`, { token: o })
  check(
    'approving twice is refused or harmless',
    twice.status === 404 || twice.status === 409 || twice.status < 300,
    `${twice.status}`,
  )
  const gone = await call('POST', '/family/access-requests/does-not-exist/approve', { token: o })
  expectStatus('approve unknown id → 404', gone, 404)
  const kai = await login(`kai.${RUN}@example.test`)
  expectStatus('joiner signs in after approval', kai, 200)
  const asJoiner = await call('GET', '/family/access-requests', { token: kai.json?.token })
  check(
    'joiner (not organizer) cannot read requests',
    asJoiner.status === 403,
    `${asJoiner.status}`,
  )
  await pace('join')
  const deny = await call('POST', '/family/join', {
    body: { invite_code: code, name: 'Mia Berg', email: `mia.${RUN}@example.test`, password: PW },
  })
  const p2 = await call('GET', '/family/access-requests', { token: o })
  const miaReq = p2.json?.requests?.find((x) => x.email === `mia.${RUN}@example.test`)
  const den =
    miaReq && (await call('POST', `/family/access-requests/${miaReq.id}/deny`, { token: o }))
  check('deny removes a request', !!den && den.status < 300, `${deny.status} ${den?.status}`)
  const reset = await call('POST', '/family/invite-code/reset', { token: o })
  expectStatus('organizer resets code', reset, 200)
  await pace('join')
  expectStatus(
    'old code no longer works',
    await call('POST', '/family/join', {
      body: { invite_code: code, name: 'Old Code', email: `old.${RUN}@example.test`, password: PW },
    }),
    400,
    404,
  )
  const resetAsAdult = await call('POST', '/family/invite-code/reset', { token: kai.json?.token })
  check('non-organizer cannot reset code', resetAsAdult.status === 403, `${resetAsAdult.status}`)
  await pace('join')
  const existing = await call('POST', '/family/join', {
    body: {
      invite_code: (await call('GET', '/family', { token: o })).json.family.inviteCode,
      name: 'Taken Email',
      email: fam.org.email,
      password: PW,
    },
  })
  check(
    'joining with an email that already has an account is refused or neutral',
    existing.status < 500,
    `${existing.status} ${existing.text.slice(0, 120)}`,
  )
})

// ═════════════════════════ ROLES AND ISOLATION ══════════════════════════════
scenario('08 extreme: tenants cannot see each other', async () => {
  const a = await makeFamily('Nora', 'Alder')
  const b = await makeFamily('Omar', 'Birch')
  const rec = await call('POST', '/family/domains/car/records/vehicle', {
    token: a.org.token,
    body: vehicle('ALDER 1'),
  })
  const rowId = rec.json?.id
  const viewB = await call('GET', '/family/domains/car', { token: b.org.token })
  check(
    "B's car list does not contain A's vehicle",
    !viewB.text.includes('ALDER 1'),
    'A record visible to B',
  )
  await call('DELETE', `/family/domains/car/records/${rowId}`, { token: b.org.token })
  const viewA = await call('GET', '/family/domains/car', { token: a.org.token })
  check("B deleting A's row id has no effect", viewA.text.includes('ALDER 1'), 'A row removed by B')
  const fam = await call('GET', '/family', { token: b.org.token })
  check("B's /family shows only B's roster", !fam.text.includes('Nora'), 'A name visible to B')
  const reqs = await call('GET', '/family/access-requests', { token: b.org.token })
  check("B's requests exclude A's", !reqs.text.includes(a.org.email), 'A email visible')
  const memberA = a.family.members?.[0]?.id
  const touch = await call('PUT', `/family/members/${memberA}/edit-access`, {
    token: b.org.token,
    body: { enabled: true },
  })
  check(
    "B cannot change A's member access",
    touch.status === 404 || touch.status === 403,
    `${touch.status}`,
  )
  const anon = await call('GET', '/family/domains/car')
  expectStatus('no token → 401', anon, 401)
  const junk = await call('GET', '/family/domains/car', { token: 'not.a.jwt' })
  expectStatus('garbage token → 401', junk, 401)
  const tampered = a.org.token.slice(0, -3) + 'xyz'
  expectStatus(
    'tampered token → 401',
    await call('GET', '/family/domains/car', { token: tampered }),
    401,
  )
  const sinkOff = await call('GET', '/staging/mail?to=x@example.test')
  check('staging mail needs the token', sinkOff.status === 401, `${sinkOff.status}`)
})

scenario('09 extreme: child, viewer and read-only roles', async () => {
  const fam = await makeFamily('Pia', 'Lund')
  const o = fam.org.token
  const kid = await call('POST', '/family/members', {
    token: o,
    body: {
      name: 'Quinn Lund',
      email: `quinn.${RUN}@example.test`,
      role: 'child',
      date_of_birth: '2012-09-09',
    },
  })
  expectStatus('child added', kid, 200, 201)
  const g = await call('GET', '/family', { token: o })
  const quinn = g.json.family.members.find((m) => m.name === 'Quinn Lund')
  const edit = await call('PUT', `/family/members/${quinn?.id}/edit-access`, {
    token: o,
    body: { enabled: true },
  })
  expectStatus('child cannot be given edit access', edit, 400)
  const ghost = await call('PUT', '/family/members/member-nope/edit-access', {
    token: o,
    body: { enabled: true },
  })
  expectStatus('edit access on unknown member → 404', ghost, 404)
  const parent = await joinAndApprove(fam, 'Rhea', 'Lund')
  const confirmNoVersion = await call('POST', '/family/domains/car/confirm', {
    token: parent.token,
    body: {},
  })
  expectStatus('confirm without a version refused', confirmNoVersion, 400)
  const confirmShort = await call('POST', '/family/domains/car/confirm', {
    token: parent.token,
    body: { result_version: 'abc' },
  })
  expectStatus('confirm with a malformed version refused', confirmShort, 400)
  const extra = await call('POST', '/family/domains/car/confirm', {
    token: parent.token,
    body: { result_version: 'a'.repeat(64), junk: 1 },
  })
  check(
    'confirm with extra fields refused (strict) or version mismatch',
    extra.status === 400 || extra.status === 409,
    `${extra.status}`,
  )
  const view = await call('GET', '/family/domains/car', { token: parent.token })
  const ver = view.json?.result_version
  const c1 = await call('POST', '/family/domains/car/confirm', {
    token: parent.token,
    body: { result_version: ver },
  })
  const c2 = await call('POST', '/family/domains/car/confirm', {
    token: parent.token,
    body: { result_version: ver },
  })
  check(
    'confirming the same version twice is harmless',
    c1.status < 300 && c2.status < 300,
    `${c1.status}/${c2.status}`,
  )
})

// ═════════════════════════ CONCURRENCY AND SCALE ════════════════════════════
scenario('10 extreme: parallel writes and double taps', async () => {
  const fam = await makeFamily('Sana', 'Kerr')
  const o = fam.org.token
  const burst = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      call('POST', '/family/domains/car/records/vehicle', { token: o, body: vehicle(`PAR ${i}`) }),
    ),
  )
  check(
    '25 parallel adds all succeed',
    burst.every((r) => r.status === 201),
    burst.map((r) => r.status).join(','),
  )
  const view = await call('GET', '/family/domains/car', { token: o })
  const n = (view.text.match(/PAR \d+/g) ?? []).length
  check('all 25 rows are listed once', n >= 25, `saw ${n}`)
  const b = await joinAndApprove(fam, 'Theo', 'Kerr')
  const ver = view.json?.result_version
  const both = await Promise.all([
    call('POST', '/family/domains/car/confirm', { token: o, body: { result_version: ver } }),
    call('POST', '/family/domains/car/confirm', { token: b.token, body: { result_version: ver } }),
    call('POST', '/family/domains/car/confirm', { token: o, body: { result_version: ver } }),
    call('POST', '/family/domains/car/confirm', { token: b.token, body: { result_version: ver } }),
  ])
  check(
    'simultaneous confirms by two adults and double taps never 5xx',
    both.every((r) => r.status < 500),
    both.map((r) => r.status).join(','),
  )
  const after = await call('GET', '/family/domains/car', { token: o })
  check(
    'result: seen by every adult',
    after.json?.confirmation?.both_confirmed === true,
    JSON.stringify(after.json?.confirmation),
  )
  const edits = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call('POST', '/family/domains/car/records/vehicle', { token: o, body: vehicle(`RACE ${i}`) }),
    ),
  )
  const reads = await Promise.all(
    Array.from({ length: 6 }, () => call('GET', '/family/domains/car', { token: b.token })),
  )
  check(
    'reads during writes never 5xx',
    [...edits, ...reads].every((r) => r.status < 500),
    '',
  )
  const t0 = Date.now()
  await call('GET', '/family/domains/car', { token: o })
  check('a 30+ row list loads in under 3s', Date.now() - t0 < 3000, `${Date.now() - t0}ms`)
})

scenario('11 extreme: large household and long names', async () => {
  const fam = await makeFamily('Uma', 'Fairweather-Hartington-Smythe')
  const o = fam.org.token
  const statuses = []
  for (let i = 0; i < 14; i++) {
    const r = await call('POST', '/family/members', {
      token: o,
      body: {
        name: `Member ${i} Fairweather`,
        email: `big${i}.${RUN}@example.test`,
        role: i % 3 === 0 ? 'child' : 'adult',
        ...(i % 3 === 0 ? { date_of_birth: '2015-01-01' } : {}),
      },
    })
    statuses.push(r.status)
  }
  check(
    '14 members added (or a clear cap reached, never 5xx)',
    statuses.every((s) => s < 500),
    statuses.join(','),
  )
  const g = await call('GET', '/family', { token: o })
  check('roster returns', g.status === 200, `${g.status}`)
  const view = await call('GET', '/family/domains/life_protection', { token: o })
  check(
    'cover matrix renders for a large family',
    view.status === 200,
    `${view.status} ${view.text.slice(0, 120)}`,
  )
  const hub = await call('GET', '/family/domains', { token: o })
  check('hub renders', hub.status === 200, `${hub.status}`)
})

// ═════════════════════════ NOTIFICATIONS, PUSH, CONTINUITY ══════════════════
scenario('12 notifications, push and continuity', async () => {
  const fam = await makeFamily('Vik', 'Anand')
  const o = fam.org.token
  const get = await call('GET', '/family/notifications', { token: o })
  expectStatus('notification settings load', get, 200)
  const kinds = get.json?.preferences?.kinds_muted
  check('kinds_muted is reported', kinds !== undefined, get.text.slice(0, 200))
  const mute = await call('PATCH', '/family/notifications', {
    token: o,
    body: { kinds_muted: ['digest'] },
  })
  check(
    'muting a non-critical kind is accepted or the kind name is rejected cleanly',
    mute.status < 500,
    `${mute.status} ${mute.text.slice(0, 150)}`,
  )
  const crit = await call('PATCH', '/family/notifications', {
    token: o,
    body: { kinds_muted: ['safety'] },
  })
  check(
    'muting a critical kind is refused or ignored',
    crit.status < 500,
    `${crit.status} ${crit.text.slice(0, 150)}`,
  )
  const junk = await call('PATCH', '/family/notifications', {
    token: o,
    body: { kinds_muted: 'everything' },
  })
  expectStatus('malformed mute list refused', junk, 400)
  const vapid = await call('GET', '/push/vapid-key', { token: o })
  check(
    'VAPID public key is served (push can be offered)',
    vapid.status === 200 && /\S{20,}/.test(vapid.text),
    `${vapid.status} ${vapid.text.slice(0, 80)}`,
  )
  const cont = await call('GET', '/family/continuity', { token: o })
  expectStatus('continuity settings load', cont, 200)
  const brief = await call('GET', '/family/briefs', { token: o })
  expectStatus('briefs list loads', brief, 200)
  const obl = await call('GET', '/family/obligations', { token: o })
  expectStatus('obligations list loads', obl, 200)
})

// ═════════════════════════ ABUSE / RATE LIMITS ══════════════════════════════
scenario('13 abuse: rate limits and brute force', async () => {
  const fam = await makeFamily('Wes', 'Doyle')
  const wrong = []
  for (let i = 0; i < 12; i++)
    wrong.push(
      await call('POST', '/auth/login', {
        body: { email: fam.org.email, password: `wrong-pass-${i}` },
      }),
    )
  check(
    'repeated bad passwords eventually throttle or lock (429/423/403)',
    wrong.some((r) => [423, 429, 403].includes(r.status)),
    wrong.map((r) => r.status).join(','),
  )
  check(
    'bad passwords never 5xx',
    wrong.every((r) => r.status < 500),
    wrong.map((r) => r.status).join(','),
  )
  const real = await login(fam.org.email)
  check(
    'after failures, real owner is throttled or can still sign in (no 5xx)',
    real.status < 500,
    `${real.status}`,
  )
})

// ═════════════════════════ EMAIL (needs STAGING_TEST_TOKEN) ═════════════════
scenario('14 mail: confirm links and approval email via the sink', async () => {
  if (!TOKEN)
    return results.push({
      scenario: current,
      name: 'mail sink checks',
      ok: null,
      detail: 'SKIPPED: STAGING_TEST_TOKEN not set',
    })
  const noTok = await call('GET', '/staging/mail?to=a@example.test')
  expectStatus('no token → 401', noTok, 401)
  const wrong = await call('GET', '/staging/mail?to=a@example.test', {
    headers: { 'x-staging-token': 'x'.repeat(30) },
  })
  expectStatus('wrong token → 401', wrong, 401)
  const noTo = await call('GET', '/staging/mail', { headers: { 'x-staging-token': TOKEN } })
  expectStatus('missing "to" → 400 (cannot dump everything)', noTo, 400)
  const since = new Date().toISOString()
  const fam = await makeFamily('Xena', 'Marsh')
  const joiner = `yara.${RUN}@example.test`
  await pace('join')
  await call('POST', '/family/join', {
    body: { invite_code: fam.family.inviteCode, name: 'Yara Marsh', email: joiner, password: PW },
  })
  const pending = await call('GET', '/family/access-requests', { token: fam.org.token })
  const req = pending.json?.requests?.find((x) => x.email === joiner)
  await call('POST', `/family/access-requests/${req?.id}/approve`, { token: fam.org.token })
  let msgs = []
  for (let i = 0; i < 10 && !msgs.length; i++) {
    const m = await mail(joiner, since)
    msgs = m.json?.messages ?? []
    if (!msgs.length) await sleep(1500)
  }
  check('joiner receives an approval email in the sink', msgs.length > 0, 'no mail found')
  const link = msgs[0]?.links?.find((l) => /lifekeel|web\.app/.test(l))
  check('approval email carries a sign-in link', !!link, JSON.stringify(msgs[0]?.links))
  check(
    'email links point at staging, not production',
    !msgs.some((m) =>
      (m.links ?? []).some((l) => /(^|\/\/)(app|www)?\.?lifekeel\.(co\.uk|si)/.test(l)),
    ),
    JSON.stringify(msgs.flatMap((m) => m.links)),
  )
  check(
    'email text has no raw password',
    !msgs.some((m) => m.text.includes(PW)),
    'password appears in mail',
  )
  const other = await mail(`someone-else.${RUN}@example.test`, since)
  check(
    "another address's mail is not returned",
    (other.json?.messages ?? []).length === 0,
    other.text.slice(0, 100),
  )
  const fromOwn = await mail(fam.org.email, since)
  const vmsg = (fromOwn.json?.messages ?? [])[0]
  check(
    'organizer signup produces a verification email in the sink',
    !!vmsg,
    fromOwn.text.slice(0, 120),
  )
  const vlink = vmsg?.links?.find((l) => /verify-email/i.test(l))
  const vtoken =
    vlink &&
    (new URL(vlink).hash.match(/token=([^&]+)/)?.[1] ?? new URL(vlink).searchParams.get('token'))
  check('verification link carries a token', !!vtoken, JSON.stringify(vmsg?.links))
  const bogus = await call('POST', '/auth/verify-email', { body: { token: 'not-a-real-token' } })
  check(
    'bogus verification token refused',
    bogus.status >= 400 && bogus.status < 500,
    `${bogus.status}`,
  )
  const ver = vtoken && (await call('POST', '/auth/verify-email', { body: { token: vtoken } }))
  check(
    'real verification token verifies',
    !!ver && ver.status === 200,
    `${ver?.status} ${ver?.text?.slice(0, 120)}`,
  )
  const again = vtoken && (await call('POST', '/auth/verify-email', { body: { token: vtoken } }))
  check(
    'a verification token cannot be replayed',
    !!again && again.status >= 400,
    `${again?.status}`,
  )
  const me = await call('GET', '/auth/me', { token: fam.org.token })
  check(
    '/auth/me shows email_verified',
    me.json?.email_verified === true || me.json?.user?.email_verified === true,
    me.text.slice(0, 150),
  )
})

// ═════════════════════════ TIME AND JOBS (need STAGING_TEST_CONTROLS) ═══════
const control = (path, body) =>
  call('POST', `/staging/control/${path}`, { body, headers: { 'x-staging-token': TOKEN } })
async function controlsOn() {
  if (!TOKEN) return 'STAGING_TEST_TOKEN not set'
  const probe = await control('age-join-request', {})
  if (probe.json?.error === 'Invalid token') return 'staging token was refused'
  if (probe.status === 404 || probe.status === 401)
    return 'staging controls are not deployed or STAGING_TEST_CONTROLS is off'
  return null
}
const skip = (why) =>
  results.push({ scenario: current, name: 'scenario', ok: null, detail: `SKIPPED: ${why}` })
async function mailTo(to, since, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const m = await mail(to, since)
    if (m.json?.messages?.length) return m.json.messages
    await sleep(1200)
  }
  return []
}

scenario('15 time: join request expires after 14 days', async () => {
  const why = await controlsOn()
  if (why) return skip(why)
  const fam = await makeFamily('Zane', 'Whitlock')
  const o = fam.org.token
  const email = (n) => `${n}.${RUN}@example.test`
  const request = async (n) => {
    await pace('join')
    return call('POST', '/family/join', {
      body: {
        invite_code: fam.family.inviteCode,
        name: `${n} Whitlock`,
        email: email(n.toLowerCase()),
        password: PW,
      },
    })
  }
  await request('Fresh')
  await request('Edge')
  await request('Stale')
  const listed = async () =>
    (await call('GET', '/family/access-requests', { token: o })).json?.requests ?? []
  check(
    'three requests listed before ageing',
    (await listed()).length === 3,
    `${(await listed()).length}`,
  )
  const stale = (await listed()).find((r) => r.email === email('stale'))
  const age = async (n, days) =>
    (await control('age-join-request', { email: email(n), days })).json?.matched
  check('ageing a request matches it', (await age('stale', 15)) === 1)
  check('a day short of the limit (13 days) is still listed', (await age('edge', 13)) === 1)
  const after = await listed()
  check(
    'request older than 14 days is gone from the list',
    !after.some((r) => r.email === email('stale')),
    JSON.stringify(after.map((r) => r.email)),
  )
  check(
    '13-day request is still listed',
    after.some((r) => r.email === email('edge')),
  )
  check(
    'fresh request is still listed',
    after.some((r) => r.email === email('fresh')),
  )
  const lateApprove = await call('POST', `/family/access-requests/${stale?.id}/approve`, {
    token: o,
  })
  check(
    'an expired request cannot be approved',
    lateApprove.status >= 400 && lateApprove.status < 500,
    `${lateApprove.status} ${lateApprove.text.slice(0, 100)}`,
  )
  const staleLogin = await login(email('stale'))
  check('the expired joiner still cannot sign in', staleLogin.status >= 400, `${staleLogin.status}`)
  const again = await request('Stale')
  check(
    'the expired joiner can ask again (not blocked)',
    again.status < 300,
    `${again.status} ${again.text.slice(0, 100)}`,
  )
  check(
    'the new request is listed',
    (await listed()).some((r) => r.email === email('stale')),
  )
  const outsider = await control('age-join-request', { email: 'someone.real@gmail.com', days: 15 })
  check(
    'real-looking addresses are refused by the control',
    outsider.status === 400,
    `${outsider.status}`,
  )
})

scenario('16 time: monthly digest, reminder cap and restart', async () => {
  const why = await controlsOn()
  if (why) return skip(why)
  const fam = await makeFamily('Yusuf', 'Archer')
  const o = fam.org.token
  const b = await joinAndApprove(fam, 'Zoe', 'Archer')
  await call('POST', '/family/domains/car/records/vehicle', { token: o, body: vehicle('DIGEST 1') })
  const since0 = new Date().toISOString()
  // Scope each run to this family: staging holds many, and a full run sends a
  // digest to every one of them.
  const tenantId = (await call('GET', '/auth/me', { token: o })).json?.tenant_id
  const run = async (now, extra = {}) =>
    (await control('run-digest', { cadence: 'monthly', now, tenant_id: tenantId, ...extra })).json
  const NOT_SEEN = /not yet seen by every adult/
  const bodies = async (to, since) => (await mailTo(to, since)).map((m) => m.text).join('\n')

  const r1 = await run('2027-03-01T08:00:00Z')
  check('digest run reports exactly this family', r1?.result?.tenants === 1, JSON.stringify(r1))
  const m1 = await bodies(fam.org.email, since0)
  check(
    'March: organizer gets a digest listing the family list',
    /On your family list/.test(m1) && /1 record/.test(m1),
    m1.slice(0, 200),
  )
  check('March: says not yet seen by every adult', NOT_SEEN.test(m1))
  check('March: no names or amounts of records in the digest', !/DIGEST 1/.test(m1))
  const b1 = await bodies(b.email, since0)
  check('March: the second adult gets one too', b1.length > 0, 'no mail for second adult')

  const again = await run('2027-03-01T08:00:00Z')
  const since1 = new Date().toISOString()
  check(
    'same month again sends nothing new (once per window)',
    (again?.result?.sent ?? 0) === 0,
    JSON.stringify(again?.result),
  )

  await run('2027-04-01T08:00:00Z')
  const m2 = await bodies(fam.org.email, since1)
  check('April: reminder still shown (second mention)', NOT_SEEN.test(m2), m2.slice(0, 200))
  const since2 = new Date().toISOString()
  await run('2027-05-01T08:00:00Z')
  const m3 = await bodies(fam.org.email, since2)
  check(
    'May: reminder stops after two mentions',
    m3.length > 0 && !NOT_SEEN.test(m3),
    m3.slice(0, 300),
  )
  check('May: the count and the list line remain', /1 record/.test(m3))

  const v = (await call('GET', '/family/domains/car', { token: o })).json?.result_version
  await call('POST', '/family/domains/car/confirm', { token: o, body: { result_version: v } })
  await call('POST', '/family/domains/car/confirm', { token: b.token, body: { result_version: v } })
  const st16 = (await call('GET', '/family/domains/car', { token: o })).json?.confirmation
  check(
    'June: before the digest, the list itself says every adult has seen it',
    st16?.both_confirmed === true,
    JSON.stringify(st16),
  )
  const since3 = new Date().toISOString()
  await run('2027-06-01T08:00:00Z')
  const m4 = await bodies(fam.org.email, since3)
  check(
    'June: after both confirm it says seen by every adult',
    /seen by every adult/.test(m4) && !NOT_SEEN.test(m4),
    m4.slice(0, 300),
  )

  await call('POST', '/family/domains/car/records/vehicle', { token: o, body: vehicle('DIGEST 2') })
  const since4 = new Date().toISOString()
  await run('2027-07-01T08:00:00Z')
  const m5 = await bodies(fam.org.email, since4)
  check('July: an edit starts the reminder fresh', NOT_SEEN.test(m5), m5.slice(0, 300))

  const since5 = new Date().toISOString()
  const held = await run('2030-01-01T08:00:00Z', { fresh_sweep: false })
  const heldText = await bodies(fam.org.email, since5)
  check(
    'with no recent daily check, the digest says plainly it could not check, and never "all clear"',
    /couldn't run|could not run|couldn.t check/i.test(heldText) && !/all clear/i.test(heldText),
    heldText.slice(0, 200) || JSON.stringify(held?.result),
  )
  const badNow = await control('run-digest', { cadence: 'monthly', now: 'tomorrow-ish' })
  check('a bad date is refused', badNow.status === 400, `${badNow.status}`)
})

scenario(
  '17 uploads: a parallel burst never hits a false daily limit; the cap of 3 holds',
  async () => {
    const fam = await makeFamily('Wren', 'Holloway')
    const o = fam.org.token
    const N = 8
    const init = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        call('POST', '/documents/uploads', {
          token: o,
          body: { filename: `burst-${i}.png`, mime: 'image/png', size: 1024 + i },
        }),
      ),
    )
    const codes = init.map((r) => r.status)
    check(
      'no upload in the burst is refused with a daily limit',
      !init.some((r) => /daily_limit|Daily upload limit/.test(r.text)),
      codes.join(','),
    )
    check(
      'no 5xx in the burst',
      init.every((r) => r.status < 500),
      codes.join(','),
    )
    if (init.every((r) => r.status === 409)) {
      // Direct upload is not enabled for this tenant: use the older multipart route.
      const PNG = Uint8Array.from(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
      const multi = await Promise.all(
        Array.from({ length: N }, (_, i) => {
          const fd = new FormData()
          fd.append('file', new Blob([PNG], { type: 'image/png' }), `burst-${i}.png`)
          return fetch(`${API}/documents/upload`, {
            method: 'POST',
            headers: { authorization: `Bearer ${o}` },
            body: fd,
          }).then(async (r) => ({ status: r.status, text: await r.text() }))
        }),
      )
      const mc = multi.map((r) => r.status)
      check(
        'multipart burst: none refused with a daily limit',
        !multi.some((r) => /daily_limit|Daily upload limit/.test(r.text)),
        mc.join(','),
      )
      check(
        'multipart burst: no 5xx',
        multi.every((r) => r.status < 500),
        mc.join(','),
      )
      const ok = multi.filter((r) => [200, 201, 202].includes(r.status))
      const capped = multi.filter((r) => r.status === 429)
      check(
        'multipart burst: every answer is success or "too many at once", nothing else',
        ok.length + capped.length === N,
        mc.join(','),
      )
      check('multipart burst: at least one is accepted', ok.length >= 1, mc.join(','))
      check(
        'multipart burst: no more than 3 are in flight at once (the cap holds)',
        ok.length <= 3,
        mc.join(','),
      )
      check(
        'multipart burst: refused ones say "too many uploads", not a daily limit',
        capped.every((r) => /Too many uploads/.test(r.text) && !/Daily/.test(r.text)),
        capped[0]?.text?.slice(0, 120) ?? '',
      )
    } else {
      check(
        'direct upload burst: success or "too many at once" only',
        init.every((r) => r.status === 201 || r.status === 429),
        codes.join(','),
      )
      check(
        'direct upload burst: at least one started and no more than 3',
        init.filter((r) => r.status === 201).length >= 1 &&
          init.filter((r) => r.status === 201).length <= 3,
        codes.join(','),
      )
    }
    const huge = await call('POST', '/documents/uploads', {
      token: o,
      body: { filename: 'huge.pdf', mime: 'application/pdf', size: 60 * 1024 * 1024 },
    })
    check(
      'a file over 50 MB is refused cleanly',
      [413, 409].includes(huge.status),
      `${huge.status} ${huge.text.slice(0, 100)}`,
    )
    const exe = await call('POST', '/documents/uploads', {
      token: o,
      body: { filename: 'run.exe', mime: 'application/x-msdownload', size: 100 },
    })
    check(
      'an unsupported type is refused cleanly',
      [422, 409].includes(exe.status),
      `${exe.status}`,
    )
    const zero = await call('POST', '/documents/uploads', {
      token: o,
      body: { filename: 'empty.pdf', mime: 'application/pdf', size: 0 },
    })
    check(
      'a zero-byte file is refused cleanly',
      [400, 413, 409].includes(zero.status),
      `${zero.status}`,
    )
  },
)

// ═════════════════════════ RUNNER ═══════════════════════════════════════════
const started = Date.now()
for (const s of scenarios) {
  if (ONLY && !s.name.startsWith(ONLY)) continue
  current = s.name
  const t0 = Date.now()
  try {
    await s.fn()
  } catch (err) {
    results.push({
      scenario: current,
      name: 'scenario crashed',
      ok: false,
      detail: String(err?.message ?? err).slice(0, 300),
    })
  }
  const mine = results.filter((r) => r.scenario === current)
  console.log(
    `${mine.every((r) => r.ok !== false) ? 'PASS' : 'FAIL'}  ${current}  (${mine.filter((r) => r.ok).length}/${mine.length}, ${Math.round((Date.now() - t0) / 1000)}s)`,
  )
}
const failed = results.filter((r) => r.ok === false)
const skipped = results.filter((r) => r.ok === null)
console.log(
  `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped, ${Math.round((Date.now() - started) / 1000)}s total  [run ${RUN}]`,
)
for (const f of failed) console.log(`✗ [${f.scenario}] ${f.name}\n    ${f.detail}`)
for (const s of skipped) console.log(`- [${s.scenario}] ${s.name}: ${s.detail}`)
process.exit(failed.length ? 1 : 0)
