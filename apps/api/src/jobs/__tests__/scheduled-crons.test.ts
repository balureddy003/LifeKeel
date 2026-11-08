import { describe, expect, it } from 'vitest'
import {
  registerScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  cronTriggerAuthorized,
} from '../scheduled-crons.js'

const TOKEN = 't'.repeat(32)

describe('scheduled-crons registry (intent 92)', () => {
  it('registers, looks up and lists jobs', () => {
    const name = `test-job-${Date.now()}`
    registerScheduledJob(name, async () => 'ran')
    expect(getScheduledJob(name)).toBeTypeOf('function')
    expect(listScheduledJobs()).toContain(name)
  })

  it('rejects duplicate registration', () => {
    const name = `dup-job-${Date.now()}`
    registerScheduledJob(name, async () => undefined)
    expect(() => registerScheduledJob(name, async () => undefined)).toThrow('Duplicate')
  })

  it('returns undefined for unknown jobs', () => {
    expect(getScheduledJob('no-such-job')).toBeUndefined()
  })
})

describe('cronTriggerAuthorized', () => {
  it('accepts only an exact Bearer token', () => {
    expect(cronTriggerAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(cronTriggerAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(cronTriggerAuthorized(TOKEN, TOKEN)).toBe(false)
    expect(cronTriggerAuthorized(undefined, TOKEN)).toBe(false)
    expect(cronTriggerAuthorized(`Bearer ${TOKEN}`, undefined)).toBe(false)
    expect(cronTriggerAuthorized(`Bearer ${TOKEN}`, '')).toBe(false)
  })
})
