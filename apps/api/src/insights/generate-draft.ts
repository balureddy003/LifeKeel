/**
 * Generates a draft outreach message for an insight — Tier 1 "prepare,
 * don't send" (see docs/prd/103-tier1-prepare-actions.md). Text-only, so
 * it goes through the same provider-agnostic LlmFn the rest of the app
 * uses, mirroring apps/api/src/email/classify.ts's classifyEmail shape:
 * pure function, try/catch, no side effects, null on any failure.
 *
 * This file must never import @sendgrid/mail or read SENDGRID_API_KEY —
 * that's the enforced line between this Tier 1 feature (a human copies
 * or opens the draft in their own email client) and Tier 2 (Keel sending
 * on the family's behalf), which this PRD deliberately does not build.
 */

import type { LlmFn } from '@lifekeel/platform'

export interface DraftableInsight {
  reasoning: string
  category: string
  detector_id: string
}

const SYSTEM_PROMPT = `You draft short, polite outreach messages for a family finance app called LifeKeel. Given an insight about a gap in a family's insurance or financial coverage, write a brief email body (2-4 sentences) the family could send to their insurer or provider to follow up.

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

// Extends Tier 1 "prepare" to a life-event playbook step that has no one to
// email (e.g. "Review your budget", "Check eligibility for unemployment
// benefits") — these previously had no prepare affordance at all, since
// generateDraft()'s prompt only makes sense for a contact-eligible step.
// Same guarantees, different shape: a short starting-point note instead of
// an outreach email, still never claiming anything has been done.
const PREP_NOTE_SYSTEM_PROMPT = `You help a family get started on one item in their financial crisis checklist, for an app called LifeKeel. Given the step's title and its already-personalized description (which may already include the family's real numbers), write a short, concrete starting-point note (3-5 sentences, plain prose or a short list) that helps them actually begin this step right now.

Rules:
- This is a STARTING POINT for the family to act on themselves. Never claim anything has been checked, filed, contacted, or completed on their behalf.
- Only use numbers or facts already given in the step description — never invent figures, eligibility rules, account details, or deadlines.
- Never recommend, compare, or name a specific product or provider to switch to.
- Output only the note itself, no heading, no commentary.`

export interface DraftablePlaybookStep {
  title: string
  body: string
}

export async function generatePrepNote(llm: LlmFn, step: DraftablePlaybookStep): Promise<string | null> {
  const prompt = `Checklist step: ${step.title}\n${step.body}\n\nWrite the starting-point note.`
  try {
    return await llm(PREP_NOTE_SYSTEM_PROMPT, prompt, 'tier:fast')
  } catch {
    return null
  }
}
