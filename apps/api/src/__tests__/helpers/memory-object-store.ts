/**
 * In-memory stand-in for R2, enforcing the same per-credential bucket scopes
 * as documents/r2.ts so a test catches a call site using the wrong key.
 * Presigned URLs are fake `memory://` URLs; `putViaUrl` plays the browser.
 */
import { createHash } from 'node:crypto'
import {
  CREDENTIAL_BUCKETS,
  CREDENTIAL_WRITES,
  setObjectStoreFactory,
  type BucketRole,
  type ObjectStore,
  type R2Credential,
} from '../../documents/r2.js'

export class MemoryBuckets {
  readonly objects: Record<BucketRole, Map<string, Buffer>> = {
    quarantine: new Map(),
    clean: new Map(),
    vault: new Map(),
  }
  readonly calls: Array<{ cred: R2Credential; op: string; role: BucketRole; key: string }> = []

  store(cred: R2Credential): ObjectStore {
    const { objects, calls } = this
    const check = (role: BucketRole, write = false) => {
      if (!CREDENTIAL_BUCKETS[cred].includes(role))
        throw new Error(`R2 credential '${cred}' has no access to the ${role} bucket`)
      if (write && !CREDENTIAL_WRITES[cred].includes(role))
        throw new Error(`R2 credential '${cred}' is read-only on the ${role} bucket`)
    }
    const log = (op: string, role: BucketRole, key: string) => calls.push({ cred, op, role, key })
    return {
      credential: cred,
      bucket: (role) => (check(role), `mem-${role}`),
      async put(role, key, body) {
        check(role, true)
        log('put', role, key)
        objects[role].set(key, Buffer.from(body))
      },
      async get(role, key) {
        check(role)
        log('get', role, key)
        const b = objects[role].get(key)
        return b ? Buffer.from(b) : null
      },
      async head(role, key) {
        check(role)
        const b = objects[role].get(key)
        return b ? { size: b.length, etag: `"${createHash('md5').update(b).digest('hex')}"` } : null
      },
      async delete(role, key) {
        check(role, true)
        log('delete', role, key)
        objects[role].delete(key)
      },
      async list(role, prefix) {
        check(role)
        return [...objects[role].keys()].filter((k) => k.startsWith(prefix))
      },
      async presignPut(role, key, contentType, ttlS) {
        check(role, true)
        return `memory://${role}/${key}?ct=${encodeURIComponent(contentType)}&ttl=${ttlS}`
      },
      async presignGet(role, key, opts) {
        check(role)
        return `memory://${role}/${key}?ttl=${opts.ttlS}&dl=${encodeURIComponent(opts.filename)}`
      },
    }
  }

  /** What a browser PUT to a presigned URL does. */
  putViaUrl(url: string, body: Buffer): void {
    const m = /^memory:\/\/(\w+)\/([^?]+)/.exec(url)
    if (!m) throw new Error(`not a memory URL: ${url}`)
    this.objects[m[1] as BucketRole].set(decodeURIComponent(m[2]!), Buffer.from(body))
  }

  install(): this {
    setObjectStoreFactory((cred) => this.store(cred))
    return this
  }

  static uninstall(): void {
    setObjectStoreFactory(null)
  }
}
