/**
 * restore-drill.ts — executable backup/restore + erasure-reconciliation drill.
 *
 * Run:  pnpm --filter @lifekeel/api exec tsx ../../scripts/ops/restore-drill.ts
 *
 * What it proves, end-to-end, against a scratch MongoDB:
 *   1. scripts/ops/backup.sh produces a restorable archive.
 *   2. A --drop restore of a pre-deletion backup resurrects the deleted
 *      tenant's rows AND their 'active' tenants row (the real hazard).
 *   3. scripts/ops/restore.sh's tombstone export/re-apply preserves the
 *      deletion marker across the drop.
 *   4. runErasureReplay re-wipes the resurrected data; a live tenant is
 *      untouched.
 *
 * Timing output doubles as a first RTO measurement for the runbook.
 * Deliberately uses the real scripts rather than reimplementing them, so a
 * script regression fails the drill.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GridFSBucket, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { eraseTenantData } from '../../apps/api/src/erasure.js'
import { runErasureReplay } from '../../apps/api/src/jobs/erasure-replay.js'

const DB = 'lifekeel_drill'
const OPS = new URL('.', import.meta.url).pathname

const DEAD = 'tenant_dead'
const LIVE = 'tenant_live'

// One doc per erasure-path shape the drill must see resurrected and re-wiped.
function tenantDocs(tenantId: string) {
  return [
    { coll: 'tenants', doc: { tenant_id: tenantId, status: 'active' } },
    { coll: 'users', doc: { tenant_id: tenantId, id: `u_${tenantId}`, email: `${tenantId}@x.io` } },
    { coll: 'insights', doc: { tenant_id: tenantId, claim: 'x' } },
    { coll: 'growth_events', doc: { meta: { tenant_id: tenantId }, name: 'e' } },
    {
      coll: 'lifecycle_sends',
      doc: { recipient: `u_${tenantId}`, email: `${tenantId}@x.io`, template: 't' },
    },
    { coll: 'referrals', doc: { referrer_tenant_id: tenantId, referred_tenant_id: 'other' } },
  ]
}

async function seed(db: import('mongodb').Db, tenantId: string) {
  for (const { coll, doc } of tenantDocs(tenantId)) {
    await db.collection(coll).insertOne({ ...doc })
  }
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })
  const stream = bucket.openUploadStream('drill.txt', { metadata: { tenant_id: tenantId } })
  stream.end('drill-bytes')
  await new Promise((res, rej) => stream.on('finish', res).on('error', rej))
}

async function tenantDocCount(db: import('mongodb').Db, tenantId: string) {
  let n = 0
  n += await db.collection('users').countDocuments({ tenant_id: tenantId })
  n += await db.collection('insights').countDocuments({ tenant_id: tenantId })
  n += await db.collection('growth_events').countDocuments({ 'meta.tenant_id': tenantId })
  n += await db.collection('lifecycle_sends').countDocuments({ recipient: `u_${tenantId}` })
  n += await db
    .collection('referrals')
    .countDocuments({ $or: [{ referrer_tenant_id: tenantId }, { referred_tenant_id: tenantId }] })
  const fileIds = await db
    .collection('documents.files')
    .find({ 'metadata.tenant_id': tenantId })
    .project({ _id: 1 })
    .toArray()
  n += fileIds.length
  // GridFS chunks key on files_id, not tenant metadata — count via the join.
  n += await db
    .collection('documents.chunks')
    .countDocuments({ files_id: { $in: fileIds.map((f) => f._id) } })
  return n
}

async function main() {
  const t0 = Date.now()
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

  const mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()
  // Local drill: plaintext archive, and the drill runs the replay itself below.
  const env = {
    ...process.env,
    MONGODB_URL: uri,
    MONGODB_DB: DB,
    ALLOW_UNENCRYPTED_BACKUP: '1',
    SKIP_AUTO_REPLAY: '1',
  }
  const run = (script: string, args: string[]) =>
    execFileSync('bash', [join(OPS, script), ...args], { env, encoding: 'utf-8' })

  const client = await MongoClient.connect(uri)
  const db = client.db(DB)
  const backupDir = mkdtempSync(join(tmpdir(), 'lk-drill-'))

  console.log(`[${elapsed()}] seeded drill DB at ${uri}`)

  await seed(db, DEAD)
  await seed(db, LIVE)
  const liveSeeded = await tenantDocCount(db, LIVE)

  // 1. Backup BEFORE the deletion — this is the stale snapshot a restore sees.
  const backupOut = run('backup.sh', [backupDir])
  console.log(`[${elapsed()}] backup: ${backupOut.trim()}`)
  const archive = join(backupDir, backupOut.match(/lifekeel-\S+\.archive/)![0])

  // 2. Account deletion: full wipe + tombstone.
  await eraseTenantData(db, DEAD)
  await db.collection('tenants').updateOne({ tenant_id: DEAD }, { $set: { status: 'deleted' } })
  console.log(`[${elapsed()}] deleted ${DEAD}: doc count=${await tenantDocCount(db, DEAD)}`)

  // 3. Disaster restore --drop of the PRE-deletion archive via the real script.
  const restoreOut = run('restore.sh', [archive, '--drop'])
  console.log(`[${elapsed()}] restore:\n${restoreOut.trim()}`)

  // Sanity: --drop resurrected the pre-deletion data...
  const resurrected = await tenantDocCount(db, DEAD)
  // ...but restore.sh re-applied the tombstone.
  const tombstone = await db.collection('tenants').findOne({ tenant_id: DEAD })
  console.log(
    `[${elapsed()}] post-restore ${DEAD}: docs=${resurrected}, status=${tombstone?.status}`,
  )

  // 4. Erasure replay — the reconciliation step the runbook requires.
  await runErasureReplay(db)

  const deadAfter = await tenantDocCount(db, DEAD)
  const liveAfter = await tenantDocCount(db, LIVE)

  const checks: Array<[string, boolean]> = [
    ['stale restore resurrected deleted-tenant docs', resurrected > 0],
    [
      'erasure marker survived the --drop restore',
      tombstone?.status === 'deleted' || tombstone?.status === 'deleting',
    ],
    ['replay re-wiped the resurrected tenant', deadAfter === 0],
    ['live tenant survived the restore', liveAfter === liveSeeded],
  ]

  let ok = true
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
    if (!pass) ok = false
  }
  console.log(
    `[${elapsed()}] drill ${ok ? 'PASSED' : 'FAILED'} — ` +
      `resurrected=${resurrected} re-wiped=${resurrected - deadAfter} live_docs=${liveAfter}`,
  )

  await client.close()
  await mongod.stop()
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('Drill failed with error:', err)
  process.exit(1)
})
