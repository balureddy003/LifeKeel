/**
 * Tier 3 (ARCHITECTURE.md: "a reminder, a calendar hold, a family
 * notification... reversible/low-stakes") — the only other example of this
 * tier shipped anywhere is vault-reminder.ts, which this deliberately
 * mirrors in shape (trigger gate → dedupe check → email send, individually
 * .catch()-guarded → an informational Insight record). It deliberately
 * narrows one part of that shape: vault-reminder notifies every other
 * adult, but nudging someone about their own unfinished to-do list is
 * uncontroversial in a way that notifying a partner about it isn't — this
 * reminder goes to the reporting user only.
 *
 * Runs as a daily cron sweep (registered in server.ts) rather than inline
 * after a life event is reported — the trigger is time passing with steps
 * still unchecked, which vault-reminder's "did this just happen" shape has
 * no way to express.
 */

import sgMail from '@sendgrid/mail'
import type { Db } from 'mongodb'
import type { Insight } from '@agentoak/engine'
import { randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { getSignalsCollection } from '../db.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import { memberMatchesUser } from '../lib/family-permissions.js'
import { renderPlaybook, type LifeEventType } from './render-playbook.js'
import type { FinancialProfile } from '../routes/family-financial-profile.js'

const log = createLogger({ service: 'checklist-reminder', version: '0.0.0' })

// Same three event types vault-reminder treats as carrying a real chance
// the organizer can't act alone — job loss, a car accident, or property
// damage don't leave someone with a multi-step response plan they might
// forget about for days.
const CHECKLIST_REMINDER_EVENT_TYPES = new Set<LifeEventType>(['bereavement', 'disability', 'medical'])

const REMINDER_DELAY_DAYS = 3
const DETECTOR_ID = 'family_checklist_reminder'
const RULE_ID = 'life_event_checklist_stalled'

interface LifeEventSignalDoc {
  id: string
  tenant_id: string
  signal_type: string
  data: {
    event_type: LifeEventType
    affected_member_id?: string
    reported_at: string
    reported_by_user_id?: string
    completed_step_ids?: string[]
    checklist_reminder_sent?: boolean
  }
  created_at: Date
}

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'accounts@agentoak.ai'
}

async function sendChecklistReminderEmail(
  to: string,
  recipientName: string,
  playbookTitle: string,
  remainingCount: number,
): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping checklist reminder email')
    return
  }
  sgMail.setApiKey(apiKey)
  const firstName = recipientName.split(' ')[0] || 'there'
  const stepWord = remainingCount === 1 ? 'step' : 'steps'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Agent Oak' },
      subject: `Your ${playbookTitle} checklist`,
      text: `Hi ${firstName},\n\nA few days ago you reported: ${playbookTitle}. ${remainingCount} ${stepWord} on that response plan are still unchecked.\n\nSign in any time to pick back up — no rush, this is just a reminder it's still there.`,
      html: `
        <p>Hi ${firstName},</p>
        <p>A few days ago you reported: <strong>${playbookTitle}</strong>. ${remainingCount} ${stepWord} on that response plan are still unchecked.</p>
        <p style="color:#888;font-size:13px;">Sign in any time to pick back up — no rush, this is just a reminder it's still there.</p>
      `,
    })
    log.info({ to }, 'Checklist reminder email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send checklist reminder email')
  }
}

/**
 * Evaluates one life-event signal doc and sends its reminder if due.
 * Marks `checklist_reminder_sent` in every terminal case (sent, nothing
 * left to nudge about, no reporter found) so the sweep never re-evaluates
 * it — "one send per event ever", exactly like vault-reminder's open-
 * insight dedupe, just keyed on the event doc itself since there's no
 * natural insight to check the state of before the email goes out.
 */
async function maybeSendChecklistReminder(db: Db, doc: LifeEventSignalDoc): Promise<boolean> {
  const { tenant_id, id, data } = doc
  const signals = await getSignalsCollection()
  const markDone = () =>
    signals.updateOne(
      { tenant_id, signal_type: 'family.life_event', id },
      { $set: { 'data.checklist_reminder_sent': true } },
    )

  const profileCol = getTenantCollection<FinancialProfile & { tenant_id: string }>(db, 'family_financial_profile', tenant_id)
  const profile = await profileCol.findOne({})
  if (!profile) {
    await markDone()
    return false
  }

  const playbook = renderPlaybook(data.event_type, profile, data.affected_member_id)
  const completed = new Set(data.completed_step_ids ?? [])
  const remaining = playbook.steps.filter((s) => !completed.has(s.id))
  if (remaining.length === 0) {
    await markDone()
    return false
  }

  if (!data.reported_by_user_id) {
    // No reporter on file (an event reported before this field existed) —
    // nothing to notify and no other adult to fall back to, per the
    // reporter-only design above.
    await markDone()
    return false
  }

  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id })
  const reporter = family?.members.find((m) => memberMatchesUser(m, data.reported_by_user_id!))
  if (!reporter) {
    await markDone()
    return false
  }

  await sendChecklistReminderEmail(reporter.email, reporter.name, playbook.title, remaining.length).catch((err) =>
    log.error({ err, to: reporter.email }, 'Checklist reminder send threw'),
  )

  const insight: Insight = {
    id: randomUUID(),
    tenant_id,
    hypothesis: 'Response plan checklist reminder',
    category: 'experience',
    urgency: 'low',
    estimated_impact_low: 0,
    estimated_impact_high: 0,
    reasoning: `You reported ${playbook.title} a few days ago and ${remaining.length} ${remaining.length === 1 ? 'step' : 'steps'} on the response plan ${remaining.length === 1 ? 'is' : 'are'} still unchecked. This is just a reminder it's still there.`,
    actions: ['Open the response plan'],
    confidence_breakdown: {
      or_score: 1,
      combined_score: 1,
      model_version: 'system@1',
      evidence_refs: [`life_event:${id}`],
    },
    detector_id: DETECTOR_ID,
    rule_id: RULE_ID,
    state: 'identified',
    created_at: new Date(),
    derived_from_signals: [],
    entity_key: id,
    feature_snapshot: {
      life_event_id: id,
      event_type: data.event_type,
      remaining_step_count: remaining.length,
    },
  }
  await db.collection<Insight>('insights').insertOne(insight)
  await markDone()
  return true
}

/**
 * Cron entry point (see server.ts). `signals` is one global collection
 * keyed by tenant_id, not per-tenant like family_financial_profile — so a
 * single query finds every qualifying event across every tenant in one
 * pass, the same way email-scan.ts's scanAllConnectedInboxes iterates all
 * connected mailboxes without a separate "list tenants" step.
 */
export async function runChecklistReminderSweep(db: Db): Promise<number> {
  const signals = await getSignalsCollection()
  const cutoff = new Date(Date.now() - REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000)

  const candidates = (await signals
    .find({
      signal_type: 'family.life_event',
      'data.event_type': { $in: [...CHECKLIST_REMINDER_EVENT_TYPES] },
      created_at: { $lte: cutoff },
      'data.checklist_reminder_sent': { $ne: true },
    })
    .toArray()) as unknown as LifeEventSignalDoc[]

  let sent = 0
  for (const doc of candidates) {
    if (await maybeSendChecklistReminder(db, doc)) sent++
  }
  return sent
}
