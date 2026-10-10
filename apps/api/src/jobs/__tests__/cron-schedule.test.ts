import { describe, expect, it, vi } from 'vitest'
import { cronMatches, createCronScheduler, floorToMinute, parseCron } from '../cron-schedule.js'

// 2026-10-05 is a Monday, 2026-10-10 a Saturday.
const at = (iso: string) => new Date(iso)

describe('parseCron', () => {
  it('rejects the wrong number of fields', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/)
    expect(() => parseCron('* * * * * *')).toThrow(/5 fields/)
  })
  it('rejects out-of-range values, zero steps and malformed lists', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/minute/)
    expect(() => parseCron('* 24 * * *')).toThrow(/hour/)
    expect(() => parseCron('* * 0 * *')).toThrow(/day-of-month/)
    expect(() => parseCron('* * * 13 *')).toThrow(/month/)
    expect(() => parseCron('*/0 * * * *')).toThrow(/step/)
    expect(() => parseCron('5,,6 * * * *')).toThrow(/empty/)
    expect(() => parseCron('9-3 * * * *')).toThrow(/minute/)
    expect(() => parseCron('x * * * *')).toThrow(/minute/)
  })
  it('accepts lists, ranges and steps', () => {
    expect(() => parseCron('5,10-12/2 */3 1,15 1-6 0-5')).not.toThrow()
  })
})

describe('cronMatches (UTC)', () => {
  it('matches every-N-minute steps only on multiples', () => {
    expect(cronMatches('*/15 * * * *', at('2026-10-10T09:00:00Z'))).toBe(true)
    expect(cronMatches('*/15 * * * *', at('2026-10-10T09:15:00Z'))).toBe(true)
    expect(cronMatches('*/15 * * * *', at('2026-10-10T09:07:00Z'))).toBe(false)
  })
  it('matches a fixed time of day', () => {
    expect(cronMatches('23 8 * * *', at('2026-10-10T08:23:00Z'))).toBe(true)
    expect(cronMatches('23 8 * * *', at('2026-10-10T08:24:00Z'))).toBe(false)
    expect(cronMatches('23 8 * * *', at('2026-10-10T09:23:00Z'))).toBe(false)
  })
  it('matches weekly jobs on the right weekday only', () => {
    expect(cronMatches('0 8 * * 1', at('2026-10-05T08:00:00Z'))).toBe(true) // Monday
    expect(cronMatches('0 8 * * 1', at('2026-10-06T08:00:00Z'))).toBe(false) // Tuesday
  })
  it('treats 0 and 7 as Sunday', () => {
    expect(cronMatches('0 0 * * 0', at('2026-10-11T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 * * 7', at('2026-10-11T00:00:00Z'))).toBe(true)
    expect(cronMatches('0 0 * * 7', at('2026-10-10T00:00:00Z'))).toBe(false)
  })
  it('matches monthly jobs on the right day of the month only', () => {
    expect(cronMatches('0 8 1 * *', at('2026-11-01T08:00:00Z'))).toBe(true)
    expect(cronMatches('0 8 1 * *', at('2026-11-02T08:00:00Z'))).toBe(false)
  })
  it('uses standard OR semantics when both day fields are restricted', () => {
    // fires on the 13th of any month OR any Friday
    expect(cronMatches('0 0 13 * 5', at('2026-10-13T00:00:00Z'))).toBe(true) // Tuesday the 13th
    expect(cronMatches('0 0 13 * 5', at('2026-10-09T00:00:00Z'))).toBe(true) // Friday the 9th
    expect(cronMatches('0 0 13 * 5', at('2026-10-10T00:00:00Z'))).toBe(false) // Saturday the 10th
  })
  it('honours lists, ranges and steps together', () => {
    const e = '5,10-12/2 * * * *' // minutes 5, 10, 12
    expect(cronMatches(e, at('2026-10-10T00:05:00Z'))).toBe(true)
    expect(cronMatches(e, at('2026-10-10T00:10:00Z'))).toBe(true)
    expect(cronMatches(e, at('2026-10-10T00:12:00Z'))).toBe(true)
    expect(cronMatches(e, at('2026-10-10T00:11:00Z'))).toBe(false)
  })
})

describe('createCronScheduler', () => {
  it('internal mode registers AND schedules with node-cron; external mode only registers', () => {
    const impl = vi.fn()
    const internal = createCronScheduler('internal', impl)
    internal.schedule('* * * * *', () => {}, { noOverlap: true })
    expect(impl).toHaveBeenCalledTimes(1)
    expect(impl.mock.calls[0]?.[0]).toBe('* * * * *')
    expect(impl.mock.calls[0]?.[2]).toEqual({ noOverlap: true })
    expect(internal.count()).toBe(1)

    const implExt = vi.fn()
    const external = createCronScheduler('external', implExt)
    external.schedule('* * * * *', () => {})
    expect(implExt).not.toHaveBeenCalled()
    expect(external.count()).toBe(1)
  })

  it('rejects a bad expression at registration, in either mode', () => {
    expect(() => createCronScheduler('internal', vi.fn()).schedule('nope', () => {})).toThrow()
    expect(() => createCronScheduler('external', vi.fn()).schedule('61 * * * *', () => {})).toThrow()
  })

  it('runs only the jobs due at that minute', async () => {
    const s = createCronScheduler('external', vi.fn())
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn()
    s.schedule('*/15 * * * *', a)
    s.schedule('30 8 * * *', b)
    s.schedule('0 3 * * *', c)
    const r = await s.runDue(at('2026-10-10T08:30:00Z'))
    expect(a).toHaveBeenCalledTimes(1) // 08:30 is a multiple of 15
    expect(b).toHaveBeenCalledTimes(1)
    expect(c).not.toHaveBeenCalled()
    expect(r).toMatchObject({ due: 2, ok: 2, failed: 0, skipped: 0, windowMinutes: 1 })
  })

  it('floors the time to the minute, so a tick that arrives a few seconds late still matches', async () => {
    const s = createCronScheduler('external', vi.fn())
    const a = vi.fn()
    s.schedule('30 8 * * *', a)
    await s.runDue(at('2026-10-10T08:30:42Z'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(floorToMinute(at('2026-10-10T08:30:42.500Z')).toISOString()).toBe('2026-10-10T08:30:00.000Z')
  })

  it('one failing job never stops the others, and the failure is reported', async () => {
    const s = createCronScheduler('external', vi.fn())
    const good = vi.fn()
    s.schedule('* * * * *', () => { throw new Error('boom') })
    s.schedule('* * * * *', async () => { throw new Error('async boom') })
    s.schedule('* * * * *', good)
    const r = await s.runDue(at('2026-10-10T00:00:00Z'))
    expect(good).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ due: 3, ok: 1, failed: 2 })
    expect(r.jobs.filter((j) => j.status === 'failed').map((j) => j.error)).toEqual(['boom', 'async boom'])
  })

  it('skips a job that is still running from an earlier tick (no overlap)', async () => {
    const s = createCronScheduler('external', vi.fn())
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    const slow = vi.fn(() => gate)
    s.schedule('* * * * *', slow)

    const first = s.runDue(at('2026-10-10T00:00:00Z'))
    const second = await s.runDue(at('2026-10-10T00:01:00Z')) // job from tick 1 still running
    expect(second).toMatchObject({ due: 1, ok: 0, skipped: 1 })
    expect(slow).toHaveBeenCalledTimes(1)

    release()
    await first
    const third = await s.runDue(at('2026-10-10T00:02:00Z')) // finished, so it runs again
    expect(third.ok).toBe(1)
    expect(slow).toHaveBeenCalledTimes(2)
  })

  it('catch-up: a missed tick window runs each due job once, not once per missed minute', async () => {
    const s = createCronScheduler('external', vi.fn())
    const everyMinute = vi.fn()
    const hourly = vi.fn()
    const outside = vi.fn()
    s.schedule('* * * * *', everyMinute)
    s.schedule('5 8 * * *', hourly) // 08:05 lies inside the missed window
    s.schedule('30 9 * * *', outside) // 09:30 lies outside it
    // last tick ran at 08:03; this one arrives at 08:08 -> window is 08:04..08:08
    const r = await s.runDue(at('2026-10-10T08:08:00Z'), at('2026-10-10T08:03:00Z'))
    expect(everyMinute).toHaveBeenCalledTimes(1)
    expect(hourly).toHaveBeenCalledTimes(1)
    expect(outside).not.toHaveBeenCalled()
    expect(r.windowMinutes).toBe(5)
  })

  it('an empty window (same minute as the last tick) runs nothing', async () => {
    const s = createCronScheduler('external', vi.fn())
    const a = vi.fn()
    s.schedule('* * * * *', a)
    const r = await s.runDue(at('2026-10-10T08:08:00Z'), at('2026-10-10T08:08:00Z'))
    expect(a).not.toHaveBeenCalled()
    expect(r.due).toBe(0)
  })
})
