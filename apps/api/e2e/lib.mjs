// Minimal black-box harness for the use-case e2e (PRD-231..235). Talks to a
// running API over HTTP only; each run creates its own disposable tenant.
export const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3401'

const letters = (n) => n.toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)])

let seq = 0
export const uniq = () => `e2e${letters(Date.now())}${letters(++seq)}`

export async function call(method, path, token, body, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (res.status === 429 && attempt < 12) {
    // Per-minute rate limit on signup/join: wait the advertised time, then retry.
    const m = /retry in (\d+) seconds/.exec(text)
    await new Promise((r) => setTimeout(r, ((m ? Number(m[1]) : 5) + 1) * 1000))
    return call(method, path, token, body, attempt + 1)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: res.status, body: json }
}

export async function must(label, p) {
  const r = await p
  if (r.status >= 300) throw new Error(`${label} -> ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

/** Organizer + (optionally) a second adult approved into the same household. */
export async function household({ second = true } = {}) {
  const u = uniq()
  const a = await must(
    'signup',
    call('POST', '/auth/signup', null, {
      email: `${u}@example.com`,
      password: 'e2e-pass-12345',
      name: 'Alex Tester',
      workspace: u,
    }),
  )
  const tokenA = a.token
  const fam = await must('family', call('POST', '/family', tokenA, { name: `${u} family` }))
  const out = { tokenA, family: fam, u }
  if (second) {
    const code = fam.inviteCode ?? fam.family?.inviteCode ?? fam.invite_code
    const emailB = `${u}b@example.com`
    await must(
      'join',
      call('POST', '/family/join', null, {
        invite_code: code,
        name: 'Sam Tester',
        email: emailB,
        password: 'e2e-pass-12345',
      }),
    )
    const reqs = await must('requests', call('GET', '/family/access-requests', tokenA))
    const list = reqs.requests ?? reqs
    await must('approve', call('POST', `/family/access-requests/${list[0].id}/approve`, tokenA, {}))
    const login = await must(
      'login',
      call('POST', '/auth/login', null, { email: emailB, password: 'e2e-pass-12345' }),
    )
    out.tokenB = login.token
  }
  out.group = await must('group', call('GET', '/family', tokenA))
  return out
}

const results = []
export async function scenario(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message ?? e) })
    console.log(`FAIL  ${name}\n      ${String(e.message ?? e).split('\n')[0]}`)
  }
}
export function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}
export function summary() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exitCode = failed.length ? 1 : 0
}
