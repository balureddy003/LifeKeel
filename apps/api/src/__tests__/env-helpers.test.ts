import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { optionalFlag } from '../env-helpers.js'

describe('optionalFlag', () => {
  const schema = z.object({ FLAG: optionalFlag() })

  it('accepts an unset flag and an empty string from an unset deploy variable', () => {
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ FLAG: '' })).toMatchObject({ success: true, data: { FLAG: undefined } })
  })

  it('still accepts true/false and rejects anything else', () => {
    expect(schema.parse({ FLAG: 'true' }).FLAG).toBe('true')
    expect(schema.parse({ FLAG: 'false' }).FLAG).toBe('false')
    expect(schema.safeParse({ FLAG: 'yes' }).success).toBe(false)
  })

  it('is what a plain strict enum is not: a plain enum rejects the empty string', () => {
    expect(z.object({ FLAG: z.enum(['true', 'false']).optional() }).safeParse({ FLAG: '' }).success).toBe(false)
  })
})
