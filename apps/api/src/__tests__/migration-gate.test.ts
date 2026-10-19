/**
 * Intent 08 — migrations as a deploy gate.
 *
 * pendingMigrations/migrationHead feed /health/ready (the only endpoint
 * the canary calls), so a deploy whose migrations didn't land reports
 * not_ready. These tests pin the helpers' semantics against a fake
 * ledger; the strict-boot wiring is a fitness-test tripwire.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  migrationHead,
  pendingMigrations,
  verifyCriticalIndexes,
  EXPECTED_MIGRATION_HEAD,
  migrations,
} from '../migrate.js'

function ledgerDb(appliedIds: string[]) {
  return {
    collection: (name: string) => {
      if (name !== 'migrations') throw new Error(`unexpected collection ${name}`)
      return {
        find: () => ({
          sort: () => ({
            limit: () => ({
              next: async () =>
                appliedIds.length ? { id: appliedIds[appliedIds.length - 1] } : null,
            }),
          }),
          toArray: async () => appliedIds.map((id) => ({ id })),
        }),
      }
    },
     
  } as any
}

describe('migration ledger helpers', () => {
  it('migrationHead returns the latest applied id or null', async () => {
    expect(await migrationHead(ledgerDb([]))).toBeNull()
    expect(await migrationHead(ledgerDb(['a', 'b']))).toBe('b')
  })

  it('pendingMigrations catches a failed mid-list migration even when head looks current', async () => {
    // Everything applied EXCEPT one mid-list migration — a head check alone
    // would call this migrated.
    const missing = migrations[2]!.id
    const applied = migrations.map((m) => m.id).filter((id) => id !== missing)
    const pending = await pendingMigrations(ledgerDb(applied))
    expect(pending).toEqual([missing])
  })

  it('pendingMigrations is empty when the ledger is fully applied', async () => {
    const applied = migrations.map((m) => m.id)
    expect(await pendingMigrations(ledgerDb(applied))).toEqual([])
    expect(EXPECTED_MIGRATION_HEAD).toBe(applied[applied.length - 1])
  })
})

describe('verifyCriticalIndexes', () => {
  function indexDb(existing: Record<string, string[]>) {
    return {
      listCollections: ({ name }: { name: string }) => ({
        hasNext: async () => name in existing,
      }),
      collection: (name: string) => ({
        indexes: async () => (existing[name] ?? []).map((n) => ({ name: n })),
      }),
       
    } as any
  }

  it('reports only the missing critical indexes', async () => {
    const db = indexDb({
      tenants: ['tenant_id_1'],
      family_groups: ['invite_code_1'],
      // inbox_items exists but lost its dedup index
      inbox_items: ['_id_'],
    })
    const missing = await verifyCriticalIndexes(db)
    expect(missing).toEqual(['inbox_items.tenant_id_1_email_message_id_1'])
  })

  it('treats a missing collection as a missing index', async () => {
    const missing = await verifyCriticalIndexes(indexDb({}))
    expect(missing.length).toBeGreaterThan(0)
  })
})
