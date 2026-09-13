/**
 * Assistant Routes — grounds the in-app assistant in the tenant's real
 * financial profile and open insights via an LLM, replacing the
 * client-side hardcoded response map previously used by
 * apps/web/src/lib/api.ts's fetchAIResponse. See docs/prd/101-live-ai-assistant.md.
 *
 * POST /assistant/ask — ask a question, get a grounded, informational-only
 * answer. Never throws to the client: any LLM failure (no provider
 * configured, bad key, rate limit, network) degrades to a graceful,
 * honest fallback with isLive: false rather than a 500.
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLlmRouterFromEnv, getTenantCollection, type LlmFn } from '@agentoak/platform'
import { getInsightsCollection } from '../db.js'

const AskSchema = z.object({
  query: z.string().min(1).max(2000),
})

const SYSTEM_PROMPT = `You are Oak, the assistant inside Agent Oak — a family's financial digital twin. Answer the family's question using ONLY the data provided below.

Rules:
- Never give definitive financial, investment, tax, or legal advice. Always frame guidance as informational and recommend consulting a licensed professional for decisions.
- If the provided data doesn't answer the question, say so honestly rather than guessing or inventing numbers.
- Be concise and specific — reference the family's actual figures where relevant instead of generic advice.
- Do not suggest Oak can take any action on the family's behalf (send money, contact anyone, file anything) — Oak only explains and summarizes.`

const FALLBACK_CONTENT = "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?"

interface FinancialProfileDoc extends Record<string, unknown> {
  household?: {
    employment_status?: string
    monthly_salary_minor?: number
    annual_living_expenses_minor?: number
    mortgage_outstanding_minor?: number
    life_cover_minor?: number
    income_protection_monthly_minor?: number
  }
  emergency_fund?: {
    emergency_savings_minor?: number
    monthly_expenses_minor?: number
    has_high_interest_debt?: boolean
  }
  retirement?: {
    current_age?: number
    target_retirement_age?: number
    pension_balance_minor?: number
    monthly_contribution_minor?: number
    target_retirement_income_minor?: number
  }
  education_funds?: Array<{
    child_name?: string
    child_age?: number
    current_savings_minor?: number
    target_savings_minor?: number
    years_remaining?: number
  }>
}

function toMajor(minor: number | undefined): string {
  return typeof minor === 'number' ? (minor / 100).toFixed(2) : 'not provided'
}

function buildContext(profile: FinancialProfileDoc | null, insights: Array<{ reasoning: string; category: string; detector_id: string }>): string {
  const parts: string[] = []

  if (!profile) {
    parts.push('No financial profile has been submitted yet.')
  } else {
    const h = profile.household
    const ef = profile.emergency_fund
    const r = profile.retirement
    if (h) {
      parts.push(
        `Household: employment status ${h.employment_status ?? 'unknown'}, monthly salary £${toMajor(h.monthly_salary_minor)}, ` +
        `annual living expenses £${toMajor(h.annual_living_expenses_minor)}, mortgage outstanding £${toMajor(h.mortgage_outstanding_minor)}, ` +
        `life insurance cover £${toMajor(h.life_cover_minor)}, income protection £${toMajor(h.income_protection_monthly_minor)}/month.`,
      )
    }
    if (ef) {
      parts.push(
        `Emergency fund: £${toMajor(ef.emergency_savings_minor)} saved against £${toMajor(ef.monthly_expenses_minor)}/month expenses. ` +
        `High-interest debt: ${ef.has_high_interest_debt ? 'yes' : 'no'}.`,
      )
    }
    if (r) {
      parts.push(
        `Retirement: currently age ${r.current_age ?? 'unknown'}, targeting retirement at ${r.target_retirement_age ?? 'unknown'}, ` +
        `pension balance £${toMajor(r.pension_balance_minor)}, contributing £${toMajor(r.monthly_contribution_minor)}/month, ` +
        `target retirement income £${toMajor(r.target_retirement_income_minor)}/year.`,
      )
    }
    for (const fund of profile.education_funds ?? []) {
      parts.push(
        `Education fund for ${fund.child_name ?? 'a child'} (age ${fund.child_age ?? 'unknown'}): ` +
        `£${toMajor(fund.current_savings_minor)} saved against a £${toMajor(fund.target_savings_minor)} target, ` +
        `${fund.years_remaining ?? 'unknown'} years remaining.`,
      )
    }
  }

  if (insights.length === 0) {
    parts.push('No open insights currently identified.')
  } else {
    parts.push('Open insights Oak has already identified for this family:')
    for (const insight of insights) {
      parts.push(`- [${insight.category}/${insight.detector_id}] ${insight.reasoning}`)
    }
  }

  return parts.join('\n')
}

export function registerAssistantRoutes(app: FastifyInstance, db: Db): void {
  const llmFn: LlmFn = createLlmRouterFromEnv()

  app.post<{ Body: { query?: string } }>(
    '/assistant/ask',
    // OAK-015: this route calls an LLM on every request — the shared
    // global rate limit (100/min per tenant in cloud mode) was the only
    // ceiling on it, same as any plain CRUD route. A tighter, dedicated
    // limit bounds LLM spend/abuse specifically on the routes that
    // actually invoke one.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = AskSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      }
      const { tenant_id } = req.authContext
      const { query } = parsed.data

      const [profileDoc, insightDocs] = await Promise.all([
        getTenantCollection<FinancialProfileDoc>(db, 'family_financial_profile', tenant_id).findOne({}),
        getInsightsCollection().then((col) =>
          col
            .find({ tenant_id, state: { $in: ['identified', 'sent'] } })
            .sort({ created_at: -1 })
            .limit(10)
            .toArray(),
        ),
      ])

      const context = buildContext(
        profileDoc,
        insightDocs.map((i) => ({ reasoning: i.reasoning, category: i.category, detector_id: i.detector_id })),
      )
      const prompt = `Family data:\n${context}\n\nQuestion: ${query}`

      try {
        const content = await llmFn(SYSTEM_PROMPT, prompt, 'tier:fast')
        return reply.send({ content, isLive: true })
      } catch (err) {
        req.log.warn({ err }, 'Assistant LLM call failed — falling back')
        return reply.send({ content: FALLBACK_CONTENT, isLive: false })
      }
    },
  )
}
