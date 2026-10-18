/**
 * Keeps the repository's licensing coherent now that it is public. The root LICENSE is proprietary
 * ("all rights reserved"); a package that still declares MIT, Apache-2.0 or BUSL-1.1, or ships its own
 * LICENSE, would grant rights by accident. Every workspace package must be UNLICENSED and private, and
 * the root LICENSE and NOTICE must exist.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', '.git', 'coverage', '.claude'])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const all = walk('.')
const manifests = ['package.json', ...all.filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f))]

describe('licensing stays proprietary and consistent', () => {
  it('has a root LICENSE that reserves all rights, and a NOTICE', () => {
    const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
    expect(lic).toMatch(/All rights reserved/)
    expect(lic).toMatch(/Copyright \(c\)/)
    expect(lic).not.toMatch(/Permission is hereby granted|Licensor:|Licensed under the Apache License/i)
    expect(fs.existsSync(path.join(ROOT, 'NOTICE'))).toBe(true)
  })

  it('finds the workspace manifests', () => {
    expect(manifests.length).toBeGreaterThan(8)
  })

  it.each(manifests)('%s is UNLICENSED and private', (rel) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as { license?: string; private?: boolean }
    expect(pkg.license, `${rel} license`).toBe('UNLICENSED')
    expect(pkg.private, `${rel} private`).toBe(true)
  })

  it('no package ships its own open-source licence file', () => {
    const stray = all.filter((f) => /(^|\/)(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i.test(f) && f !== 'LICENSE')
    expect(stray).toEqual([])
  })
})
