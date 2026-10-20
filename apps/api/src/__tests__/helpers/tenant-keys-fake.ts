/**
 * In-memory stand-in for the `tenant_keys` collection, for route tests that hand-roll a fake Db.
 * Stage B4's envelope encryption mints and reads a per-tenant key on every credential write, so
 * a fake whose collection() answers every name with one stub breaks those routes with a 500.
 * Supports exactly what crypto/envelope.ts calls: findOne by equality, insertOne, createIndex.
 */
export function makeTenantKeysFake() {
  const docs: Record<string, unknown>[] = []
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => doc[k] === v)
  return {
    docs,
    findOne: async (filter: Record<string, unknown>) => docs.find((d) => matches(d, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => {
      docs.push(doc)
      return { acknowledged: true }
    },
    createIndex: async () => 'ok',
  }
}

/** Route `tenant_keys` to the fake and every other collection to `other`. */
export function withTenantKeys<T>(other: (name: string) => T): (name: string) => T | ReturnType<typeof makeTenantKeysFake> {
  const keys = makeTenantKeysFake()
  return (name: string) => (name === 'tenant_keys' ? keys : other(name))
}
