/**
 * /alert-rules — persistent notification rules that fire when insights match.
 *
 * GET    /alert-rules              — list all rules for tenant
 * POST   /alert-rules              — create a rule
 * PATCH  /alert-rules/:id          — update name / trigger / destination / cooldown
 * DELETE /alert-rules/:id          — delete a rule
 * PATCH  /alert-rules/:id/toggle   — enable / disable without full update
 *
 * A rule stores: channel, trigger condition, destination, cooldown, enabled flag.
 * The delivery worker (delivery-router) checks these rules when an insight fires.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

// ── Schema ────────────────────────────────────────────────────────────────────

const ChannelEnum = z.enum(['slack', 'email', 'webhook', 'sms'])

const AlertRuleBody = z.object({
  name:        z.string().min(1).max(120),
  channel:     ChannelEnum,
  trigger:     z.string().min(1).max(200),
  // Empty on create is intentional: the New Action channel picker creates a
  // disabled draft rule up front ("fill in the destination to activate"),
  // then the destination is filled in via PATCH. Requiring non-empty here
  // rejected every draft before that follow-up edit ever had a chance to run.
  destination: z.string().max(500),
  cooldown:    z.enum(['none', '15m', '1h', '4h', '24h']).default('none'),
  enabled:     z.boolean().default(true),
})

const AlertRulePatch = AlertRuleBody.partial()

export interface AlertRule {
  id:          string
  tenant_id:   string
  name:        string
  channel:     'slack' | 'email' | 'webhook' | 'sms'
  trigger:     string
  destination: string
  cooldown:    'none' | '15m' | '1h' | '4h' | '24h'
  enabled:     boolean
  fired_count: number
  last_fired_at?: string
  created_at:  string
  updated_at:  string
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerAlertRuleRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection<AlertRule>('alert_rules')
  col.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})

  /** GET /alert-rules */
  app.get('/alert-rules', async (req) => {
    const { tenant_id } = req.authContext
    const rules = await col
      .find({ tenant_id })
      .sort({ created_at: -1 })
      .toArray()
    return { rules, total: rules.length }
  })

  /** POST /alert-rules */
  app.post<{ Body: unknown }>('/alert-rules', async (req, reply) => {
    const parsed = AlertRuleBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid rule', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    const now = new Date().toISOString()
    const rule: AlertRule = {
      id:          randomUUID(),
      tenant_id,
      ...parsed.data,
      fired_count: 0,
      created_at:  now,
      updated_at:  now,
    }
    await col.insertOne(rule)
    return { rule }
  })

  /** PATCH /alert-rules/:id */
  app.patch<{ Params: { id: string }; Body: unknown }>('/alert-rules/:id', async (req, reply) => {
    const parsed = AlertRulePatch.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    const defined = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Partial<AlertRule>
    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      { $set: { ...defined, updated_at: new Date().toISOString() } },
      { returnDocument: 'after' },
    )
    if (!result) return reply.status(404).send({ error: 'Alert rule not found' })
    return { rule: result }
  })

  /** PATCH /alert-rules/:id/toggle */
  app.patch<{ Params: { id: string } }>('/alert-rules/:id/toggle', async (req, reply) => {
    const { tenant_id } = req.authContext
    const existing = await col.findOne({ id: req.params.id, tenant_id })
    if (!existing) return reply.status(404).send({ error: 'Alert rule not found' })
    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      { $set: { enabled: !existing.enabled, updated_at: new Date().toISOString() } },
      { returnDocument: 'after' },
    )
    return { rule: result }
  })

  /** DELETE /alert-rules/:id */
  app.delete<{ Params: { id: string } }>('/alert-rules/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const result = await col.deleteOne({ id: req.params.id, tenant_id })
    if (result.deletedCount === 0) return reply.status(404).send({ error: 'Alert rule not found' })
    return { deleted: true, id: req.params.id }
  })
}
