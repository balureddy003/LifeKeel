import { MongoClient, ObjectId, type Db } from 'mongodb'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { repoRoot } from '@kairos/platform'

interface Migration {
  id: string
  up(db: Db): Promise<void>
}

interface CategoryTableEntry {
  rule_id_pattern: string
  category: string
}

const migrations: Migration[] = [
  {
    id: '20260606000000-initial-indexes',
    up: async db => {
      await Promise.all([
        db.collection('tenants').createIndex({ tenant_id: 1 }, { unique: true }),
        db.collection('tenant_usage').createIndex({ tenant_id: 1, month: 1 }, { unique: true }),
        db.collection('insights').createIndex({ tenant_id: 1, created_at: -1 }),
        db.collection('workflow_runs').createIndex({ tenant_id: 1, created_at: -1 }),
      ])
    },
  },
  {
    id: '20260606010000-schema-version',
    up: async db => {
      for (const name of ['insights', 'workflow_runs', 'goals', 'action_receipts', 'agent_memory']) {
        await db.collection(name).updateMany({ _schema_version: { $exists: false } }, { $set: { _schema_version: 1 } })
      }
    },
  },
  {
    id: '20260606020000-ttl-indexes',
    up: async db => {
      await Promise.all([
        db.collection('signals').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
        db.collection('insights').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
        db.collection('workflow_runs').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
        db.collection('agent_memory').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      ])
    },
  },
  {
    id: '20260606030000-skill-templates-indexes',
    up: async db => {
      await Promise.all([
        db.collection('skill_templates').createIndex({ tenant_id: 1, target: 1, target_id: 1 }),
        db.collection('skill_rejection_memory').createIndex({ tenant_id: 1, target_id: 1, created_at: -1 }),
      ])
    },
  },
  {
    // Settings page performance: /entitlements/quotas, /scim-config/sync-status,
    // and /auth/me all do countDocuments/findOne on collections that lacked
    // tenant_id indexes, causing full collection scans and 3-5s of latency on
    // the Settings page load.
    id: '20260721000000-settings-perf-indexes',
    up: async db => {
      await Promise.all([
        db.collection('events').createIndex({ tenant_id: 1, created_at: -1 }),
        db.collection('detectors').createIndex({ tenant_id: 1 }),
        db.collection('connector_credentials').createIndex({ tenant_id: 1 }),
        db.collection('users').createIndex({ tenant_id: 1 }),
        db.collection('users').createIndex({ tenant_id: 1, identity_source: 1 }),
        db.collection('groups').createIndex({ tenant_id: 1 }),
        db.collection('tenant_settings').createIndex({ tenant_id: 1 }),
        db.collection('insights').createIndex({ tenant_id: 1, detector_id: 1 }),
      ])
    },
  },
  {
    // HOME-01/HOME-03: goal-progress insights were deduped per-hypothesis, so a
    // goal with two KPIs (e.g. portfolio_growth_pct + portfolio_value_gbp) got
    // two contradictory insights (one "behind pace", one "ahead of pace") or
    // the same recommendation in two units (95%→100% and £4460→£5352). The
    // dedup in events.ts now keys on goal_id for social_goal_progress, so only
    // one insight per goal is open at a time. This migration:
    //   1. Adds an index for the new goal_id-based dedup lookup
    //   2. Marks all but the newest open goal-progress insight per goal as
    //      'archived' to clear the existing duplicates from the feed
    id: '20260721120000-goal-progress-dedup-cleanup',
    up: async db => {
      await db.collection('insights').createIndex({ tenant_id: 1, detector_id: 1, goal_id: 1, state: 1 })
      // Backfill goal_id from feature_snapshot.goal_id on existing insights.
      // The social_goal_progress detector fires for any goal.kpi.updated event,
      // and the KPI compute engine includes goal_id in the event payload — but
      // the goal doesn't list social_goal_progress in detector_ids, so the
      // persistInsights enrichment (which looks up goals by detector_ids) never
      // set goal_id on these insights. The feature_snapshot carries it.
      const missingGoalId = await db.collection('insights').find({
        detector_id: 'social_goal_progress',
        goal_id: { $exists: false },
      }).toArray()
      let backfilled = 0
      for (const doc of missingGoalId) {
        const gid = (doc.feature_snapshot as Record<string, unknown> | undefined)?.['goal_id']
        if (typeof gid === 'string' && gid) {
          await db.collection('insights').updateOne({ _id: doc._id }, { $set: { goal_id: gid } })
          backfilled++
        }
      }
      if (backfilled > 0) process.stdout.write(`[migration] backfilled goal_id on ${backfilled} insights\n`)
      // Find all open goal-progress insights grouped by (tenant_id, goal_id),
      // keep the newest per group, archive the rest.
      const duplicates = await db.collection('insights')
        .find({
          detector_id: 'social_goal_progress',
          state: { $nin: ['dismissed', 'completed', 'archived'] },
          goal_id: { $exists: true, $ne: null },
        })
        .sort({ created_at: -1 })
        .toArray()
      const seen = new Set<string>()
      const toArchive: string[] = []
      for (const doc of duplicates) {
        const key = `${doc.tenant_id}:${doc.goal_id}`
        if (seen.has(key)) {
          toArchive.push(doc._id.toString())
        } else {
          seen.add(key)
        }
      }
      if (toArchive.length > 0) {
        await db.collection('insights').updateMany(
          { _id: { $in: toArchive.map(id => new ObjectId(id)) } },
          { $set: { state: 'archived', archived_at: new Date() } },
        )
        process.stdout.write(`[migration] archived ${toArchive.length} duplicate goal-progress insights\n`)
      }
    },
  },
  {
    // Family app: the household roster (name, invite code, members) moved
    // from client-only localStorage to a real family_groups collection, one
    // document per tenant.
    id: '20260801000000-family-groups-indexes',
    up: async db => {
      await Promise.all([
        db.collection('family_groups').createIndex({ tenant_id: 1 }, { unique: true }),
        db.collection('family_groups').createIndex({ invite_code: 1 }, { unique: true }),
      ])
    },
  },
  {
    // Family app: the manual financial-profile entry (income, expenses,
    // savings, pension, education funds) that feeds the family vertical's
    // detectors — one document per tenant.
    id: '20260802000000-family-financial-profile-indexes',
    up: async db => {
      await db.collection('family_financial_profile').createIndex({ tenant_id: 1 }, { unique: true })
    },
  },
  {
    // category-table.yaml (repo root) previously didn't exist, so every
    // insight's category silently fell through Detector.inferCategory()'s
    // heuristic fallback to 'experience' — which entity-model's
    // riskTierFor() maps to riskTier: 'low' — regardless of what the
    // detector actually meant (e.g. a severe price drop showed the same
    // "Low risk" badge as a routine dividend opportunity). The engine now
    // classifies new insights correctly, but category is set once at
    // insight-creation time and never recomputed on read, so existing
    // documents still carry the stale value. This re-derives category from
    // each insight's rule_id using the same table the engine now loads, and
    // updates only insights whose category is missing or was assigned by
    // the old default ('experience') with no matching table entry at the
    // time — never overwrites a category that was already deliberately set
    // to something else.
    id: '20260817000000-category-table-backfill',
    up: async db => {
      const tableRaw = await fs.readFile(path.join(repoRoot(), 'category-table.yaml'), 'utf8')
      const table = yaml.load(tableRaw) as CategoryTableEntry[]
      const byRuleId = new Map(table.map(entry => [entry.rule_id_pattern, entry.category]))

      const candidates = await db.collection('insights').find({
        category: 'experience',
        rule_id: { $in: [...byRuleId.keys()] },
      }).toArray()

      let updated = 0
      for (const doc of candidates) {
        const category = byRuleId.get(doc['rule_id'] as string)
        if (!category) continue
        await db.collection('insights').updateOne({ _id: doc._id }, { $set: { category } })
        updated++
      }
      if (updated > 0) process.stdout.write(`[migration] backfilled category on ${updated} insights\n`)
    },
  },
  {
    // Follow-up to the migration above: position_over_threshold and
    // price_drop_below_avg are pre-split legacy trading rule IDs (see
    // category-table.yaml's comment on them) that weren't in the table yet
    // when that migration ran, so insights still tagged with those IDs were
    // left at category: 'experience'. Same re-derive-and-update logic,
    // re-run now that the table covers them.
    id: '20260817010000-category-table-backfill-legacy-rule-ids',
    up: async db => {
      const tableRaw = await fs.readFile(path.join(repoRoot(), 'category-table.yaml'), 'utf8')
      const table = yaml.load(tableRaw) as CategoryTableEntry[]
      const byRuleId = new Map(table.map(entry => [entry.rule_id_pattern, entry.category]))

      const candidates = await db.collection('insights').find({
        category: 'experience',
        rule_id: { $in: [...byRuleId.keys()] },
      }).toArray()

      let updated = 0
      for (const doc of candidates) {
        const category = byRuleId.get(doc['rule_id'] as string)
        if (!category) continue
        await db.collection('insights').updateOne({ _id: doc._id }, { $set: { category } })
        updated++
      }
      if (updated > 0) process.stdout.write(`[migration] backfilled category on ${updated} insights (legacy rule ids)\n`)
    },
  },
  {
    // Family app: inbox_items had no uniqueness constraint on the field
    // (tenant_id, email_message_id) email-scan.ts's dedup check reads —
    // found live when a fresh Gmail OAuth connect's automatic scan and a
    // manual "Scan now" click raced and both inserted the same message.
    // createIndex({unique:true}) fails outright if duplicates already exist,
    // so this collapses any first — keeping the earliest created_at per
    // (tenant_id, email_message_id) — before building the index.
    id: '20260826010000-inbox-items-email-dedup-index',
    up: async db => {
      const col = db.collection('inbox_items')
      const dupeGroups = await col.aggregate([
        { $match: { email_message_id: { $exists: true } } },
        { $sort: { created_at: 1 } },
        {
          $group: {
            _id: { tenant_id: '$tenant_id', email_message_id: '$email_message_id' },
            keepId: { $first: '$_id' },
            allIds: { $push: '$_id' },
          },
        },
        { $match: { $expr: { $gt: [{ $size: '$allIds' }, 1] } } },
      ]).toArray()

      let removed = 0
      for (const group of dupeGroups as Array<{ keepId: ObjectId; allIds: ObjectId[] }>) {
        const toRemove = group.allIds.filter(id => !id.equals(group.keepId))
        if (toRemove.length === 0) continue
        const result = await col.deleteMany({ _id: { $in: toRemove } })
        removed += result.deletedCount ?? 0
      }
      if (removed > 0) process.stdout.write(`[migration] removed ${removed} duplicate inbox_items\n`)

      await col.createIndex(
        { tenant_id: 1, email_message_id: 1 },
        { unique: true, partialFilterExpression: { email_message_id: { $exists: true } } },
      )
    },
  },
  {
    // Family app: funnel-event tracking for the public marketing surfaces
    // (landing view, get-started click, signup/family-setup completion,
    // upgrade attempts) — there was no analytics of any kind on these
    // pages before this. created_at index for the summary aggregation's
    // date-range query; event index since every read filters or groups by it.
    id: '20260826000000-growth-events-indexes',
    up: async db => {
      await Promise.all([
        db.collection('growth_events').createIndex({ created_at: -1 }),
        db.collection('growth_events').createIndex({ event: 1, created_at: -1 }),
      ])
    },
  },
]

export async function runMigrations(): Promise<void> {
  const client = new MongoClient(process.env['MONGODB_URL'] ?? process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017')
  await client.connect()
  try {
    const db = client.db(process.env['MONGODB_DB'] ?? 'kairos')
    const history = db.collection('migrations')
    await history.createIndex({ id: 1 }, { unique: true })
    for (const migration of migrations) {
      if (await history.findOne({ id: migration.id })) continue
      await migration.up(db)
      await history.insertOne({ id: migration.id, applied_at: new Date() })
      process.stdout.write(`[migration] applied ${migration.id}\n`)
    }
  } finally {
    await client.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await runMigrations()
