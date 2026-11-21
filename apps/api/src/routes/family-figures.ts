/**
 * Save the figures a brief is built on onto the family list: POST /family/financial-profile/figures.
 * One confirmation writes savings, monthly spending, monthly income and income protection into the same
 * profile the estimate, the pinned tiles and the checks already read, so a figure typed once is used
 * everywhere and there is no second store.
 *
 * Access: household editors only (`isHouseholdEditor`). Tier 0: it writes only what the household typed
 * and confirmed, makes no model call and sends nothing out. Works with no profile on file (upsert) and
 * touches nothing but the fields it was sent. It does not run the full insight pass: that needs a whole
 * profile, and the daily check picks the figures up.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getTenantCollection } from '@lifekeel/platform'
import { isHouseholdEditor } from '../family/family-permissions.js'
import { MAX_MINOR } from './family-financial-profile.js'

interface FigureField {
  label: string
  section: 'household' | 'emergency_fund'
  field: string
  /** Zero is a real answer here (no savings, no income protection), nowhere else. */
  allowZero: boolean
}

const FIGURES: Record<string, FigureField> = {
  savings_minor: {
    label: 'Savings',
    section: 'emergency_fund',
    field: 'emergency_savings_minor',
    allowZero: true,
  },
  monthly_spend_minor: {
    label: 'Monthly spending',
    section: 'emergency_fund',
    field: 'monthly_expenses_minor',
    allowZero: false,
  },
  monthly_inflow_minor: {
    label: 'Monthly income',
    section: 'household',
    field: 'monthly_salary_minor',
    allowZero: false,
  },
  income_protection_monthly_minor: {
    label: 'Income protection per month',
    section: 'household',
    field: 'income_protection_monthly_minor',
    allowZero: true,
  },
}

const money = z.number().int().nonnegative().max(MAX_MINOR)
const positive = money.refine((n) => n > 0, 'must be more than zero')

const Body = z
  .object({
    savings_minor: money.optional(),
    monthly_spend_minor: positive.optional(),
    monthly_inflow_minor: positive.optional(),
    income_protection_monthly_minor: money.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to save')

type Profile = Record<string, Record<string, unknown> | undefined> | null

export function registerFamilyFiguresRoutes(app: FastifyInstance, db: Db): void {
  app.post('/family/financial-profile/figures', async (req, reply) => {
    const { tenant_id, user_id, roles } = req.authContext
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.status(403).send({ error: 'Only household editors can save figures' })
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid figures' })

    const col = getTenantCollection<Record<string, unknown>>(
      db,
      'family_financial_profile',
      tenant_id,
    )
    const current = (await col.findOne({})) as Profile
    const saved: { key: string; label: string; before: number | null; after: number }[] = []
    const unchanged: { key: string; label: string; value: number }[] = []
    const $set: Record<string, unknown> = {}

    for (const [key, after] of Object.entries(parsed.data)) {
      const f = FIGURES[key]
      if (!f || after === undefined) continue
      const raw = current?.[f.section]?.[f.field]
      const before = typeof raw === 'number' ? raw : null
      if (before === after) {
        unchanged.push({ key, label: f.label, value: after })
        continue
      }
      $set[`${f.section}.${f.field}`] = after
      saved.push({ key, label: f.label, before, after })
    }

    if (saved.length > 0) {
      await col.updateOne(
        {},
        { $set: { ...$set, updated_at: new Date() }, $inc: { version: 1 } },
        { upsert: true },
      )
    }
    return { saved, unchanged }
  })
}
