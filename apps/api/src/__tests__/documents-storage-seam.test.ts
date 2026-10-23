/**
 * Document bytes have one seam (CLOUDFLARE_INTEGRATION.md §7.13): only
 * documents/storage.ts may import GridFSBucket or touch `documents.files`.
 * A new importer anywhere else fails here, so the dual-read inventory can't
 * silently go stale while documents migrate to R2.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEAM = 'documents/storage.ts'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('document storage seam', () => {
  const files = walk(SRC).map((f) => ({
    rel: path.relative(SRC, f).split(path.sep).join('/'),
    src: readFileSync(f, 'utf8'),
  }))

  it('only the seam imports GridFSBucket', () => {
    const offenders = files.filter((f) => f.rel !== SEAM && /\bGridFSBucket\b/.test(f.src)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it("only the seam queries 'documents.files'", () => {
    const offenders = files
      .filter((f) => f.rel !== SEAM && /collection\(\s*['"`]documents\.files['"`]/.test(f.src))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('the seam itself still dual-reads both stores', () => {
    const seam = files.find((f) => f.rel === SEAM)!.src
    expect(seam).toContain("case 'r2_clean'")
    expect(seam).toContain("case 'gridfs'")
  })
})
