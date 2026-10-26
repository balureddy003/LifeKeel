/**
 * Guards for the P1 items in docs/reviews/e2e-gap-report-2026-10.md.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberStatusLabel } from '../../lib/auth-types'

const APP = path.resolve(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), 'utf8')

describe('P1 gap fixes', () => {
  it('the connect page does not say passwords are never stored (the email connector stores one, encrypted)', () => {
    expect(read('connect', 'page.tsx')).not.toMatch(/never store your passwords/i)
  })

  it('every in-app link to a bare list route resolves to a page', () => {
    // /documents, /insights and /health only have [param] children, so each needs an index page.
    for (const d of ['documents', 'insights', 'health']) {
      expect(fs.existsSync(path.join(APP, d, 'page.tsx')), `${d}/page.tsx`).toBe(true)
    }
    expect(read('finances', 'page.tsx')).not.toContain('href="/documents"')
  })

  it('members who have not joined are not labelled with a bare "Pending"', () => {
    expect(memberStatusLabel('pending')).toBe('Invite sent')
    expect(memberStatusLabel('active')).toBe('Active')
  })

  it('a pending child is never labelled as if an invitation is outstanding — minors cannot join', () => {
    expect(memberStatusLabel('pending', 'child')).toBe('Managed by adults')
    expect(memberStatusLabel('pending', 'adult')).toBe('Invite sent')
  })

  it('the cash flow note does not claim scenarios read the ledger', () => {
    expect(read('cashflow', 'page.tsx')).not.toMatch(/scenarios and runway figures reason about/)
  })
})
