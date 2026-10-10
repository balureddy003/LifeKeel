/**
 * Guard: account deletion must cover every tenant-scoped collection.
 *
 * Found by the PRD-139 privacy review: /account/delete wiped a fixed list that had silently fallen
 * behind (family_assets, legacy_documents, readiness_events, ... were left behind after "delete my
 * account"). Any collection opened through getTenantCollection() is tenant-scoped by definition, so
 * it must either be in DELETABLE_COLLECTIONS or be listed in ERASURE_RETAINED with a reason.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELETABLE_COLLECTIONS, ERASURE_RETAINED } from '../account.js'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

function tenantScopedCollections(): Map<string, string> {
  const found = new Map<string, string>()
  const rx = /getTenantCollection(?:<[^()]*?>)?\(\s*[\w.]+,\s*'([a-z_0-9]+)'/g
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(rx)) if (!found.has(m[1]!)) found.set(m[1]!, path.relative(SRC, file))
  }
  return found
}

describe('account erasure coverage', () => {
  const deletable = new Set<string>(DELETABLE_COLLECTIONS)
  const retained = new Set(Object.keys(ERASURE_RETAINED))

  it('finds the tenant-scoped collections (the scan itself works)', () => {
    const found = tenantScopedCollections()
    expect(found.size).toBeGreaterThan(10)
    expect(found.has('family_financial_profile')).toBe(true)
  })

  it('every tenant-scoped collection is deleted or deliberately retained', () => {
    const missing = [...tenantScopedCollections()]
      .filter(([name]) => !deletable.has(name) && !retained.has(name))
      .map(([name, file]) => `${name} (used in ${file})`)
    expect(missing, `add these to DELETABLE_COLLECTIONS, or to ERASURE_RETAINED with a reason: ${missing.join(', ')}`).toEqual([])
  })

  it('nothing is both deleted and retained, and every retention has a reason', () => {
    for (const name of retained) {
      expect(deletable.has(name), `${name} is both deleted and retained`).toBe(false)
      expect(ERASURE_RETAINED[name]!.length).toBeGreaterThan(10)
    }
  })

  it('the collections the privacy review found missing are now deleted', () => {
    for (const name of [
      'family_assets', 'family_cashflow_entries', 'family_scenarios', 'legacy_documents', 'legacy_notes',
      'legacy_contacts', 'readiness_events', 'member_nudges', 'external_accounts', 'heartbeat_sends',
      'family_continuity_state', 'family_member_invites', 'invite_codes',
    ]) {
      expect(deletable.has(name), `${name} should be deleted with the account`).toBe(true)
    }
  })

  it('has no duplicate entries in the deletion list', () => {
    expect(DELETABLE_COLLECTIONS.length).toBe(deletable.size)
  })
})
