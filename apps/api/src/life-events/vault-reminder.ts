/**
 * Crisis-release re-scope (see /Users/balu/.claude/plans/snazzy-skipping-locket.md
 * for the full design rationale) — deliberately NOT an autonomous release.
 * apps/api/src/lib/family-permissions.ts's isFamilyAdult already grants
 * every adult family member standing access to the Digital Estate Vault
 * (apps/api/src/routes/vault.ts); there is no locked state for a "crisis"
 * to unlock. The real gap this closes is awareness, not access: when a
 * family member reports a bereavement, disability, or medical event, the
 * other adults are reminded the vault exists and has documents, via email
 * and an in-app insight. No token, no countdown, no change to who can see
 * what — this never grants any access it wasn't already true that the
 * recipient had.
 *
 * ARCHITECTURE.md's own trust-tier model (Tier 3: "a reminder, a calendar
 * hold, a family notification... Money, legal, and medical actions do not
 * belong at Tier 3... possibly ever") is exactly why this stops at a
 * notification and goes no further.
 */

import { randomUUID } from 'node:crypto'
import sgMail from '@sendgrid/mail'
import type { Db } from 'mongodb'
import type { Insight } from '@agentoak/engine'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import { memberMatchesUser } from '../lib/family-permissions.js'
import type { LifeEventType } from './render-playbook.js'

const log = createLogger({ service: 'vault-reminder', version: '0.0.0' })

// Only these three carry a real chance the organizer can't act — job loss,
// a car accident, or property damage don't imply anyone is unreachable.
const VAULT_REMINDER_EVENT_TYPES = new Set<LifeEventType>(['bereavement', 'disability', 'medical'])

const DETECTOR_ID = 'family_vault_reminder'
const RULE_ID = 'life_event_vault_reminder'

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'accounts@kairos.dev'
}

async function sendVaultReminderEmail(
  to: string,
  recipientName: string,
  reporterName: string,
  playbookTitle: string,
  docCount: number,
): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to }, 'No SENDGRID_API_KEY — skipping vault reminder email')
    return
  }
  sgMail.setApiKey(apiKey)
  const firstName = recipientName.split(' ')[0] || 'there'
  const docWord = docCount === 1 ? 'document' : 'documents'

  try {
    await sgMail.send({
      to,
      from: { email: getFromEmail(), name: 'Agent Oak' },
      subject: "Your family's Digital Estate Vault",
      text: `Hi ${firstName},\n\n${reporterName} reported: ${playbookTitle}.\n\nYour family's Digital Estate Vault has ${docCount} ${docWord} on file. Sign in any time to view them.\n\nOak never opens, shares, or releases these on its own — a family member always has to sign in and choose to view one.`,
      html: `
        <p>Hi ${firstName},</p>
        <p>${reporterName} reported: <strong>${playbookTitle}</strong>.</p>
        <p>Your family's Digital Estate Vault has ${docCount} ${docWord} on file. Sign in any time to view them.</p>
        <p style="color:#888;font-size:13px;">Oak never opens, shares, or releases these on its own — a family member always has to sign in and choose to view one.</p>
      `,
    })
    log.info({ to }, 'Vault reminder email sent')
  } catch (err) {
    log.error({ to, err }, 'Failed to send vault reminder email')
  }
}

/**
 * Called after a life event is persisted. No-ops (no email, no insight)
 * unless: the event type is one of the three above, the vault actually
 * has at least one document, and there isn't already an open (un-dismissed)
 * reminder for this tenant — each life-event report gets its own new id
 * (crypto.randomUUID(), no natural dedup key), so without this a family
 * that reports twice in a row (a double-tap, or a second real event before
 * dismissing the first reminder) would get emailed twice for no new
 * information. The guard clears itself the same way any other insight
 * does — once dismissed/resolved, the next qualifying report sends again.
 */
export async function maybeSendVaultReminder(
  db: Db,
  tenantId: string,
  eventType: LifeEventType,
  eventId: string,
  reporterUserId: string,
  playbookTitle: string,
): Promise<void> {
  if (!VAULT_REMINDER_EVENT_TYPES.has(eventType)) return

  const documents = getTenantCollection<Record<string, unknown>>(db, 'documents', tenantId)
  const vaultDocCount = await documents.countDocuments({ category: 'estate_vault' })
  if (vaultDocCount === 0) return

  const alreadyOpen = await db.collection<Insight>('insights').findOne({
    tenant_id: tenantId,
    detector_id: DETECTOR_ID,
    state: { $in: ['identified', 'sent'] },
  })
  if (alreadyOpen) return

  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  if (!family) return
  const reporter = family.members.find((m) => memberMatchesUser(m, reporterUserId))
  const reporterName = reporter?.name ?? 'A family member'
  const otherAdults = family.members.filter((m) => !memberMatchesUser(m, reporterUserId) && m.role !== 'child' && m.status === 'active')
  if (otherAdults.length === 0) return

  await Promise.all(
    otherAdults.map((adult) =>
      sendVaultReminderEmail(adult.email, adult.name, reporterName, playbookTitle, vaultDocCount).catch((err) =>
        log.error({ err, to: adult.email }, 'Vault reminder send threw'),
      ),
    ),
  )

  const insight: Insight = {
    id: randomUUID(),
    tenant_id: tenantId,
    hypothesis: 'Digital Estate Vault reminder',
    category: 'experience',
    urgency: 'medium',
    estimated_impact_low: 0,
    estimated_impact_high: 0,
    reasoning: `${reporterName} reported: ${playbookTitle}. Your family's Digital Estate Vault has ${vaultDocCount} ${vaultDocCount === 1 ? 'document' : 'documents'} on file — sign in any time to view them. Oak never opens, shares, or releases these on its own.`,
    actions: ['Open the Digital Estate Vault'],
    confidence_breakdown: {
      or_score: 1,
      combined_score: 1,
      model_version: 'system@1',
      evidence_refs: [`life_event:${eventId}`],
    },
    detector_id: DETECTOR_ID,
    rule_id: RULE_ID,
    state: 'identified',
    created_at: new Date(),
    derived_from_signals: [],
    entity_key: eventId,
    feature_snapshot: {
      life_event_id: eventId,
      event_type: eventType,
      vault_document_count: vaultDocCount,
    },
  }
  await db.collection<Insight>('insights').insertOne(insight)
}
