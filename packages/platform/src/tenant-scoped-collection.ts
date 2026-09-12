// Structural MongoDB wrapper; the platform package does not require consumers
// to use a specific driver version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Collection<T> = any

export class TenantScopedCollection<T extends Record<string, unknown>> {
  constructor(
    private readonly collection: Collection<T>,
    private readonly tenantId: string,
  ) {
    if (!tenantId) throw new Error('TenantScopedCollection requires tenant_id')
  }

  find(filter: Record<string, unknown> = {}) {
    return this.collection.find(this.scope(filter))
  }

  findOne(filter: Record<string, unknown> = {}, options?: unknown): Promise<T | null> {
    return this.collection.findOne(this.scope(filter), options)
  }

  insertOne(document: Omit<T, 'tenant_id'>): Promise<unknown> {
    return this.collection.insertOne({ ...document, tenant_id: this.tenantId })
  }

  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown): Promise<unknown> {
    return this.collection.updateOne(this.scope(filter), update, options)
  }

  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown): Promise<unknown> {
    return this.collection.updateMany(this.scope(filter), update, options)
  }

  replaceOne(filter: Record<string, unknown>, doc: any, options?: any): Promise<unknown> {
    return this.collection.replaceOne(this.scope(filter), { ...doc, tenant_id: this.tenantId }, options)
  }

  deleteOne(filter: Record<string, unknown>): Promise<unknown> {
    return this.collection.deleteOne(this.scope(filter))
  }

  deleteMany(filter: Record<string, unknown>): Promise<unknown> {
    return this.collection.deleteMany(this.scope(filter))
  }

  countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return this.collection.countDocuments(this.scope(filter))
  }

  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options?: any): Promise<any> {
    return this.collection.findOneAndUpdate(this.scope(filter), update, options)
  }

  aggregate(pipeline: any[] = [], options?: any): any {
    const matchStage = { $match: { tenant_id: this.tenantId } }
    return this.collection.aggregate([matchStage, ...pipeline], options)
  }

  distinct(field: string, filter: Record<string, unknown> = {}, options?: any): Promise<any[]> {
    return this.collection.distinct(field, this.scope(filter), options)
  }

  private scope(filter: Record<string, unknown>): Record<string, unknown> {
    if ('tenant_id' in filter && filter['tenant_id'] !== this.tenantId) {
      throw new Error('Cross-tenant collection access rejected')
    }
    return { ...filter, tenant_id: this.tenantId }
  }
}

export function getTenantCollection<T extends Record<string, unknown>>(
  db: any,
  name: string,
  tenantId: string,
): TenantScopedCollection<T> {
  return new TenantScopedCollection<T>(db.collection(name), tenantId)
}
