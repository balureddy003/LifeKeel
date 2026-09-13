/**
 * Generates a draft outreach message for an insight — Tier 1 "prepare,
 * don't send" (see docs/prd/103-tier1-prepare-actions.md). Text-only, so
 * it goes through the same provider-agnostic LlmFn the rest of the app
 * uses, mirroring apps/api/src/email/classify.ts's classifyEmail shape:
 * pure function, try/catch, no side effects, null on any failure.
 *
 * This file must never import @sendgrid/mail or read SENDGRID_API_KEY —
 * that's the enforced line between this Tier 1 feature (a human copies
 * or opens the draft in their own email client) and Tier 2 (Oak sending
 * on the family's behalf), which this PRD deliberately does not build.
 */

import type { LlmFn } from '@agentoak/platform'

export interface DraftableInsight {
  reasoning: string
  category: string
  detector_id: string
}

const SYSTEM_PROMPT = `You draft short, polite outreach messages for a family finance app called Agent Oak. Given an insight about a gap in a family's insurance or financial coverage, write a brief email body (2-4 sentences) the family could send to their insurer or provider to follow up.

Rules:
- This is a DRAFT ONLY, for a human to review and send themselves. Never claim anything has been sent, scheduled, or already acted upon.
- Do not invent policy numbers, account numbers, or personal details that weren't given to you.
- Sign off generically (e.g. "Thank you,") with no name — the sender will add their own.
- Output only the email body text, no subject line, no commentary.`

export async function generateDraft(llm: LlmFn, insight: DraftableInsight): Promise<string | null> {
  const prompt = `Insight: ${insight.reasoning}\n\nWrite the draft email body.`
  try {
    return await llm(SYSTEM_PROMPT, prompt, 'tier:fast')
  } catch {
    return null
  }
}
