/**
 * Earned-Scope Contracts (PRD-214, M5) — autonomy as an explicit artifact.
 *
 * A scope contract is the versioned record of what the family has granted
 * Keel permission to do on its own: the scope, the terms, who granted it,
 * when, and every change since. The contract is not decorative — granting
 * and collapsing write the same `tenant_settings.automation` flag the
 * execution path already re-checks at send time, so the artifact IS the
 * control, not a description of it.
 *
 * Direction of travel is asymmetric on purpose:
 *  - Expansion only ever happens by an explicit family grant.
 *  - Contraction happens two ways — the family collapses the scope in one
 *    action, or an incident suspends it automatically (repeated delivery
 *    failure means the granted channel is not working; the honest move is
 *    to stop and hand the decision back, not keep retrying silently).
 *    A suspended scope resumes ONLY through a new explicit grant.
 *
 * v1 covers exactly one notification-class scope — policy renewal
 * reminders — matching the PRD's example. New scopes mean a new catalogue
 * entry plus a real enforcement flag; a scope that doesn't control
 * behavior is not a contract, it's a lie.
 */

import type { Db } from 'mongodb'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getAuditLogger, type AuditAction } from '../audit/audit-log.js'

export const SUSPEND_AFTER_CONSECUTIVE_FAILURES = 3
const FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface ScopeContractDoc {
  id: string
  tenant_id: string
  scope_id: string
  template_version: number
  state: 'granted' | 'suspended' | 'collapsed'
  terms: Record<string, unknown>
  granted_at?: Date
  granted_by?: string
  suspended_at?: Date
  suspend_reason?: string
  collapsed_at?: Date
  collapsed_by?: string
  collapse_reason?: string
  adjustments: Array<{ at: Date; kind: 'downward'; reason: string; detail: string }>
  history: Array<{ at: Date; event: string; actor: string; note?: string }>
  created_at: Date
  updated_at: Date
}

export interface ScopeDefinition {
  scope_id: string
  template_version: number
  title: string
  /** The grant in plain language — the sentence the family says yes to. */
  terms_text: string
  scope_class: 'notification'
  /** What the scope can never do — stated, not implied. */
  boundary_text: string
  /** The tenant_settings.automation flag that enforces this scope. */
  flag: string
}

export const SCOPE_CATALOGUE: Record<string, ScopeDefinition> = {
  policy_renewal_reminders: {
    scope_id: 'policy_renewal_reminders',
    template_version: 1,
    title: 'Policy renewal reminders',
    terms_text: 'Keel may send you a reminder before a policy on file reaches its renewal date.',
    scope_class: 'notification',
    boundary_text:
      'Never contacts the insurer, never compares or recommends a product, never changes anything on file.',
    flag: 'renewal_reminders_enabled',
  },
}

export async function ensureScopeContractIndexes(db: Db): Promise<void> {
  const col = db.collection<ScopeContractDoc>('scope_contracts')
  await col.createIndex({ tenant_id: 1, scope_id: 1 }, { unique: true })
}

function flagPath(def: ScopeDefinition): string {
  return `automation.${def.flag}`
}

async function writeFlag(
  db: Db,
  tenantId: string,
  def: ScopeDefinition,
  on: boolean,
): Promise<void> {
  await db.collection('tenant_settings').updateOne(
    { tenant_id: tenantId },
    {
      $set: { [flagPath(def)]: on, updated_at: new Date() },
      $setOnInsert: { tenant_id: tenantId },
    },
    { upsert: true },
  )
}

function event(at: Date, name: string, actor: string, note?: string) {
  return { at, event: name, actor, ...(note ? { note } : {}) }
}

function auditEvent(
  request: FastifyRequest | null,
  tenantId: string,
  actor: string,
  action: AuditAction,
  scopeId: string,
  metadata: Record<string, unknown>,
): void {
  const logger = getAuditLogger()
  if (!logger) return
  if (request) {
    logger.fromRequest(request, action, 'scope_contract', scopeId, metadata)
    return
  }
  // Job-driven suspension has no request — ip/user_agent are honestly empty.
  logger.log({
    tenant_id: tenantId,
    user_id: actor,
    action,
    resource_type: 'scope_contract',
    resource_id: scopeId,
    metadata,
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}

/** The family says yes: contract granted, flag on, history recorded. */
export async function grantScope(
  db: Db,
  tenantId: string,
  scopeId: string,
  actor: string,
  request: FastifyRequest | null = null,
): Promise<ScopeContractDoc | null> {
  const def = SCOPE_CATALOGUE[scopeId]
  if (!def) return null
  const now = new Date()
  const settings = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  const automation = (settings?.['automation'] ?? {}) as Record<string, unknown>
  const terms = {
    lead_days: automation['renewal_reminder_lead_days'] ?? [30, 7],
    channel: 'push_notification',
  }

  await writeFlag(db, tenantId, def, true)
  await db.collection<ScopeContractDoc>('scope_contracts').updateOne(
    { tenant_id: tenantId, scope_id: scopeId },
    {
      $set: {
        state: 'granted',
        template_version: def.template_version,
        terms,
        granted_at: now,
        granted_by: actor,
        updated_at: now,
      },
      $unset: {
        suspended_at: '',
        suspend_reason: '',
        collapsed_at: '',
        collapsed_by: '',
        collapse_reason: '',
      },
      $push: { history: event(now, 'granted', actor, 'Explicit family grant') },
      $setOnInsert: {
        id: randomUUID(),
        tenant_id: tenantId,
        scope_id: scopeId,
        adjustments: [],
        created_at: now,
      },
    },
    { upsert: true },
  )
  auditEvent(request, tenantId, actor, 'scope_contract.grant', scopeId, {
    scope_class: def.scope_class,
  })
  return db
    .collection<ScopeContractDoc>('scope_contracts')
    .findOne({ tenant_id: tenantId, scope_id: scopeId })
}

/** One action and it stops: flag off, pending reminders cancelled by the next sync. */
export async function collapseScope(
  db: Db,
  tenantId: string,
  scopeId: string,
  actor: string,
  reason?: string,
  request: FastifyRequest | null = null,
): Promise<ScopeContractDoc | null> {
  const def = SCOPE_CATALOGUE[scopeId]
  if (!def) return null
  const now = new Date()
  await writeFlag(db, tenantId, def, false)
  const res = await db.collection<ScopeContractDoc>('scope_contracts').updateOne(
    { tenant_id: tenantId, scope_id: scopeId },
    {
      $set: {
        state: 'collapsed',
        collapsed_at: now,
        collapsed_by: actor,
        ...(reason ? { collapse_reason: reason } : {}),
        updated_at: now,
      },
      $unset: { suspended_at: '', suspend_reason: '' },
      $push: { history: event(now, 'collapsed', actor, reason) },
      $setOnInsert: {
        id: randomUUID(),
        tenant_id: tenantId,
        scope_id: scopeId,
        template_version: def.template_version,
        terms: {},
        adjustments: [],
        created_at: now,
      },
    },
    { upsert: true },
  )
  if (res.matchedCount || res.upsertedCount) {
    auditEvent(request, tenantId, actor, 'scope_contract.collapse', scopeId, {
      reason: reason ?? 'family collapsed the scope',
    })
  }
  return db
    .collection<ScopeContractDoc>('scope_contracts')
    .findOne({ tenant_id: tenantId, scope_id: scopeId })
}

/**
 * Automatic downward adjustment: the scope is suspended and the flag goes
 * off. Resuming requires a new explicit grant — the contract never widens
 * itself back.
 */
export async function suspendScopeForIncident(
  db: Db,
  tenantId: string,
  scopeId: string,
  reason: string,
  detail: string,
): Promise<boolean> {
  const def = SCOPE_CATALOGUE[scopeId]
  if (!def) return false
  const now = new Date()
  await writeFlag(db, tenantId, def, false)
  await db.collection<ScopeContractDoc>('scope_contracts').updateOne(
    { tenant_id: tenantId, scope_id: scopeId },
    {
      $set: { state: 'suspended', suspended_at: now, suspend_reason: reason, updated_at: now },
      $unset: { collapsed_at: '', collapsed_by: '', collapse_reason: '' },
      $push: {
        adjustments: { at: now, kind: 'downward' as const, reason, detail },
        history: event(now, 'suspended', 'system', detail),
      },
      $setOnInsert: {
        id: randomUUID(),
        tenant_id: tenantId,
        scope_id: scopeId,
        template_version: def.template_version,
        terms: {},
        created_at: now,
      },
    },
    { upsert: true },
  )
  auditEvent(null, tenantId, 'system', 'scope_contract.suspend', scopeId, { reason, detail })
  return true
}

/**
 * Called after a reminder exhausts its retries: if the tenant's failed
 * sends over the last 30 days reach the threshold, the granted channel is
 * not working and the scope suspends itself.
 */
export async function maybeSuspendScopeOnFailures(db: Db, tenantId: string): Promise<boolean> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS)
  const failed = await db.collection('reminders').countDocuments({
    tenant_id: tenantId,
    kind: 'policy_renewal',
    status: 'failed',
    updated_at: { $gte: since },
  })
  if (failed < SUSPEND_AFTER_CONSECUTIVE_FAILURES) return false
  return suspendScopeForIncident(
    db,
    tenantId,
    'policy_renewal_reminders',
    'repeated_delivery_failure',
    `${failed} reminders failed to deliver in the last 30 days — paused until you re-grant it`,
  )
}

export interface ScopeContractView {
  scope_id: string
  template_version: number
  title: string
  terms_text: string
  boundary_text: string
  scope_class: 'notification'
  /** Effective state — the flag is the enforcement truth. */
  state: 'granted' | 'suspended' | 'collapsed' | 'not_granted'
  enabled: boolean
  granted_at?: string
  granted_by?: string
  suspended_at?: string
  suspend_reason?: string
  collapsed_at?: string
  collapse_reason?: string
  adjustments: ScopeContractDoc['adjustments']
  history: ScopeContractDoc['history']
  evidence: Record<string, number>
}

async function evidenceFor(
  db: Db,
  tenantId: string,
  scopeId: string,
): Promise<Record<string, number>> {
  if (scopeId !== 'policy_renewal_reminders') return {}
  const rows = await db
    .collection<{ status: string }>('reminders')
    .aggregate<{ _id: string; n: number }>([
      { $match: { tenant_id: tenantId, kind: 'policy_renewal' } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ])
    .toArray()
  const out: Record<string, number> = {}
  for (const r of rows) out[r._id] = r.n
  return out
}

/** Render the catalogue against real records — state and evidence, never invented. */
export async function listScopeContractViews(
  db: Db,
  tenantId: string,
): Promise<ScopeContractView[]> {
  const settings = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  const automation = (settings?.['automation'] ?? {}) as Record<string, unknown>
  const contracts = await db
    .collection<ScopeContractDoc>('scope_contracts')
    .find({ tenant_id: tenantId })
    .toArray()
  const byScope = new Map(contracts.map((c) => [c.scope_id, c]))

  const views: ScopeContractView[] = []
  for (const def of Object.values(SCOPE_CATALOGUE)) {
    const c = byScope.get(def.scope_id)
    const enabled = automation[def.flag] === true
    // Effective state: the flag is the enforcement truth. A contract that
    // says 'granted' while the flag is off means the flag was written
    // outside the contract path — surface the truth.
    let state: ScopeContractView['state']
    if (enabled) state = 'granted'
    else if (c?.state === 'suspended') state = 'suspended'
    else if (c?.state === 'collapsed') state = 'collapsed'
    else state = c ? 'collapsed' : 'not_granted'

    views.push({
      scope_id: def.scope_id,
      template_version: def.template_version,
      title: def.title,
      terms_text: def.terms_text,
      boundary_text: def.boundary_text,
      scope_class: def.scope_class,
      state,
      enabled,
      ...(c?.granted_at
        ? { granted_at: c.granted_at.toISOString(), granted_by: c.granted_by }
        : {}),
      ...(c?.suspended_at
        ? { suspended_at: c.suspended_at.toISOString(), suspend_reason: c.suspend_reason }
        : {}),
      ...(c?.collapsed_at
        ? { collapsed_at: c.collapsed_at.toISOString(), collapse_reason: c.collapse_reason }
        : {}),
      adjustments: c?.adjustments ?? [],
      history: c?.history ?? [],
      evidence: await evidenceFor(db, tenantId, def.scope_id),
    })
  }
  return views
}
