/**
 * Tests for PrivacyAccountant
 */

import { describe, it, expect } from 'vitest'
import { PrivacyAccountant, PrivacyBudgetExceededError } from './PrivacyAccountant.js'

describe('PrivacyAccountant', () => {
  it('tracks privacy budget across rounds', () => {
    const accountant = new PrivacyAccountant()
    accountant.recordRound('tenant_1', 1.0, 1e-5)

    const budget = accountant.getBudget('tenant_1')
    expect(budget).toBeDefined()
    expect(budget!.totalRounds).toBe(1)
    expect(budget!.epsilonSpent).toBeGreaterThan(0)
  })

  it('increases epsilon with more rounds', () => {
    const accountant = new PrivacyAccountant()
    accountant.recordRound('tenant_1', 1.0, 1e-5)
    const budget1 = accountant.getBudget('tenant_1')!

    accountant.recordRound('tenant_1', 1.0, 1e-5)
    const budget2 = accountant.getBudget('tenant_1')!

    expect(budget2.epsilonSpent).toBeGreaterThan(budget1.epsilonSpent)
    expect(budget2.totalRounds).toBe(2)
  })

  it('detects budget exhaustion', () => {
    const accountant = new PrivacyAccountant()
    // Spend a lot of budget quickly
    for (let i = 0; i < 50; i++) {
      accountant.recordRound('tenant_1', 1.0, 1e-5)
    }

    expect(accountant.isBudgetExceeded('tenant_1', 4.0, 0.001)).toBe(true)
  })

  it('generates a privacy report', () => {
    const accountant = new PrivacyAccountant()
    accountant.recordRound('tenant_1', 1.0, 1e-5)

    const report = accountant.getReport('tenant_1')
    expect(report.status).toBe('healthy')
    expect(report.totalRounds).toBe(1)
    expect(report.guarantees.length).toBeGreaterThan(0)
  })

  it('report status becomes approaching_limit near budget', () => {
    const accountant = new PrivacyAccountant()
    // Spend ~85% of epsilon budget (3.4 out of 4.0)
    accountant.recordRound('tenant_1', 1.0, 1e-5)
    accountant.recordRound('tenant_1', 1.0, 1e-5)
    accountant.recordRound('tenant_1', 1.0, 1e-5)
    accountant.recordRound('tenant_1', 0.4, 1e-5)

    const report = accountant.getReport('tenant_1')
    expect(report.status).toBe('approaching_limit')
  })

  it('throws PrivacyBudgetExceededError with correct message', () => {
    const err = new PrivacyBudgetExceededError('tenant_xyz', {
      epsilonSpent: 4.5,
      deltaSpent: 0.002,
      totalRounds: 10,
    })
    expect(err.message).toContain('tenant_xyz')
    expect(err.message).toContain('4.5')
    expect(err.name).toBe('PrivacyBudgetExceededError')
  })
})
