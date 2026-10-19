/**
 * Quiet hours are evaluated in UTC — independent of the host's TZ, which the
 * old getHours() implementation depended on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isInQuietHours, type DeliveryPreferences } from '../delivery-router.js'

const prefs = (start: number | null, end: number | null) =>
  ({
    tenant_id: 't',
    channels: [],
    min_urgency: 'low',
    quiet_hours_start: start,
    quiet_hours_end: end,
  }) as unknown as DeliveryPreferences

const ORIGINAL_TZ = process.env['TZ']
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ']
  else process.env['TZ'] = ORIGINAL_TZ
})

describe('isInQuietHours', () => {
  it('is off when either bound is unset', () => {
    expect(isInQuietHours(prefs(null, 8), new Date('2026-02-09T23:00:00Z'))).toBe(false)
    expect(isInQuietHours(prefs(21, null), new Date('2026-02-09T23:00:00Z'))).toBe(false)
  })

  it('handles an overnight window and a same-day window', () => {
    expect(isInQuietHours(prefs(21, 8), new Date('2026-02-09T23:00:00Z'))).toBe(true)
    expect(isInQuietHours(prefs(21, 8), new Date('2026-02-09T07:59:00Z'))).toBe(true)
    expect(isInQuietHours(prefs(21, 8), new Date('2026-02-09T08:00:00Z'))).toBe(false)
    expect(isInQuietHours(prefs(13, 15), new Date('2026-02-09T14:00:00Z'))).toBe(true)
    expect(isInQuietHours(prefs(13, 15), new Date('2026-02-09T15:00:00Z'))).toBe(false)
  })

  it('does not depend on the host timezone', () => {
    const at = new Date('2026-02-09T23:00:00Z') // 04:30 in Asia/Kolkata, 18:00 in New York
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
      process.env['TZ'] = tz
      expect(isInQuietHours(prefs(21, 8), at)).toBe(true)
      expect(isInQuietHours(prefs(9, 17), at)).toBe(false)
    }
  })
})
