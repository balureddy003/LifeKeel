/**
 * Claim packet (PRD-235, Intent 86) — Tier 1, prepare-only.
 *
 * For one policy type first (life): assembles the insurer's claims contact
 * as printed on the policy, the policy number, the policyholder's details,
 * and a checklist of papers the household has on file or has not located —
 * plus a fixed-template draft notification the household reviews and sends
 * itself. Nothing is sent; no ActionExecutor; no model call — the packet is
 * built from the record and a fixed template only.
 *
 * The insurer's own claim pack is the authority: requirements vary, and
 * LifeKeel states no terms it has not read. Gaps are shown as gaps.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getAuditLogger } from '../audit/audit-log.js'
import { isFamilyAdult } from '../family/family-permissions.js'
import type { FamilyGroupDoc } from './family-group.js'

interface PolicyRecord {
  id?: string
  type: string
  provider: string
  policy_number?: string
  member_id?: string
  contact_phone?: string
  contact_email?: string
  nomination?: { provider_form_url?: string; nominated_label?: string }
}

/**
 * Strict matching: a false "on file" for a bereaved household is worse than
 * a pessimistic "not located". The policy document only counts when the
 * name ties to this policy's provider or reads like a life-policy doc; the
 * claim form only counts when it says claim *form/pack*.
 */
const CHECKLIST: ReadonlyArray<{ item: string; match: RegExp }> = [
  { item: 'Death certificate (original or certified copy)', match: /death certificate/i },
  { item: "The insurer's own claim form or claim pack", match: /claim[ _-]?(form|pack)/i },
  {
    item: 'Proof of identity for the claimant (passport or driving licence)',
    match: /passport|driving licen/i,
  },
  {
    item: 'Grant of probate or letters of administration (often needed when the policy is not in trust — the insurer decides)',
    match: /probate|letters of administration|grant of probate/i,
  },
]

/** The only draft the packet produces — fixed text, facts filled, nothing sent. */
function draftNotification(provider: string, holder: string, policyNumber: string | null): string {
  return [
    `To the claims team at ${provider},`,
    '',
    `I am writing to notify a claim on the life policy held by ${holder}.`,
    `Policy number: ${policyNumber ?? 'not on file'}.`,
    'The policyholder died on [date].',
    '',
    'Please send your claim pack and confirm what you need from us.',
    '',
    '[Your name], on behalf of the household',
  ].join('\n')
}

export function registerClaimPacketRoutes(app: FastifyInstance, db: Db) {
  app.post<{ Params: { index: string } }>(
    '/family/policies/:index/claim-packet',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
        return reply.code(401).send({ error: 'Adults only' })
      const ref = req.params.index
      const profile = await db
        .collection('family_financial_profile')
        .findOne({ tenant_id: ctx.tenant_id })
      const policies = (profile?.['policies'] as PolicyRecord[] | undefined) ?? []
      // Stable id preferred; numeric index kept for records without one.
      const p = ref.startsWith('pol_')
        ? policies.find((x) => x.id === ref)
        : policies[Number.parseInt(ref, 10)]
      if (!p) return reply.code(404).send({ error: 'Policy not found' })
      if (p.type !== 'life')
        return reply.code(400).send({ error: 'Claim packets are available for life policies' })

      const group = await db
        .collection<FamilyGroupDoc>('family_groups')
        .findOne({ tenant_id: ctx.tenant_id })
      const holder = group?.members.find((m) => m.id === p.member_id)?.name ?? 'the household'

      const docs = await db
        .collection('documents')
        .find({ tenant_id: ctx.tenant_id })
        .project({ title: 1, filename: 1, name: 1 })
        .limit(50)
        .toArray()
      const docName = (d: Record<string, unknown>) =>
        String(d['title'] ?? d['name'] ?? d['filename'] ?? '')
      const providerRe = new RegExp(
        `${p.provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*(polic|life|cover)|(polic|life|cover).*${p.provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      )
      const checklist = [{ item: 'The policy document', match: providerRe }, ...CHECKLIST].map(
        ({ item, match }) => {
          const hit = docs.find((d) => match.test(docName(d)))
          return hit
            ? { item, on_file: true, located: `In LifeKeel documents — ${docName(hit)}` }
            : { item, on_file: false, located: null }
        },
      )

      const gaps: string[] = []
      if (!p.policy_number) gaps.push('Policy number not on file')
      if (!p.contact_phone && !p.contact_email) gaps.push('Claims contact not on file')
      for (const c of checklist) if (!c.on_file) gaps.push(`${c.item}: not located`)

      await getAuditLogger()?.fromRequest(
        req,
        'claim_packet.assembled',
        'family_financial_profile',
        `policy_${ref}`,
        {},
      )
      return {
        packet: {
          provider: p.provider,
          type: p.type,
          holder,
          contact: { phone: p.contact_phone ?? null, email: p.contact_email ?? null },
          policy_number: p.policy_number ?? null,
          nomination: p.nomination?.nominated_label ?? null,
          provider_form_url: p.nomination?.provider_form_url ?? null,
          checklist,
          gaps,
          authority_note:
            "The insurer's own claim pack is the authority — requirements differ by insurer.",
          draft_notification: draftNotification(p.provider, holder, p.policy_number ?? null),
        },
      }
    },
  )
}
