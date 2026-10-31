import { describe, expect, it, vi } from 'vitest'
import { ensureUniqueIndex } from '../migrate.js'

function makeDb({ unique = false, duplicate = false } = {}) {
  const createIndex = vi.fn().mockResolvedValue('tenant_id_1')
  const dropIndex = vi.fn().mockResolvedValue(undefined)
  const hasNext = vi.fn().mockResolvedValue(duplicate)
  const aggregate = vi.fn().mockReturnValue({ hasNext })
  const indexes = vi
    .fn()
    .mockResolvedValue([{ name: 'tenant_id_1', key: { tenant_id: 1 }, unique }])
  const collection = vi.fn().mockReturnValue({ aggregate, createIndex, dropIndex, indexes })
  const listCollections = vi.fn().mockReturnValue({ hasNext: vi.fn().mockResolvedValue(true) })
  return { db: { collection, listCollections } as any, aggregate, createIndex, dropIndex }
}

describe('ensureUniqueIndex', () => {
  it('replaces a non-unique index when the indexed values have no duplicates', async () => {
    const { db, aggregate, createIndex, dropIndex } = makeDb()

    await ensureUniqueIndex(db, 'tenants', { tenant_id: 1 })

    expect(aggregate).toHaveBeenCalledWith([
      { $group: { _id: { tenant_id: '$tenant_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    expect(dropIndex).toHaveBeenCalledWith('tenant_id_1')
    expect(createIndex).toHaveBeenCalledWith({ tenant_id: 1 }, { unique: true })
  })

  it('keeps the existing index and fails clearly when duplicate values exist', async () => {
    const { db, createIndex, dropIndex } = makeDb({ duplicate: true })

    await expect(ensureUniqueIndex(db, 'tenants', { tenant_id: 1 })).rejects.toThrow(
      'Cannot make tenants.tenant_id_1 unique because duplicate values exist',
    )
    expect(dropIndex).not.toHaveBeenCalled()
    expect(createIndex).not.toHaveBeenCalled()
  })
})

describe('obligations and employer-cover indexes', () => {
  it('indexes both tenant-read collections by tenant and by id', async () => {
    const { migrations } = await import('../migrate.js')
    const m = migrations.find((x) => x.id === '20261031000000-obligations-and-cover-indexes')
    expect(m).toBeDefined()
    const createIndex = vi.fn().mockResolvedValue('ok')
    const collection = vi.fn().mockReturnValue({ createIndex })
    await m!.up({ collection } as any)
    for (const name of ['household_obligations', 'employer_cover_facts']) {
      expect(collection).toHaveBeenCalledWith(name)
    }
    expect(createIndex).toHaveBeenCalledWith({ tenant_id: 1, created_at: 1 })
    expect(createIndex).toHaveBeenCalledWith({ id: 1 })
  })
})
