/**
 * Classifies and summarizes a single email for the Inbox — is this a
 * financial notification worth surfacing (bill, renewal, statement, price
 * change), and if so, what's the one-line summary and suggested action?
 * Text-only, so it goes through the same provider-agnostic LlmFn the rest
 * of the app uses (createLlmRouterFromEnv) rather than the vision-specific
 * client extract.ts needs for document images.
 */

import type { LlmFn } from '@kairos/platform'
import type { FetchedEmail } from './imap-client.js'

export interface EmailClassification {
  isFinancial: boolean
  summary: string
  actionLabel: string
  actionType: 'review' | 'renew' | 'compare' | 'update' | 'info'
  priority: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are a financial-email triage assistant for a family finance app. Given an email's sender, subject, and body snippet, decide whether it's financially relevant to a household's personal/consumer finances.

Financially relevant (is_financial: true): bills and invoices, insurance renewals or claims, bank/investment/pension statements, an actual charge or payment confirmation (a subscription charge counts here even if the service is a developer tool or business SaaS, as long as it's billing a personal card/account — e.g. "your card was charged $20 for X" IS financial), price or interest-rate changes on a personal account, tax notices, mortgage or loan updates.

NOT financially relevant (is_financial: false), even if the email mentions cost, charges, limits, or billing:
- Newsletters, marketing, social notifications
- Operational/usage alerts that only warn a charge COULD happen, without being a charge themselves — database connection limits, API rate limits, storage quotas, "usage nearing your plan limit," server/uptime alerts. The test: did money actually move, or is this describing system capacity? A sentence like "could impact service or lead to extra charges" inside a capacity warning is still just a capacity warning, not a charge.
- Any other work/business notification with no real household money attached to it

Return ONLY a JSON object with this exact shape:
{"is_financial": boolean, "summary": "<one sentence, plain language>", "action_label": "<a short 2-4 word action, e.g. 'Review coverage'>", "action_type": "review"|"renew"|"compare"|"update"|"info", "priority": "high"|"medium"|"low"}

If not financially relevant, return {"is_financial": false, "summary": "", "action_label": "", "action_type": "info", "priority": "low"}.`

const VALID_ACTION_TYPES = new Set(['review', 'renew', 'compare', 'update', 'info'])
const VALID_PRIORITIES = new Set(['high', 'medium', 'low'])

export async function classifyEmail(llm: LlmFn, email: FetchedEmail): Promise<EmailClassification> {
  const prompt = `From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date.toISOString()}\n\nBody:\n${email.textSnippet}`

  try {
    const response = await llm(SYSTEM_PROMPT, prompt, 'tier:fast')
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { isFinancial: false, summary: '', actionLabel: '', actionType: 'info', priority: 'low' }

    const parsed = JSON.parse(jsonMatch[0]) as {
      is_financial?: boolean
      summary?: string
      action_label?: string
      action_type?: string
      priority?: string
    }

    const actionType = VALID_ACTION_TYPES.has(parsed.action_type ?? '') ? (parsed.action_type as EmailClassification['actionType']) : 'info'
    const priority = VALID_PRIORITIES.has(parsed.priority ?? '') ? (parsed.priority as EmailClassification['priority']) : 'low'

    return {
      isFinancial: Boolean(parsed.is_financial),
      summary: parsed.summary ?? '',
      actionLabel: parsed.action_label ?? '',
      actionType,
      priority,
    }
  } catch {
    return { isFinancial: false, summary: '', actionLabel: '', actionType: 'info', priority: 'low' }
  }
}
