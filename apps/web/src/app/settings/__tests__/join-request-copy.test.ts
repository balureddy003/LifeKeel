/**
 * Approving a join request lets a person in to everything on the family list. The organizer
 * must be told that, and who is asking, before they approve (found by the UK household
 * simulation, H29: a lodger or helper sees the whole list). Plain words, no advice.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { APPROVAL_NOTE, approvalConfirm } from '../join-request-copy'

describe('join request wording', () => {
  it('says what approving means, in the request row', () => {
    expect(APPROVAL_NOTE).toMatch(/invite code/)
    expect(APPROVAL_NOTE).toMatch(/see everything on the family list/)
  })

  it('the confirmation names who is asking and what they will see', () => {
    const c = approvalConfirm('Pavel Nowak', 'pavel@example.com')
    expect(c.title).toBe('Let Pavel Nowak in?')
    expect(c.message).toContain(
      'Pavel Nowak (pavel@example.com) asked to join with your invite code',
    )
    expect(c.message).toMatch(/see everything on the family list/)
    expect(c.message).toMatch(/Only approve someone you know/)
    expect(c.confirmLabel).toBe('Approve')
  })

  it('gives no advice and names no product', () => {
    const c = approvalConfirm('A B', 'a@b.test')
    expect(`${APPROVAL_NOTE} ${c.message}`).not.toMatch(/\b(should|recommend|best|buy|switch)\b/i)
  })

  it('the settings page asks before it approves, and shows the note', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
    expect(src).toContain('approvalConfirm(')
    expect(src).toContain('APPROVAL_NOTE')
  })
})
