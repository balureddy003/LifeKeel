import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Two code paths create the users.email index and race on a fresh database.
// MongoDB rejects the second request when the auto-generated name (email_1)
// matches but the options differ, which made POST /auth/signup return 500.
// Every definition must therefore request exactly { unique: true }.
const files = ['routes/operator.ts', 'routes/auth-users.ts']

describe('users.email index definitions', () => {
  it('every users { email: 1 } createIndex call is unique', () => {
    const calls: string[] = []
    for (const f of files) {
      const src = readFileSync(path.join(__dirname, '..', f), 'utf8')
      for (const m of src.matchAll(
        /(?:users|col)\.createIndex\(\s*\{\s*email:\s*1\s*\}([^)]*)\)/g,
      )) {
        calls.push(`${f}: ${m[0]}`)
        expect(m[1], m[0]).toMatch(/unique:\s*true/)
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })
})
