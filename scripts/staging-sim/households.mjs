#!/usr/bin/env node
/**
 * UK household simulation against a STAGING deployment.
 *
 *   STAGING_API=https://…  [STAGING_TEST_TOKEN=…]  node scripts/staging-sim/households.mjs [H07] [--md path]
 *
 * Twenty-odd fictional UK households, each told as a short story. Every stage
 * has an EXPECTED OUTCOME written from the family's point of view (what a real
 * household in that situation should experience), not from how the code works.
 * If staging disagrees, that is a finding: either a product gap or a wrong
 * expectation, and the owner decides which.
 *
 * Expectations marked [DECISION] depend on a product call that has not been made;
 * two of them contradict each other on purpose (see H09 and H10).
 *
 * Refuses to run against production. Fictional names, example.test addresses.
 * Exit code 1 when any expectation is not met.
 */
import fs from 'node:fs'

const API = (process.env.STAGING_API ?? '').replace(/\/$/, '')
const TOKEN = process.env.STAGING_TEST_TOKEN ?? ''
const args = process.argv.slice(2)
const mdPath = args.includes('--md') ? args[args.indexOf('--md') + 1] : ''
const ONLY = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--md')[0] ?? ''
if (!API) throw new Error('Set STAGING_API')
const host = new URL(API).hostname
if (
  /(^|\.)lifekeel\.(co\.uk|si)$/.test(host) ||
  (/lifekeel-api-[a-z0-9]+-uc\.a\.run\.app$/.test(host) && !host.includes('staging'))
) {
  throw new Error(`Refusing to run against ${host}: not a staging host`)
}

const RUN = Date.now().toString(36)
const PW = 'Sim-Pass-9x!'
const DAY = 86_400_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

// ── recording ────────────────────────────────────────────────────────────────
const rows = []
let hh = null
/** One expectation: the stage, what the family should experience, and whether it did. */
function S(stage, expected, ok, detail = '', { decision = false } = {}) {
  rows.push({
    household: hh.id,
    title: hh.title,
    stage,
    expected,
    ok: !!ok,
    detail: ok ? '' : String(detail).slice(0, 220),
    decision,
  })
}
const is4xx = (r) => r.status >= 400 && r.status < 500

// ── building blocks ──────────────────────────────────────────────────────────
async function newFamily(first, last) {
  await pace('signup')
  const email = `${first}.${last}.${RUN}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@example.test'
  const r = await call('POST', '/auth/signup', {
    body: {
      email,
      password: PW,
      name: `${first} ${last}`,
      workspace: `sim ${last} ${first} ${RUN}`.toLowerCase().replace(/[^a-z0-9 ]/g, ''),
    },
  })
  if (!r.json?.token) throw new Error(`signup failed ${r.status} ${r.text.slice(0, 120)}`)
  const f = await call('POST', '/family', {
    token: r.json.token,
    body: { name: `The ${last} family ${RUN}` },
  })
  if (f.status >= 300) throw new Error(`family failed ${f.status} ${f.text.slice(0, 120)}`)
  const g = await call('GET', '/family', { token: r.json.token })
  return {
    org: { token: r.json.token, email, name: `${first} ${last}` },
    family: g.json.family,
    last,
  }
}
const roster = async (f) =>
  (await call('GET', '/family', { token: f.org.token })).json.family.members
const member = async (f, name) => (await roster(f)).find((m) => m.name === name)
const emailFor = (name) =>
  `${name}.${RUN}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@example.test'

async function addMember(f, { name, role, dob, label, email }) {
  return call('POST', '/family/members', {
    token: f.org.token,
    body: {
      name,
      email: email ?? emailFor(name),
      role,
      ...(dob ? { date_of_birth: dob } : {}),
      ...(label ? { relationship_label: label } : {}),
    },
  })
}
/** The person asks to join with the family's code; the organizer approves; they sign in. */
async function joinAndApprove(f, name, { email, approve = true } = {}) {
  const addr = email ?? emailFor(name)
  await pace('join')
  const code = (await call('GET', '/family', { token: f.org.token })).json.family.inviteCode
  const j = await call('POST', '/family/join', {
    body: { invite_code: code, name, email: addr, password: PW },
  })
  if (j.status >= 300) return { j, email: addr }
  if (!approve) return { j, email: addr }
  const reqs =
    (await call('GET', '/family/access-requests', { token: f.org.token })).json?.requests ?? []
  const req = reqs.find((x) => x.email === addr)
  const a = req
    ? await call('POST', `/family/access-requests/${req.id}/approve`, { token: f.org.token })
    : { status: 0, text: 'no request listed' }
  await pace('login', 9)
  const l = await call('POST', '/auth/login', { body: { email: addr, password: PW } })
  return { j, a, l, email: addr, token: l.json?.token }
}
const view = (token, d = 'car') => call('GET', `/family/domains/${d}`, { token })
const vehicle = (reg, mot) => ({
  values: { reg, make_model: 'Fictional Hatchback', ...(mot ? { mot_due: mot } : {}) },
})
const addVehicle = (token, reg, mot) =>
  call('POST', '/family/domains/car/records/vehicle', { token, body: vehicle(reg, mot) })
async function confirm(token) {
  const v = (await view(token)).json
  return call('POST', '/family/domains/car/confirm', {
    token,
    body: { result_version: v?.result_version },
  })
}
async function status(token) {
  const c = (await view(token)).json?.confirmation
  return {
    all: c?.both_confirmed === true,
    required: (c?.required ?? []).map((x) => x.name),
    confirmed: (c?.confirmed ?? []).map((x) => x.name),
  }
}
const dateIn = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

const households = []
const household = (id, title, story, fn) => households.push({ id, title, story, fn })

// ═══════════════════════ THE HOUSEHOLDS ═════════════════════════════════════

household(
  'H01',
  'Married couple, two young children',
  'Ada and Ben Pemberton, children aged 7 and 4. Ada sets everything up; Ben joins.',
  async () => {
    const f = await newFamily('Ada', 'Pemberton')
    const o = f.org.token
    S('1 Sign up', 'Ada can sign up and create the family', !!o)
    const c1 = await addMember(f, {
      name: 'Cara Pemberton',
      role: 'child',
      dob: '2019-04-02',
      label: 'shared_child',
    })
    const c2 = await addMember(f, {
      name: 'Dan Pemberton',
      role: 'child',
      dob: '2022-08-19',
      label: 'shared_child',
    })
    S(
      '2 Set up',
      'both children can be added with their birth dates',
      c1.status < 300 && c2.status < 300,
      `${c1.status}/${c2.status}`,
    )
    const ben = await joinAndApprove(f, 'Ben Pemberton')
    S(
      '3 Join',
      'Ben can ask to join with the code, Ada approves, and Ben can then sign in',
      !!ben.token,
      ben.l?.text ?? ben.j?.text,
    )
    const add = await addVehicle(o, 'PEM 001', dateIn(40))
    S(
      '4 The list',
      'Ada can put the family car on the list and it appears once',
      add.status === 201 && (await view(o)).json?.rows?.length === 1,
    )
    let st = await status(o)
    S(
      '5 Seen by everyone',
      'before anyone confirms, the list does not say everyone has seen it',
      st.all === false,
    )
    await confirm(o)
    st = await status(o)
    S(
      '5 Seen by everyone',
      'when only Ada has confirmed, it still waits for Ben',
      st.all === false && st.required.includes('Ben Pemberton'),
      JSON.stringify(st),
    )
    await confirm(ben.token)
    st = await status(o)
    S(
      '5 Seen by everyone',
      'when both parents have confirmed it says every adult has seen it',
      st.all === true,
      JSON.stringify(st),
    )
    S(
      '5 Seen by everyone',
      'the children are not asked to confirm',
      !st.required.some((n) => /Cara|Dan/.test(n)),
      JSON.stringify(st.required),
    )
    await addVehicle(o, 'PEM 002', dateIn(90))
    st = await status(o)
    S('6 Change', 'after the car list changes, both parents must look again', st.all === false)
    const noEdit = await addVehicle(ben.token, 'PEM 003', dateIn(20))
    S(
      '7 Who can do what',
      'Ben cannot change the list until Ada allows it',
      is4xx(noEdit),
      noEdit.status,
    )
    const benId = (await member(f, 'Ben Pemberton'))?.id
    await call('PUT', `/family/members/${benId}/edit-access`, { token: o, body: { enabled: true } })
    const yes = await addVehicle(ben.token, 'PEM 004', dateIn(20))
    S(
      '7 Who can do what',
      'once Ada allows it Ben can change the list straight away, without signing in again',
      yes.status === 201,
      yes.status,
    )
  },
)

household(
  'H02',
  'Cohabiting couple, no children',
  'Elin and Farid share a flat. Elin organizes.',
  async () => {
    const f = await newFamily('Elin', 'Rhodes')
    const o = f.org.token
    const farid = await joinAndApprove(f, 'Farid Aziz')
    S(
      '3 Join',
      'Farid has a different surname and can still join and sign in',
      !!farid.token,
      farid.l?.text ?? farid.j?.text,
    )
    await addVehicle(o, 'RHO 001', dateIn(25))
    await confirm(o)
    S(
      '5 Seen by everyone',
      'with two adults, one confirming is not enough',
      (await status(o)).all === false,
    )
    await confirm(farid.token)
    S('5 Seen by everyone', 'both confirming completes it', (await status(o)).all === true)
    const none = (await call('GET', '/family', { token: o })).json.family.members.filter(
      (m) => m.role === 'child',
    )
    S('2 Set up', 'a household with no children is not asked for any', none.length === 0)
  },
)

household(
  'H03',
  'Single person living alone',
  'Sophie lives alone and keeps her own list.',
  async () => {
    const f = await newFamily('Sophie', 'Ng')
    const o = f.org.token
    await addVehicle(o, 'NG 001', dateIn(15))
    let st = await status(o)
    S('5 Seen by everyone', 'before she confirms it is not marked as seen', st.all === false)
    await confirm(o)
    st = await status(o)
    S(
      '5 Seen by everyone',
      'Sophie confirming on her own completes it (no second adult is needed)',
      st.all === true,
      JSON.stringify(st),
    )
    S(
      '5 Seen by everyone',
      'she is not told she is waiting for someone else',
      st.required.length === 1,
      JSON.stringify(st.required),
    )
  },
)

household(
  'H04',
  'Lone mother with a young son',
  'Mia and Noah, aged 7. No other adult.',
  async () => {
    const f = await newFamily('Mia', 'Hughes')
    const o = f.org.token
    const kid = await addMember(f, {
      name: 'Noah Hughes',
      role: 'child',
      dob: '2019-02-11',
      label: 'my_child',
    })
    S('2 Set up', 'Mia can add her son as "my child"', kid.status < 300, kid.text)
    await addVehicle(o, 'HUG 001', dateIn(30))
    await confirm(o)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'Mia alone completes the confirmation; her son is not required',
      st.all === true && st.required.length === 1,
      JSON.stringify(st),
    )
    const edit = await call(
      'PUT',
      `/family/members/${(await member(f, 'Noah Hughes'))?.id}/edit-access`,
      { token: o, body: { enabled: true } },
    )
    S(
      '7 Who can do what',
      'a child cannot be given the right to change the list',
      edit.status === 400,
      edit.status,
    )
  },
)

household(
  'H05',
  'Lone father with a 16-year-old who has her own login',
  'Karl and Liv. Liv signs in on her own phone.',
  async () => {
    const f = await newFamily('Karl', 'Lindqvist')
    const o = f.org.token
    const liv = 'Liv Lindqvist'
    await addMember(f, {
      name: liv,
      role: 'child',
      dob: dateIn(-365 * 16).slice(0, 10),
      label: 'my_child',
      email: emailFor(liv),
    })
    const j = await joinAndApprove(f, liv, { email: emailFor(liv) })
    S(
      '3 Join',
      'Liv can sign in on her own phone after her father approves',
      !!j.token,
      j.l?.text ?? j.j?.text,
    )
    await addVehicle(o, 'LIN 001', dateIn(30))
    const read = j.token ? await view(j.token) : { status: 0, text: '' }
    S(
      '7 Who can do what',
      "a 16-year-old cannot read the adults' list (she gets an explanation, not the records)",
      read.status !== 200 || !read.text.includes('LIN 001'),
      `${read.status}`,
    )
    const write = j.token ? await addVehicle(j.token, 'LIN 009', dateIn(5)) : { status: 0 }
    S('7 Who can do what', 'she cannot add to the list', is4xx(write), write.status)
    await confirm(o)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'her father alone completes the confirmation; Liv is not asked',
      st.all === true && !st.required.includes(liv),
      JSON.stringify(st),
    )
  },
)

household(
  'H06',
  'Blended family: his child, her child, their child',
  "Dan and Eve. Fay is Dan's, Gus is Eve's, Hal is theirs.",
  async () => {
    const f = await newFamily('Dan', 'Okafor')
    const o = f.org.token
    const a = await addMember(f, {
      name: 'Fay Okafor',
      role: 'child',
      dob: '2014-03-03',
      label: 'my_child',
    })
    const b = await addMember(f, {
      name: 'Gus Bell',
      role: 'child',
      dob: '2016-06-06',
      label: 'partners_child',
    })
    const c = await addMember(f, {
      name: 'Hal Okafor-Bell',
      role: 'child',
      dob: '2023-01-01',
      label: 'shared_child',
    })
    S(
      '2 Set up',
      'all three kinds of child relationship are accepted',
      [a, b, c].every((r) => r.status < 300),
      [a, b, c].map((r) => r.status).join(','),
    )
    const ms = await roster(f)
    S(
      '2 Set up',
      'the relationship shown for each child is the one chosen',
      ['my_child', 'partners_child', 'shared_child'].every((l) =>
        ms.some((m) => m.relationshipLabel === l || m.relationship_label === l),
      ),
      JSON.stringify(ms.map((m) => m.relationshipLabel ?? m.relationship_label)),
    )
    const eve = await joinAndApprove(f, 'Eve Bell')
    await addVehicle(o, 'OKA 001', dateIn(30))
    await confirm(o)
    await confirm(eve.token)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'both adults confirming completes it; none of the three children holds it up',
      st.all === true && st.required.length === 2,
      JSON.stringify(st),
    )
  },
)

household(
  'H07',
  'Separated parents, shared custody',
  'Gareth and Hannah split up. Hannah is the organizer and removes Gareth from the family list.',
  async () => {
    const f = await newFamily('Hannah', 'Price')
    const o = f.org.token
    const gareth = await joinAndApprove(f, 'Gareth Price')
    await addVehicle(o, 'PRI 001', dateIn(30))
    await confirm(o)
    await confirm(gareth.token)
    S('3 Join', 'while together, both could see and confirm', (await status(o)).all === true)
    const gid = (await member(f, 'Gareth Price'))?.id
    const rm = await call('DELETE', `/family/members/${gid}`, { token: o })
    S('8 Separation', 'Hannah can remove Gareth', rm.status < 300, rm.status)
    const still = await view(gareth.token)
    S(
      '8 Separation',
      'Gareth is cut off at once, even though he is still signed in on his phone',
      is4xx(still),
      `${still.status}`,
    )
    const fam = await call('GET', '/family', { token: gareth.token })
    S(
      '8 Separation',
      'Gareth can no longer see anything about the family (names, children, invite code)',
      is4xx(fam) || !fam.text.includes('Price family'),
      `${fam.status} ${fam.text.slice(0, 100)}`,
    )
    await pace('login', 9)
    const again = await call('POST', '/auth/login', { body: { email: gareth.email, password: PW } })
    S('8 Separation', 'Gareth cannot sign in again', is4xx(again), `${again.status}`)
    const st = await status(o)
    S(
      '8 Separation',
      "the list no longer waits for Gareth: Hannah's own confirmation completes it",
      st.all === true && !st.required.includes('Gareth Price'),
      JSON.stringify(st),
    )
    const oldCode = (await call('GET', '/family', { token: o })).json.family.inviteCode
    await call('POST', '/family/invite-code/reset', { token: o })
    await pace('join')
    const back = await call('POST', '/family/join', {
      body: { invite_code: oldCode, name: 'Gareth Price', email: gareth.email, password: PW },
    })
    S(
      '8 Separation',
      'after Hannah changes the invite code, Gareth cannot ask to come back with the old one',
      is4xx(back),
      `${back.status}`,
    )
  },
)

household(
  'H08',
  'Safety first: someone who should not be in tries to join',
  'Ife has left a controlling partner, Marcus, who has found the invite code. Ife must stay in control of who is let in.',
  async () => {
    const f = await newFamily('Ife', 'Adeyemi')
    const o = f.org.token
    const code = f.family.inviteCode
    await pace('join')
    const j = await call('POST', '/family/join', {
      body: {
        invite_code: code,
        name: 'Marcus Adeyemi',
        email: emailFor('marcus.a'),
        password: PW,
      },
    })
    S(
      '3 Join',
      'a request with the code is held until Ife decides, and the person is told only that the family will be asked',
      j.status < 300 && !j.text.includes('Adeyemi family'),
      j.text.slice(0, 140),
    )
    S(
      '3 Join',
      'the person asking learns nothing about who is in the family',
      !/Ife|Adeyemi family|child/i.test(j.text.replace(/Marcus Adeyemi/g, '')),
      j.text.slice(0, 160),
    )
    await pace('login', 9)
    const early = await call('POST', '/auth/login', {
      body: { email: emailFor('marcus.a'), password: PW },
    })
    S(
      '3 Join',
      'Marcus cannot get in while his request is waiting',
      is4xx(early) || !early.json?.token,
      `${early.status}`,
    )
    const reqs = (await call('GET', '/family/access-requests', { token: o })).json?.requests ?? []
    const mine = reqs.find((r) => r.email === emailFor('marcus.a'))
    S('3 Join', 'Ife sees the request and can decline it', !!mine)
    const deny = mine
      ? await call('POST', `/family/access-requests/${mine.id}/deny`, { token: o })
      : { status: 0 }
    S(
      '3 Join',
      'declining removes the request',
      deny.status < 300 &&
        !((await call('GET', '/family/access-requests', { token: o })).json?.requests ?? []).some(
          (r) => r.email === emailFor('marcus.a'),
        ),
    )
    await call('POST', '/family/invite-code/reset', { token: o })
    await pace('join')
    const retry = await call('POST', '/family/join', {
      body: {
        invite_code: code,
        name: 'Marcus Adeyemi',
        email: emailFor('marcus.a'),
        password: PW,
      },
    })
    S(
      '8 Separation',
      'after the code is changed, the old code stops working for him',
      is4xx(retry),
      `${retry.status}`,
    )
    await pace('login', 9)
    const late = await call('POST', '/auth/login', {
      body: { email: emailFor('marcus.a'), password: PW },
    })
    S(
      '8 Separation',
      'Marcus still has no way in',
      is4xx(late) || !late.json?.token,
      `${late.status}`,
    )
  },
)

household(
  'H09',
  'Three generations under one roof',
  'Hana (organizer), her partner Ian, Nan, and Grandad who has not joined. Two children.',
  async () => {
    const f = await newFamily('Hana', 'Okoye')
    const o = f.org.token
    await addMember(f, {
      name: 'Tolu Okoye',
      role: 'child',
      dob: '2016-01-01',
      label: 'shared_child',
    })
    const ian = await joinAndApprove(f, 'Ian Okoye')
    const nan = await joinAndApprove(f, 'Nan Okoye')
    const gr = await addMember(f, {
      name: 'Grandad Okoye',
      role: 'adult',
      email: emailFor('grandad.o'),
    })
    S(
      '2 Set up',
      'Hana can list Grandad as an adult who has not joined yet',
      gr.status < 300,
      gr.text,
    )
    await addVehicle(o, 'OKO 001', dateIn(30))
    await confirm(o)
    await confirm(ian.token)
    await confirm(nan.token)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'the three who have joined confirming does not count as every adult while Grandad has not seen it',
      st.all === false,
      JSON.stringify(st),
      { decision: true },
    )
    S(
      '5 Seen by everyone',
      'the screen names Grandad as the one still to see it',
      st.required.includes('Grandad Okoye'),
      JSON.stringify(st.required),
      { decision: true },
    )
    const nanEdit = await addVehicle(nan.token, 'OKO 009', dateIn(9))
    S(
      '7 Who can do what',
      'Nan cannot change the list unless Hana allows it',
      is4xx(nanEdit),
      nanEdit.status,
    )
    const ianId = (await member(f, 'Ian Okoye'))?.id
    await call('PUT', `/family/members/${ianId}/edit-access`, { token: o, body: { enabled: true } })
    const ianAdd = await addVehicle(ian.token, 'OKO 002', dateIn(12))
    S(
      '7 Who can do what',
      'Hana can let Ian, but not Nan, change the list',
      ianAdd.status === 201 && is4xx(await addVehicle(nan.token, 'OKO 010', dateIn(9))),
    )
  },
)

household(
  'H10',
  'Carer for an adult with a learning disability',
  'Jo cares for her brother Sam, 34. Sam is on the family list but cannot manage confirming things.',
  async () => {
    const f = await newFamily('Jo', 'Barrett')
    const o = f.org.token
    const sam = await addMember(f, { name: 'Sam Barrett', role: 'adult', email: emailFor('sam.b') })
    S('2 Set up', 'Jo can put an adult dependant on the family list', sam.status < 300, sam.text)
    await addVehicle(o, 'BAR 001', dateIn(30))
    await confirm(o)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'Jo confirming completes it; Sam is not held to confirm',
      st.all === true,
      JSON.stringify(st),
      { decision: true },
    )
    const roles = (await roster(f)).map((m) => m.role)
    S(
      '2 Set up',
      'there is a way to mark someone as a dependant adult, not just adult or child',
      roles.includes('dependant') || roles.includes('dependent') || roles.includes('carer'),
      'roles are organizer, parent, adult, child only',
      { decision: true },
    )
  },
)

household(
  'H11',
  'Widowed parent with two children',
  'Wendy lost her husband Tom. She removes him from the list and wants to know what to do next.',
  async () => {
    const f = await newFamily('Wendy', 'Marsh')
    const o = f.org.token
    await addMember(f, { name: 'Tom Marsh', role: 'adult', email: emailFor('tom.m') })
    await addMember(f, { name: 'Kit Marsh', role: 'child', dob: '2015-05-05', label: 'my_child' })
    await addMember(f, { name: 'Lou Marsh', role: 'child', dob: '2018-08-08', label: 'my_child' })
    const tid = (await member(f, 'Tom Marsh'))?.id
    const rm = await call('DELETE', `/family/members/${tid}`, { token: o })
    S('8 Bereavement', 'Wendy can remove Tom from the family list', rm.status < 300, rm.status)
    S(
      '8 Bereavement',
      'Tom no longer appears on the list',
      !(await roster(f)).some((m) => m.name === 'Tom Marsh'),
    )
    const wid = (await member(f, 'Wendy Marsh'))?.id
    const pb = await call('GET', `/family/domains/life_protection/playbook?member=${wid}`, {
      token: o,
    })
    S(
      '8 Bereavement',
      'she can open first steps for a family member, without being asked for anything else',
      pb.status === 200 && pb.text.length > 50,
      `${pb.status} ${pb.text.slice(0, 100)}`,
    )
    await addVehicle(o, 'MAR 001', dateIn(30))
    await confirm(o)
    S(
      '5 Seen by everyone',
      'Wendy alone completes the confirmation',
      (await status(o)).all === true,
    )
  },
)

household('H12', 'Two mums and an adopted daughter', 'Priya and Zara, with Mei, 6.', async () => {
  const f = await newFamily('Priya', 'Nair')
  const o = f.org.token
  const z = await joinAndApprove(f, 'Zara Nair')
  await addMember(f, { name: 'Mei Nair', role: 'child', dob: '2020-09-09', label: 'shared_child' })
  S('3 Join', 'two adults of the same gender join as equals', !!z.token)
  const pages = [
    await call('GET', '/family', { token: o }),
    await view(o),
    await call('GET', '/family/domains', { token: o }),
  ]
  const gendered = pages
    .map((p) => p.text)
    .join(' ')
    .match(/\b(mother|father|husband|wife|mum|dad|mummy|daddy)\b/i)
  S(
    '2 Set up',
    'the product never labels anyone mother, father, husband or wife',
    !gendered,
    gendered?.[0] ?? '',
  )
  await addVehicle(o, 'NAI 001', dateIn(30))
  await confirm(o)
  await confirm(z.token)
  S('5 Seen by everyone', 'both mums confirming completes it', (await status(o)).all === true)
})

household(
  'H13',
  'Aunt raising her niece (kinship care)',
  'Kiran looks after her niece Asha, 9, who is not her own child.',
  async () => {
    const f = await newFamily('Kiran', 'Bhatt')
    const o = f.org.token
    const a = await addMember(f, {
      name: 'Asha Bhatt',
      role: 'child',
      dob: '2017-07-07',
      label: 'other_child',
    })
    S(
      '2 Set up',
      'Kiran can add a child who is not hers, with a label that says so',
      a.status < 300,
      a.text,
    )
    await addVehicle(o, 'BHA 001', dateIn(30))
    await confirm(o)
    S(
      '5 Seen by everyone',
      'Kiran alone completes the confirmation',
      (await status(o)).all === true,
    )
  },
)

household(
  'H14',
  'Three friends sharing a house',
  'Lena, Mo and Nell, all in their twenties, run a shared car list.',
  async () => {
    const f = await newFamily('Lena', 'Voss')
    const o = f.org.token
    const mo = await joinAndApprove(f, 'Mo Salah')
    const nell = await joinAndApprove(f, 'Nell Brandt')
    S('3 Join', 'both housemates can join with different surnames', !!mo.token && !!nell.token)
    await addVehicle(o, 'VOS 001', dateIn(30))
    await confirm(o)
    await confirm(mo.token)
    let st = await status(o)
    S(
      '5 Seen by everyone',
      'two of three confirming is not enough',
      st.all === false && st.required.length === 3,
      JSON.stringify(st),
    )
    await confirm(nell.token)
    S('5 Seen by everyone', 'all three confirming completes it', (await status(o)).all === true)
    await addVehicle(o, 'VOS 002', dateIn(60))
    await confirm(o)
    await confirm(mo.token)
    const nid = (await member(f, 'Nell Brandt'))?.id
    await call('DELETE', `/family/members/${nid}`, { token: o })
    st = await status(o)
    S(
      '8 Someone leaves',
      'when Nell moves out, the list stops waiting for her',
      st.all === true && !st.required.includes('Nell Brandt'),
      JSON.stringify(st),
    )
  },
)

household(
  'H15',
  'Adult children at home, and a 17-year-old',
  'Rohan, 19, and Rina, 17, live with their parents Sunita and Vik.',
  async () => {
    const f = await newFamily('Sunita', 'Mehta')
    const o = f.org.token
    const vik = await joinAndApprove(f, 'Vik Mehta')
    const dob17 = dateIn(-Math.round(365.25 * 17 + 30))
    await addMember(f, { name: 'Rina Mehta', role: 'adult', dob: dob17, email: emailFor('rina.m') })
    const rina = await joinAndApprove(f, 'Rina Mehta', { email: emailFor('rina.m') })
    S('3 Join', 'Rina, 17, can sign in', !!rina.token, rina.l?.text ?? rina.j?.text)
    await addVehicle(o, 'MEH 001', dateIn(30))
    await confirm(o)
    await confirm(vik.token)
    const st = await status(o)
    S(
      '5 Seen by everyone',
      'a 17-year-old is treated as a child: she is not asked to confirm, even if listed as an adult',
      st.all === true && !st.required.includes('Rina Mehta'),
      JSON.stringify(st),
    )
    const w = rina.token ? await addVehicle(rina.token, 'MEH 009', dateIn(5)) : { status: 0 }
    S('7 Who can do what', 'Rina cannot change the list', is4xx(w), w.status)
  },
)

household(
  'H16',
  'Self-employed couple with two cars',
  'Omar and Pat both drive for work; one MOT is overdue, one is soon, one is far off.',
  async () => {
    const f = await newFamily('Omar', 'Haddad')
    const o = f.org.token
    await addVehicle(o, 'HAD OVER', dateIn(-10))
    await addVehicle(o, 'HAD SOON', dateIn(10))
    await addVehicle(o, 'HAD NEXT', dateIn(20))
    await addVehicle(o, 'HAD FAR', dateIn(200))
    const up = (await view(o)).json?.upcoming ?? []
    S(
      '4 The list',
      'the overdue MOT is shown first, so it cannot be missed',
      up[0]?.days < 0,
      JSON.stringify(up.map((u) => u.days)),
    )
    S(
      '4 The list',
      'then the soonest, then the next, in date order',
      up.length >= 3 && up.slice(1).every((u, i, a) => i === 0 || a[i - 1].days <= u.days),
      JSON.stringify(up.map((u) => u.days)),
    )
    S(
      '4 The list',
      'a date months away is not nagged about yet',
      !up.some((u) => u.days > 100),
      JSON.stringify(up.map((u) => u.days)),
    )
  },
)

household(
  'H17',
  'Handing over the family list to a partner',
  'Quinn has been organizer but his partner Rae now runs the household admin.',
  async () => {
    const f = await newFamily('Quinn', 'Doyle')
    const o = f.org.token
    const rae = await joinAndApprove(f, 'Rae Doyle')
    const rid = (await member(f, 'Rae Doyle'))?.id
    const p = await call('PATCH', `/family/members/${rid}`, {
      token: o,
      body: { role: 'organizer' },
    })
    S(
      '8 Handover',
      'Quinn can make Rae an organizer',
      p.status < 300,
      `${p.status} ${p.text.slice(0, 100)}`,
    )
    await pace('join')
    const code = (await call('GET', '/family', { token: o })).json.family.inviteCode
    await call('POST', '/family/join', {
      body: { invite_code: code, name: 'Sid Doyle', email: emailFor('sid.d'), password: PW },
    })
    const reqs =
      (await call('GET', '/family/access-requests', { token: rae.token })).json?.requests ?? []
    S(
      '8 Handover',
      'Rae can then see and approve join requests straight away',
      reqs.length > 0,
      'Rae sees no requests',
    )
    const ok =
      reqs[0] &&
      (await call('POST', `/family/access-requests/${reqs[0].id}/approve`, { token: rae.token }))
    S('8 Handover', 'and approve them', !!ok && ok.status < 300, ok?.status)
  },
)

household(
  'H18',
  'A street of names from everywhere',
  'Welsh, Irish, Polish, Somali, Tamil, Chinese and Nigerian names, with apostrophes, accents and hyphens.',
  async () => {
    const names = [
      'Siobhán Ó Briain',
      'Ceri ap Rhys',
      'Józef Wiśniewski-Ng',
      'Mohamed Al-Farsi',
      'Priya Raghunathan-Iyer',
      'Ngozi Okonkwo-Bell',
      "D'Arcy O'Neill",
      '陈小明',
    ]
    const f = await newFamily(names[0].split(' ')[0], 'Mixed')
    for (const [i, n] of names.slice(1).entries())
      await addMember(f, {
        name: n,
        role: i % 2 ? 'child' : 'adult',
        dob: i % 2 ? '2015-01-01' : undefined,
        email: emailFor(`n${i}`),
      })
    const back = (await roster(f)).map((m) => m.name.normalize('NFC'))
    const missing = names.slice(1).filter((n) => !back.includes(n.normalize('NFC')))
    S(
      '2 Set up',
      'every name is kept exactly as typed (accents, apostrophes, hyphens, Chinese characters)',
      missing.length === 0,
      `changed or lost: ${missing.join(', ')}`,
    )
    const v = await view(f.org.token)
    S(
      '4 The list',
      'the list screen loads for a household with these names',
      v.status === 200,
      `${v.status}`,
    )
  },
)

household(
  'H19',
  'Three families called Smith',
  'The Smiths, all picking the same family name on the same day.',
  async () => {
    const email = (i) => `smith${i}.${RUN}@example.test`
    const tries = []
    for (let i = 0; i < 3; i++) {
      await pace('signup')
      tries.push(
        await call('POST', '/auth/signup', {
          body: {
            email: email(i),
            password: PW,
            name: 'Alex Smith',
            workspace: `the smith family ${RUN}`,
          },
        }),
      )
    }
    const ok = tries.filter((t) => t.status === 201)
    S('1 Sign up', 'the first Smith gets in', ok.length >= 1, tries.map((t) => t.status).join(','))
    S(
      '1 Sign up',
      'the others are told the name is taken and can choose another, not shown an error',
      tries.slice(1).every((t) => t.status === 409 && /taken|another/i.test(t.text)),
      tries.map((t) => `${t.status} ${t.text.slice(0, 60)}`).join(' | '),
    )
    await pace('signup')
    const again = await call('POST', '/auth/signup', {
      body: {
        email: email(1),
        password: PW,
        name: 'Alex Smith',
        workspace: `the smith family ${RUN} b`,
      },
    })
    S(
      '1 Sign up',
      'the second Smith succeeds with a different name',
      again.status === 201,
      `${again.status} ${again.text.slice(0, 80)}`,
    )
  },
)

household(
  'H20',
  'Large extended family',
  'Four adults and five children in one house.',
  async () => {
    const f = await newFamily('Ada', 'Eze')
    const adults = []
    for (const n of ['Bola Eze', 'Chidi Eze', 'Dayo Eze']) adults.push(await joinAndApprove(f, n))
    for (let i = 1; i <= 5; i++)
      await addMember(f, {
        name: `Child${i} Eze`,
        role: 'child',
        dob: `20${14 + (i % 6)}-0${i}-0${i}`,
        label: 'shared_child',
      })
    await addVehicle(f.org.token, 'EZE 001', dateIn(30))
    await confirm(f.org.token)
    for (const a of adults.slice(0, 2)) await confirm(a.token)
    let st = await status(f.org.token)
    S(
      '5 Seen by everyone',
      'three of four adults confirming is not enough',
      st.all === false,
      JSON.stringify(st),
    )
    await confirm(adults[2].token)
    st = await status(f.org.token)
    S(
      '5 Seen by everyone',
      'all four adults confirming completes it; the five children are not asked',
      st.all === true && st.required.length === 4,
      JSON.stringify(st),
    )
    const t0 = Date.now()
    await view(f.org.token)
    S(
      '4 The list',
      'the list opens in under 3 seconds',
      Date.now() - t0 < 3000,
      `${Date.now() - t0}ms`,
    )
  },
)

household(
  'H21',
  'A new partner moves in',
  'Tess and her new partner Uri. The family list already exists and has been confirmed.',
  async () => {
    const f = await newFamily('Tess', 'Allen')
    const o = f.org.token
    await addVehicle(o, 'ALL 001', dateIn(30))
    await confirm(o)
    S('5 Seen by everyone', 'Tess alone had completed it', (await status(o)).all === true)
    const uri = await joinAndApprove(f, 'Uri Katz')
    const st = await status(o)
    S(
      '3 Join',
      'once Uri joins, the list is no longer shown as seen by every adult until he has looked',
      st.all === false && st.required.includes('Uri Katz'),
      JSON.stringify(st),
    )
    await confirm(uri.token)
    S(
      '5 Seen by everyone',
      'when Uri confirms it is complete again',
      (await status(o)).all === true,
    )
  },
)

household(
  'H22',
  'A partner who waited too long (needs staging controls)',
  'Val asked her partner to join but never approved; two weeks later it lapses.',
  async () => {
    const probe = TOKEN
      ? await call('POST', '/staging/control/age-join-request', {
          body: {},
          headers: { 'x-staging-token': TOKEN },
        })
      : null
    if (!probe || probe.json?.error === 'Invalid token' || [401, 404].includes(probe.status)) {
      rows.push({
        household: hh.id,
        title: hh.title,
        stage: '8 Time',
        expected: 'a request nobody answers lapses after 14 days and the person can ask again',
        ok: null,
        detail: 'SKIPPED: staging controls are not available',
        decision: false,
      })
      return
    }
    const f = await newFamily('Val', 'Gordon')
    await pace('join')
    const addr = emailFor('wil.g')
    await call('POST', '/family/join', {
      body: { invite_code: f.family.inviteCode, name: 'Wil Gordon', email: addr, password: PW },
    })
    await call('POST', '/staging/control/age-join-request', {
      body: { email: addr, days: 15 },
      headers: { 'x-staging-token': TOKEN },
    })
    const reqs =
      (await call('GET', '/family/access-requests', { token: f.org.token })).json?.requests ?? []
    S(
      '8 Time',
      "after 14 days the unanswered request has gone from Val's list",
      !reqs.some((r) => r.email === addr),
      JSON.stringify(reqs.map((r) => r.email)),
    )
    await pace('join')
    const again = await call('POST', '/family/join', {
      body: { invite_code: f.family.inviteCode, name: 'Wil Gordon', email: addr, password: PW },
    })
    S(
      '8 Time',
      'Wil can ask again and is not told he already asked',
      again.status < 300,
      `${again.status} ${again.text.slice(0, 100)}`,
    )
  },
)

// ═══════════════════════ RUNNER ═════════════════════════════════════════════
const started = Date.now()
for (const h of households) {
  if (ONLY && h.id !== ONLY) continue
  hh = h
  const before = rows.length
  try {
    await h.fn()
  } catch (err) {
    rows.push({
      household: h.id,
      title: h.title,
      stage: 'Set up',
      expected: 'the household can be created',
      ok: false,
      detail: String(err?.message ?? err).slice(0, 200),
      decision: false,
    })
  }
  const mine = rows.slice(before)
  const bad = mine.filter((r) => r.ok === false).length
  console.log(
    `${bad ? 'FAIL' : 'PASS'}  ${h.id}  ${h.title}  (${mine.filter((r) => r.ok).length}/${mine.length})`,
  )
}
const failed = rows.filter((r) => r.ok === false)
const skipped = rows.filter((r) => r.ok === null)
console.log(
  `\n${rows.length - failed.length - skipped.length} met, ${failed.length} not met, ${skipped.length} skipped, ${Math.round((Date.now() - started) / 1000)}s  [run ${RUN}]\n`,
)
for (const f of failed)
  console.log(
    `✗ ${f.household} [${f.stage}] ${f.expected}${f.decision ? ' [DECISION]' : ''}\n    got: ${f.detail}`,
  )

if (mdPath) {
  const out = [
    `# UK household simulation: expected outcomes and results`,
    ``,
    `Run ${RUN} against staging. Expectations are written from the family's point of view, not from the code. **Not met** is a finding: a product gap, or an expectation the owner should change. [DECISION] marks expectations that depend on a product call.`,
    ``,
  ]
  for (const h of households.filter((x) => rows.some((r) => r.household === x.id))) {
    out.push(
      `## ${h.id} ${h.title}`,
      ``,
      `_${h.story}_`,
      ``,
      `| Stage | The family should experience | Result |`,
      `|---|---|---|`,
    )
    for (const r of rows.filter((x) => x.household === h.id))
      out.push(
        `| ${r.stage} | ${r.expected}${r.decision ? ' **[DECISION]**' : ''} | ${r.ok === null ? 'skipped' : r.ok ? 'met' : `**not met**: ${r.detail.replace(/\|/g, '/')}`} |`,
      )
    out.push(``)
  }
  fs.writeFileSync(mdPath, out.join('\n'))
  console.log(`\nWrote ${mdPath}`)
}
process.exit(failed.length ? 1 : 0)
