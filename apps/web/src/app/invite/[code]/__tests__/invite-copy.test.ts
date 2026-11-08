/**
 * The invite page is reached by a private link, but the link can land with the wrong
 * person (a mistyped address). It says who invited them and never which family, and tells
 * a wrong recipient they can simply leave.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { inviteIntro, INVITE_BUTTON, WRONG_PERSON } from '../invite-copy'

describe('invite page wording', () => {
  it('names who invited them, not the family', () => {
    expect(inviteIntro('Ada')).toBe('Ada invited you to join their family on LifeKeel.')
  })
  it('copes with an older invite that has no inviter name', () => {
    expect(inviteIntro(null)).toBe('You have been invited to join a family on LifeKeel.')
  })
  it('the button does not name a family either', () => {
    expect(INVITE_BUTTON).toBe('Join the family')
  })
  it('tells someone who was not expecting it that nothing happens unless they act', () => {
    expect(WRONG_PERSON).toMatch(/not expecting this/i)
    expect(WRONG_PERSON).toMatch(/nothing happens/i)
  })
  it('the page never shows a family name', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'InviteJoinClient.tsx'), 'utf8')
    expect(src).not.toMatch(/info\.familyName/)
  })
})
