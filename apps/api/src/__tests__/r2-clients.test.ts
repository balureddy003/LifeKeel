/**
 * R2 credential tripwire (CLOUDFLARE_INTEGRATION.md §7.1), the same idea as
 * trust-tier-gate.test.ts: each credential may only be requested from the
 * files listed here. Adding a caller means editing this list, which puts
 * "should this code hold that key?" in front of a reviewer.
 *
 *   scan    writes the clean bucket: scan worker and reconciler only
 *   presign quarantine only: upload routes and fenced delete
 *   serve   read-only clean: the storage seam's read/presign GET
 *   delete  clean deletes: fenced delete and erasure
 *   vault   vault ciphertext: the storage seam's vault functions
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOWED: Record<string, string[]> = {
  scan: [
    'documents/scan-job.ts',
    'documents/reconciler.ts',
    'documents/deletion.ts',
    'scan-worker.ts',
  ],
  presign: ['routes/documents-uploads.ts', 'routes/documents.ts', 'documents/deletion.ts'],
  serve: ['documents/storage.ts'],
  delete: ['documents/deletion.ts'],
  vault: ['documents/storage.ts'],
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('R2 credential call sites', () => {
  const uses = new Map<string, Set<string>>()
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    for (const m of readFileSync(file, 'utf8').matchAll(/objectStore\(\s*'([a-z]+)'\s*\)/g)) {
      if (!uses.has(m[1]!)) uses.set(m[1]!, new Set())
      uses.get(m[1]!)!.add(rel)
    }
  }

  it('found the call sites (the scan works)', () => {
    expect(uses.size).toBeGreaterThanOrEqual(4)
  })

  for (const [cred, files] of Object.entries(ALLOWED)) {
    it(`'${cred}' is only requested from its allow-listed files`, () => {
      const unexpected = [...(uses.get(cred) ?? [])].filter((f) => !files.includes(f))
      expect(unexpected, `new '${cred}' caller(s): review, then add to ALLOWED`).toEqual([])
    })
  }

  it('no credential outside the known five', () => {
    expect([...uses.keys()].filter((c) => !(c in ALLOWED))).toEqual([])
  })

  it('nothing outside r2.ts constructs an S3 client', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(path.join('documents', 'r2.ts')))
      .filter((f) => /new S3Client\(|from '@aws-sdk\/client-s3'/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
