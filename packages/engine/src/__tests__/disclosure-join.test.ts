import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Engine } from '../engine.js'

/**
 * Intent 68 (M2 disclosure join): a rule's `disclosure` labels the insight;
 * `requester_clearance` filters INSIDE evaluate() — a youth request can
 * never receive an insight derived from an organiser-scoped field
 * (the engine's own check, not an HTTP-layer strip).
 */
const DETECTOR_YAML = `id: disclosure_test
name: Disclosure Test
description: One household rule and one organiser rule fire on the same event
version: 1.0.0
signal_types:
  - test.event
industries: ["*"]
rules:
  - id: household_rule
    name: Household
    condition: "data.x >= 1"
    confidence: 0.9
    impact_low: "0"
    impact_high: "0"
    reasoning_template: "household"
    actions: ["noop"]
  - id: organiser_rule
    name: Organiser only
    disclosure: organiser
    condition: "data.x >= 1"
    confidence: 0.9
    impact_low: "0"
    impact_high: "0"
    reasoning_template: "estate amount"
    actions: ["noop"]
`

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifekeel-disclosure-'))
  await fs.writeFile(path.join(dir, 'disc.yaml'), DETECTOR_YAML)
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('disclosure join inside evaluate() (intent 68)', () => {
  it('youth clearance never receives an organiser-disclosure insight', async () => {
    const engine = new Engine({ detectorsDir: dir })
    await engine.load()
    const result = await engine.evaluate({
      event_type: 'test.event',
      tenant_id: 't',
      event_id: 'e1',
      data: { x: 1 },
      requester_clearance: 'youth',
    })
    expect(result.insights.map((i) => i.rule_id)).toEqual(['household_rule'])
  })

  it('organiser clearance receives both', async () => {
    const engine = new Engine({ detectorsDir: dir })
    await engine.load()
    const result = await engine.evaluate({
      event_type: 'test.event',
      tenant_id: 't',
      event_id: 'e2',
      data: { x: 1 },
      requester_clearance: 'organiser',
    })
    expect(result.insights.map((i) => i.rule_id).sort()).toEqual([
      'household_rule',
      'organiser_rule',
    ])
    expect(result.insights.find((i) => i.rule_id === 'organiser_rule')?.disclosure).toBe(
      'organiser',
    )
  })
})
