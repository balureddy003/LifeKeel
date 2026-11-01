#!/usr/bin/env node
// grant-test-entitlement.mjs — give named *test* accounts the household_record
// entitlement so a tester can create more than the one free brief.
//
// Usage (from the repo root; reads MONGODB_URL / MONGODB_DB from the environment):
//   node --env-file=.env scripts/ops/grant-test-entitlement.mjs a@example.com b@example.com
//   node --env-file=.env scripts/ops/grant-test-entitlement.mjs --apply a@example.com ...
//   ... --revoke   removes it again (with --apply)
//
// Safe by default: without --apply it only prints what it would change.
// It refuses any address that is not an @example.com test address, so it cannot
// be pointed at a real customer by mistake. Each change touches one tenant's
// `entitlements` field and nothing else.
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url))
const { MongoClient } = require('mongodb')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const revoke = args.includes('--revoke')
const emails = args.filter((a) => !a.startsWith('--')).map((e) => e.trim().toLowerCase())
const ENT = 'household_record'

if (emails.length === 0) {
  console.error('Give at least one test email address.')
  process.exit(2)
}
const bad = emails.filter((e) => !/^[a-z0-9._+-]+@example\.com$/.test(e))
if (bad.length) {
  console.error(`Refusing non-test addresses (only @example.com is allowed): ${bad.join(', ')}`)
  process.exit(2)
}
const url = process.env.MONGODB_URL
if (!url) {
  console.error('MONGODB_URL is not set (run with --env-file=.env).')
  process.exit(2)
}

const client = new MongoClient(url)
await client.connect()
const db = client.db(process.env.MONGODB_DB ?? 'lifekeel')
let changed = 0
try {
  for (const email of emails) {
    const user = await db.collection('users').findOne({ email }, { projection: { tenant_id: 1 } })
    if (!user?.tenant_id) {
      console.log(`${email}: no account found`)
      continue
    }
    const tenants = db.collection('tenants')
    const t = await tenants.findOne(
      { tenant_id: user.tenant_id },
      { projection: { entitlements: 1, plan: 1 } },
    )
    if (!t) {
      console.log(`${email}: tenant ${user.tenant_id} not found`)
      continue
    }
    const ent = t.entitlements
    const has = Array.isArray(ent) ? ent.includes(ENT) : ent?.[ENT] === true
    if (!revoke && has) {
      console.log(`${email}: already has ${ENT} (tenant ${user.tenant_id})`)
      continue
    }
    if (revoke && !has) {
      console.log(`${email}: does not have ${ENT}`)
      continue
    }
    let update
    if (Array.isArray(ent) || ent == null) {
      update = revoke ? { $pull: { entitlements: ENT } } : { $addToSet: { entitlements: ENT } }
    } else {
      update = revoke
        ? { $unset: { [`entitlements.${ENT}`]: '' } }
        : { $set: { [`entitlements.${ENT}`]: true } }
    }
    console.log(
      `${email}: ${apply ? '' : 'would '}${revoke ? 'remove' : 'add'} ${ENT} (tenant ${user.tenant_id}, plan ${t.plan ?? 'none'})`,
    )
    if (apply) {
      await tenants.updateOne({ tenant_id: user.tenant_id }, update)
      changed++
    }
  }
} finally {
  await client.close()
}
console.log(
  apply ? `Done. ${changed} tenant(s) changed.` : 'Dry run only. Re-run with --apply to change.',
)
