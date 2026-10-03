import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { dropEmptyEnv, optionalEnum, optionalFlag } from '../env-helpers.js'

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

describe('optionalEnum', () => {
  const schema = z.object({ AUTH: optionalEnum(['none', 'cloudrun-iam']) })
  it('treats an empty deploy variable as unset and still validates real values', () => {
    expect(schema.safeParse({ AUTH: '' })).toMatchObject({ success: true, data: { AUTH: undefined } })
    expect(schema.parse({ AUTH: 'cloudrun-iam' }).AUTH).toBe('cloudrun-iam')
    expect(schema.safeParse({ AUTH: 'basic' }).success).toBe(false)
  })
})

describe('dropEmptyEnv', () => {
  it('removes empty values so they behave as unset, and reports which', () => {
    const env: NodeJS.ProcessEnv = { CORS_ORIGIN: '', LOCAL_JUDGE_BASE_URL: '', PORT: '3001', NODE_ENV: 'production' }
    expect(dropEmptyEnv(env).sort()).toEqual(['CORS_ORIGIN', 'LOCAL_JUDGE_BASE_URL'])
    expect(env).toEqual({ PORT: '3001', NODE_ENV: 'production' })
    // The reason this exists: `?? default` ignores '' but not undefined.
    expect(env['CORS_ORIGIN'] ?? false).toBe(false)
  })

  it('keeps real values, including "0" and "false", and whitespace (which is a value)', () => {
    const env: NodeJS.ProcessEnv = { A: '0', B: 'false', C: ' ' }
    expect(dropEmptyEnv(env)).toEqual([])
    expect(env).toEqual({ A: '0', B: 'false', C: ' ' })
  })
})
