/**
 * Minimal in-memory Mongo stand-in for the Keel tests. Supports the filter
 * operators and update operators the Keel modules use, and records every
 * call so tests can assert that tenant scoping and projections hold.
 */
import { withTenantKeys } from '../../__tests__/helpers/tenant-keys-fake.js'

type Doc = Record<string, unknown>
type Filter = Record<string, unknown>

export interface Call {
  collection: string
  op: string
  filter: Filter
  options?: unknown
}

function getPath(doc: Doc, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc)
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = getPath(doc, key)
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>
      return Object.entries(ops).every(([op, arg]) => {
        if (op === '$gt')
          return value instanceof Date && arg instanceof Date
            ? value > arg
            : (value as number) > (arg as number)
        if (op === '$ne') return value !== arg
        if (op === '$in') return (arg as unknown[]).includes(value)
        throw new Error(`fake-db: unsupported operator ${op}`)
      })
    }
    return value === cond
  })
}

export function createFakeDb(seed: Record<string, Doc[]> = {}, opts: { failing?: string[] } = {}) {
  const data: Record<string, Doc[]> = Object.fromEntries(
    Object.entries(seed).map(([k, v]) => [k, v.map((d) => ({ ...d }))]),
  )
  const calls: Call[] = []

  const col = (name: string) => {
    const rows = () => (data[name] ??= [])
    const record = (op: string, filter: Filter, options?: unknown) => {
      calls.push({ collection: name, op, filter, options })
      if (opts.failing?.includes(name)) throw new Error(`fake-db: ${name} unavailable`)
    }
    const applyUpdate = (doc: Doc, update: Record<string, Doc>) => {
      Object.assign(doc, update['$set'] ?? {})
      for (const [k, v] of Object.entries(update['$inc'] ?? {}))
        doc[k] = ((doc[k] as number | undefined) ?? 0) + (v as unknown as number)
      for (const k of Object.keys(update['$unset'] ?? {})) delete doc[k]
      for (const [k, v] of Object.entries(update['$addToSet'] ?? {})) {
        const arr = (doc[k] as unknown[] | undefined) ?? []
        if (!arr.includes(v)) arr.push(v)
        doc[k] = arr
      }
    }
    return {
      findOne: async (filter: Filter = {}, options?: unknown) => {
        record('findOne', filter, options)
        return rows().find((d) => matches(d, filter)) ?? null
      },
      countDocuments: async (filter: Filter = {}) => {
        record('countDocuments', filter)
        return rows().filter((d) => matches(d, filter)).length
      },
      find: (filter: Filter = {}, options?: unknown) => {
        record('find', filter, options)
        let result = rows().filter((d) => matches(d, filter))
        const cursor = {
          sort: (spec: Record<string, 1 | -1>) => {
            const [[k, dir]] = Object.entries(spec) as [[string, 1 | -1]]
            result = [...result].sort((a, b) => ((a[k] as Date) > (b[k] as Date) ? dir : -dir))
            return cursor
          },
          limit: (n: number) => {
            result = result.slice(0, n)
            return cursor
          },
          toArray: async () => result,
        }
        return cursor
      },
      insertOne: async (doc: Doc) => {
        record('insertOne', doc)
        rows().push({ ...doc })
        return { acknowledged: true }
      },
      updateOne: async (
        filter: Filter,
        update: Record<string, Doc>,
        options?: { upsert?: boolean },
      ) => {
        record('updateOne', filter, options)
        const doc = rows().find((d) => matches(d, filter))
        if (doc) {
          applyUpdate(doc, update)
          return { matchedCount: 1, modifiedCount: 1 }
        }
        if (options?.upsert) {
          const created: Doc = { ...filter, ...(update['$setOnInsert'] ?? {}) }
          applyUpdate(created, update)
          rows().push(created)
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
        }
        return { matchedCount: 0, modifiedCount: 0 }
      },
      updateMany: async (filter: Filter, update: Record<string, Doc>) => {
        record('updateMany', filter)
        const hits = rows().filter((d) => matches(d, filter))
        for (const d of hits) applyUpdate(d, update)
        return { matchedCount: hits.length, modifiedCount: hits.length }
      },
      findOneAndUpdate: async (filter: Filter, update: Record<string, Doc>) => {
        record('findOneAndUpdate', filter)
        const doc = rows().find((d) => matches(d, filter))
        if (!doc) return null
        applyUpdate(doc, update)
        return { ...doc }
      },
      deleteOne: async (filter: Filter) => {
        record('deleteOne', filter)
        const i = rows().findIndex((d) => matches(d, filter))
        if (i >= 0) rows().splice(i, 1)
        return { deletedCount: i >= 0 ? 1 : 0 }
      },
      deleteMany: async (filter: Filter) => {
        record('deleteMany', filter)
        const keep = rows().filter((d) => !matches(d, filter))
        const deleted = rows().length - keep.length
        data[name] = keep
        return { deletedCount: deleted }
      },
      createIndex: async () => 'ok',
    }
  }

  const db = { collection: withTenantKeys(col) } as never
  return { db, data, calls }
}
