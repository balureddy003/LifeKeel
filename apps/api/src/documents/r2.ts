/**
 * Cloudflare R2 access (CLOUDFLARE_INTEGRATION.md §7.1).
 *
 * Three private buckets: quarantine (untrusted uploads), clean (verified
 * bytes) and vault (tenant-envelope ciphertext). One credential per job,
 * each scoped in Cloudflare to the buckets it needs:
 *
 *   presign  quarantine RW   API: sign PUT, HEAD, delete abandoned uploads
 *   scan     quarantine RW + clean RW   scan worker and reconciler only
 *   serve    clean R         API: sign GET, stream bytes for old clients
 *   delete   clean RW        document delete and erasure only
 *   vault    vault RW        vault routes only
 *
 * Only the scan worker can write clean (plus delete). A leaked presign key
 * cannot touch clean or the vault. `r2-clients.test.ts` allow-lists which
 * source files may ask for each credential, so a new caller is a reviewed
 * change (same tripwire idea as trust-tier-gate.test.ts).
 *
 * Presigned URLs only work on the S3 API endpoint, never a custom domain,
 * and R2 has no presigned POST: a PUT signs Content-Type only. Size is
 * enforced by the HEAD at /complete, the scanner's re-check and the quota
 * reservation (browsers set Content-Length themselves).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Env } from '../security/boot-guards.js'

export type R2Credential = 'presign' | 'scan' | 'serve' | 'delete' | 'vault'
export type BucketRole = 'quarantine' | 'clean' | 'vault'

export const CREDENTIAL_BUCKETS: Record<R2Credential, readonly BucketRole[]> = {
  presign: ['quarantine'],
  scan: ['quarantine', 'clean'],
  serve: ['clean'],
  delete: ['clean'],
  vault: ['vault'],
}

/** Buckets each credential may write or delete in (serve is read-only). */
export const CREDENTIAL_WRITES: Record<R2Credential, readonly BucketRole[]> = {
  presign: ['quarantine'],
  scan: ['quarantine', 'clean'],
  serve: [],
  delete: ['clean'],
  vault: ['vault'],
}

export interface R2Settings {
  endpoint: string
  buckets: Record<BucketRole, string>
  keys: Partial<Record<R2Credential, { accessKeyId: string; secretAccessKey: string }>>
  forcePathStyle: boolean
}

export function r2Settings(env: Env = process.env): R2Settings | null {
  const account = env['R2_ACCOUNT_ID']
  const endpoint =
    env['R2_ENDPOINT'] ??
    (account
      ? `https://${account}.${env['R2_JURISDICTION'] === 'default' ? '' : `${env['R2_JURISDICTION'] ?? 'eu'}.`}r2.cloudflarestorage.com`
      : undefined)
  if (!endpoint) return null
  const keys: R2Settings['keys'] = {}
  for (const cred of Object.keys(CREDENTIAL_BUCKETS) as R2Credential[]) {
    const id = env[`R2_${cred.toUpperCase()}_ACCESS_KEY_ID`]
    const secret = env[`R2_${cred.toUpperCase()}_SECRET_ACCESS_KEY`]
    if (id && secret) keys[cred] = { accessKeyId: id, secretAccessKey: secret }
  }
  return {
    endpoint,
    buckets: {
      quarantine: env['R2_BUCKET_QUARANTINE'] ?? 'lifekeel-quarantine',
      clean: env['R2_BUCKET_CLEAN'] ?? 'lifekeel-clean',
      vault: env['R2_BUCKET_VAULT'] ?? 'lifekeel-vault',
    },
    keys,
    // MinIO (CI) needs path-style; R2 accepts it too.
    forcePathStyle: env['R2_FORCE_PATH_STYLE'] === 'true',
  }
}

export interface HeadResult {
  size: number
  etag: string | undefined
}

/** The operations the pipeline needs, bound to one credential. */
export interface ObjectStore {
  readonly credential: R2Credential
  bucket(role: BucketRole): string
  put(role: BucketRole, key: string, body: Buffer, contentType: string): Promise<void>
  get(role: BucketRole, key: string): Promise<Buffer | null>
  head(role: BucketRole, key: string): Promise<HeadResult | null>
  delete(role: BucketRole, key: string): Promise<void>
  list(role: BucketRole, prefix: string): Promise<string[]>
  presignPut(role: BucketRole, key: string, contentType: string, ttlS: number): Promise<string>
  presignGet(
    role: BucketRole,
    key: string,
    opts: { ttlS: number; filename: string; contentType: string },
  ): Promise<string>
}

function assertRole(cred: R2Credential, role: BucketRole, write = false): void {
  if (!CREDENTIAL_BUCKETS[cred].includes(role))
    throw new Error(`R2 credential '${cred}' has no access to the ${role} bucket`)
  if (write && !CREDENTIAL_WRITES[cred].includes(role))
    throw new Error(`R2 credential '${cred}' is read-only on the ${role} bucket`)
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404
}

/** RFC 5987 attachment disposition: never trust the stored filename in a header. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client
  constructor(
    readonly credential: R2Credential,
    private readonly settings: R2Settings,
  ) {
    const key = settings.keys[credential]
    if (!key) throw new Error(`R2 credential '${credential}' is not configured`)
    this.client = new S3Client({
      region: 'auto',
      endpoint: settings.endpoint,
      credentials: key,
      forcePathStyle: settings.forcePathStyle,
    })
  }
  bucket(role: BucketRole): string {
    assertRole(this.credential, role)
    return this.settings.buckets[role]
  }
  async put(role: BucketRole, key: string, body: Buffer, contentType: string): Promise<void> {
    assertRole(this.credential, role, true)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(role),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  }
  async get(role: BucketRole, key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(role), Key: key }),
      )
      const bytes = await res.Body?.transformToByteArray()
      return bytes ? Buffer.from(bytes) : Buffer.alloc(0)
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }
  async head(role: BucketRole, key: string): Promise<HeadResult | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(role), Key: key }),
      )
      return { size: Number(res.ContentLength ?? 0), etag: res.ETag }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }
  async delete(role: BucketRole, key: string): Promise<void> {
    assertRole(this.credential, role, true)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(role), Key: key }))
  }
  async list(role: BucketRole, prefix: string): Promise<string[]> {
    const keys: string[] = []
    let token: string | undefined
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket(role),
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    return keys
  }
  presignPut(role: BucketRole, key: string, contentType: string, ttlS: number): Promise<string> {
    assertRole(this.credential, role, true)
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket(role), Key: key, ContentType: contentType }),
      { expiresIn: ttlS },
    )
  }
  presignGet(
    role: BucketRole,
    key: string,
    opts: { ttlS: number; filename: string; contentType: string },
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket(role),
        Key: key,
        ResponseContentDisposition: attachmentDisposition(opts.filename),
        ResponseContentType: opts.contentType,
        ResponseCacheControl: 'private, max-age=60',
      }),
      { expiresIn: opts.ttlS },
    )
  }
}

type Factory = (cred: R2Credential) => ObjectStore
const cache = new Map<R2Credential, ObjectStore>()
let factory: Factory | null = null

/** Tests swap in an in-memory store (documents/memory-store.ts). */
export function setObjectStoreFactory(f: Factory | null): void {
  factory = f
  cache.clear()
}

/** Whether this process holds the credential (or a test store is installed). */
export function hasCredential(cred: R2Credential): boolean {
  return factory !== null || Boolean(r2Settings()?.keys[cred])
}

/**
 * The store for one credential. Only the files allow-listed in
 * r2-clients.test.ts may call this for a given credential.
 */
export function objectStore(cred: R2Credential): ObjectStore {
  const hit = cache.get(cred)
  if (hit) return hit
  let store: ObjectStore
  if (factory) store = factory(cred)
  else {
    const settings = r2Settings()
    if (!settings) throw new Error('R2 is not configured (R2_ACCOUNT_ID or R2_ENDPOINT)')
    store = new S3ObjectStore(cred, settings)
  }
  cache.set(cred, store)
  return store
}
