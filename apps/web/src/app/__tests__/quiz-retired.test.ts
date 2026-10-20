/**
 * The public readiness quiz is retired. Guard against it creeping back into the public surface.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..')
const ROOT = path.resolve(SRC, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8')

describe('readiness quiz retired', () => {
  it('/readiness only redirects to signup and is not indexed', () => {
    const page = read(SRC, 'app', 'readiness', 'page.tsx')
    expect(page).toContain("/signup")
    expect(page).not.toMatch(/submitReadinessQuiz|See my score/)
    expect(read(SRC, 'app', 'readiness', 'layout.tsx')).toMatch(/index:\s*false/)
  })

  it('the sitemap, llms.txt and guide CTAs no longer point at it', () => {
    expect(read(SRC, 'app', 'sitemap.ts')).not.toContain('/readiness')
    expect(read(ROOT, 'public', 'llms.txt')).not.toMatch(/readiness check|\/readiness/i)
    expect(read(SRC, 'app', 'guides', 'guides-data.ts')).not.toContain('/readiness?')
    expect(read(SRC, 'app', 'blog', '[slug]', 'BlogPostClient.tsx')).not.toContain('href="/readiness"')
  })

  it('the client has no quiz API', () => {
    const api = read(SRC, 'lib', 'api.ts')
    expect(api).not.toMatch(/submitReadinessQuiz|readinessShareUrl/)
  })
})
