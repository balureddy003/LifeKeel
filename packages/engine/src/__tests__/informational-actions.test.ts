/**
 * Intent 93, A1: a detector that ranks or shows a gap may only point at informational actions
 * (check, confirm, add, find, note, ask a licensed professional). It must never name or steer toward a
 * product. Detectors listed here have adopted that rule; new engine detectors are added to the list.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const INFORMATIONAL_ONLY = ['income-stops-runway.yaml']
const ALLOWED_START = /^(check|confirm|add|find|note|ask|look|review the (policy|schedule))\b/i
const PRODUCT_STEERING =
  /\b(buy|purchase|switch|compare (quotes|policies|products)|apply for|upgrade|increase (your )?cover|top up|get (a )?(policy|cover|quote)|take out)\b/i

describe('informational-only detectors', () => {
  for (const file of INFORMATIONAL_ONLY) {
    it(`${file}: every action is informational and steers to no product`, () => {
      const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'detectors/family', file), 'utf8')) as {
        rules: Array<{ id: string; actions: string[]; reasoning_template: string }>
      }
      expect(doc.rules.length).toBeGreaterThan(0)
      for (const rule of doc.rules) {
        expect(rule.actions.length).toBeGreaterThan(0)
        for (const action of rule.actions) {
          expect(action, `${rule.id}: ${action}`).toMatch(ALLOWED_START)
          expect(action, `${rule.id}: ${action}`).not.toMatch(PRODUCT_STEERING)
        }
        expect(rule.reasoning_template).not.toMatch(PRODUCT_STEERING)
        expect(rule.reasoning_template).toMatch(/not advice|information only|estimate/i)
      }
    })
  }

  it('the checker itself rejects a steering action (red mutation)', () => {
    expect('Switch to a cheaper income protection policy').not.toMatch(ALLOWED_START)
    expect('Check the schedule, then buy more cover').toMatch(PRODUCT_STEERING)
  })
})
