import type { FullConfig } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const API_BASE = process.env['E2E_API_BASE'] ?? 'http://localhost:3001'
const WEB_BASE = process.env['E2E_WEB_BASE'] ?? 'http://localhost:3002'

/**
 * Signs up a fresh, disposable tenant for this test run (never reuses a
 * shared account, so the suite is self-contained and doesn't depend on, or
 * mutate, anyone's real or long-lived test data) and seeds a financial
 * profile with a car policy — the minimum real data the events-readiness
 * and life-events specs need to exercise the "flips from sample to real
 * data" behavior deterministically.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const unique = `e2e-pw-${Date.now()}`
  const email = `${unique}@example.com`

  const signupRes = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'playwright-e2e-pass-1', name: 'Playwright E2E', workspace: unique }),
  })
  if (!signupRes.ok) {
    throw new Error(`E2E signup failed: ${signupRes.status} ${await signupRes.text()}`)
  }
  const { token } = (await signupRes.json()) as { token: string }

  // Most protected pages gate on a family group existing (see
  // apps/web/src/app/family-setup) — without one every route redirects to
  // "Set up your family" instead of rendering, which is what broke this
  // suite's first attempt.
  const familyRes = await fetch(`${API_BASE}/family`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Playwright E2E Family' }),
  })
  if (!familyRes.ok) {
    throw new Error(`E2E family group seed failed: ${familyRes.status} ${await familyRes.text()}`)
  }

  const profile = {
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
    policies: [
      { type: 'car', provider: 'Direct Line', coverage_amount_minor: 500000, monthly_premium_minor: 4000 },
    ],
  }

  const profileRes = await fetch(`${API_BASE}/family/financial-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...profile, generate_insights: true }),
  })
  if (!profileRes.ok) {
    throw new Error(`E2E profile seed failed: ${profileRes.status} ${await profileRes.text()}`)
  }

  // Report a job-loss life event too — life-events-prepare.spec needs an
  // existing event with both a contact step (mortgage lender) and a
  // non-contact step (runway) to test both draft affordances.
  const lifeEventRes = await fetch(`${API_BASE}/family/life-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ event_type: 'job_loss' }),
  })
  if (!lifeEventRes.ok) {
    throw new Error(`E2E life event seed failed: ${lifeEventRes.status} ${await lifeEventRes.text()}`)
  }
  const lifeEvent = (await lifeEventRes.json()) as { id: string }

  // Playwright's storageState format: localStorage entries per origin. The
  // app re-hydrates `user`/`family` from the API on load using just the
  // token (see apps/web/src/lib/auth-context.tsx's restore()), so the
  // token is the only seed this needs.
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: WEB_BASE,
        localStorage: [{ name: 'lifekeel_token', value: token }],
      },
    ],
  }

  const outDir = path.resolve(__dirname, '.auth')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'storage-state.json'), JSON.stringify(storageState, null, 2))
  fs.writeFileSync(path.join(outDir, 'seed.json'), JSON.stringify({ email, lifeEventId: lifeEvent.id }, null, 2))
}
