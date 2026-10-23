/**
 * detectEmergency — the deterministic safety screen that guarantees a
 * "chest pain"-type message always gets emergency guidance, whether or
 * not any model is configured. Twin file: apps/web's
 * emergency-detection.ts — changes must be mirrored there.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectEmergency } from '../emergency.js'

describe('detectEmergency', () => {
  it('flags in-progress medical emergencies', () => {
    expect(detectEmergency('my husband is having chest pain')).toBe('medical')
    expect(detectEmergency("I can't breathe")).toBe('medical')
    expect(detectEmergency('she collapsed and is unresponsive')).toBe('medical')
    expect(detectEmergency('my son swallowed a battery')).toBe('medical')
    expect(detectEmergency('call an ambulance')).toBe('medical')
    expect(detectEmergency('he is bleeding heavily and it won’t stop')).toBe('medical')
  })

  it('flags self-harm / suicide signals separately', () => {
    expect(detectEmergency('I want to die')).toBe('self_harm')
    expect(detectEmergency('I have been thinking about suicide')).toBe('self_harm')
    expect(detectEmergency("I don't want to be here anymore")).toBe('self_harm')
  })

  it('flags the phrasings people actually use for not wanting to be alive (regression: "do not want to be alive anymore")', () => {
    for (const text of [
      'I do not want to be alive anymore',
      "I don't want to be alive",
      'she does not want to live any more',
      'I want to take my own life',
      'I am thinking of ending my own life',
      'there is no point in living',
      'no point going on',
      "I can't go on living like this",
      'I wish I had never been born',
      'I keep thinking about killing myself',
    ]) {
      expect(detectEmergency(text), text).toBe('self_harm')
    }
  })

  it('does not flag ordinary money worries that merely share words', () => {
    for (const text of [
      "We can't go on holiday this year, can we still afford the mortgage?",
      'I do not want to be paying this much interest',
      'What is the point of life insurance?',
      'Should my husband take his own pension early?',
      'My parents do not want to move house',
    ]) {
      expect(detectEmergency(text), text).toBeNull()
    }
  })

  it('does not flag normal finance questions about emergencies', () => {
    expect(detectEmergency('Am I covered for a medical emergency?')).toBeNull()
    expect(detectEmergency('How big should my emergency fund be?')).toBeNull()
    expect(detectEmergency('What happens to our mortgage if one of us dies?')).toBeNull()
    expect(detectEmergency('Do we need travel insurance for our trip?')).toBeNull()
  })

  it('matches case-insensitively and tolerates hyphens', () => {
    expect(detectEmergency('CHEST PAIN')).toBe('medical')
    expect(detectEmergency('chest-pain right now')).toBe('medical')
  })
})

describe('web twin parity', () => {
  // The client screens before a query leaves the device and the server screens again; if the two
  // pattern sets drift, a phrase one side catches the other can miss. Compare the source text.
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8')
  const pick = (src: string, name: string) =>
    src.match(new RegExp(`const ${name} =\\n  (/.*?/i)\\n`, 's'))?.[1]
  const api = read('../emergency.ts')
  const web = read('../../../../apps/web/src/lib/emergency-detection.ts')

  it('uses identical medical and self-harm patterns on both sides', () => {
    for (const name of ['MEDICAL_EMERGENCY_RE', 'SELF_HARM_RE']) {
      expect(pick(web, name), name).toBeTruthy()
      expect(pick(web, name)).toBe(pick(api, name))
    }
  })
})
