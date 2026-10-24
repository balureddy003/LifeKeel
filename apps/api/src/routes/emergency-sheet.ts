/**
 * POST /family/emergency-sheet/preview — PRD-220.
 *
 * Builds the owner's emergency sheet deterministically from their own on-file
 * records. Hard rules, by construction:
 *   - every section is opt-in; sections not named in the request are absent
 *     from the response (default is everything off);
 *   - nothing is persisted, cached or logged beyond a content-free audit
 *     event — the owner gets a document to send, never a hosted URL;
 *   - tenant-scoped reads only; minors' details require the explicit
 *     'children' section.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'

export const SHEET_SECTIONS = [
  'who_to_call',
  'key_papers',
  'accounts',
  'policies',
  'balances',
  'children',
] as const
export type SheetSection = (typeof SHEET_SECTIONS)[number]

const BodySchema = z.object({ sections: z.array(z.enum(SHEET_SECTIONS)).max(6) })

interface SheetItem {
  label: string
  detail?: string
}

export async function registerEmergencySheetRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/family/emergency-sheet/preview', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const want = new Set<SheetSection>(parsed.data.sections)

    const out: { id: SheetSection; title: string; items: SheetItem[] }[] = []

    if (want.has('who_to_call')) {
      const contacts = await db
        .collection('legacy_contacts')
        .find({ tenant_id })
        .project({ name: 1, email: 1, phone: 1, role: 1 })
        .toArray()
      out.push({
        id: 'who_to_call',
        title: 'Who to call',
        items: contacts.map((c) => ({
          label: String(c['name'] ?? ''),
          detail:
            [c['role'], c['phone'], c['email']].filter(Boolean).map(String).join(' · ') ||
            undefined,
        })),
      })
    }

    if (want.has('key_papers')) {
      const docs = await db
        .collection('documents')
        .find({ tenant_id })
        .project({ title: 1, filename: 1, name: 1 })
        .limit(50)
        .toArray()
      out.push({
        id: 'key_papers',
        title: 'Where the key papers are',
        items: docs.map((d) => ({
          label: String(d['title'] ?? d['name'] ?? d['filename'] ?? 'Document'),
          detail: 'In LifeKeel documents',
        })),
      })
    }

    if (want.has('accounts') || want.has('policies') || want.has('balances')) {
      const profile = await db.collection('family_financial_profile').findOne({ tenant_id })
      const policies = (profile?.['policies'] as Record<string, unknown>[] | undefined) ?? []
      const assets = await db
        .collection('family_assets')
        .find({ tenant_id })
        .project({ name: 1, kind: 1, institution: 1, balance: 1, current_value: 1 })
        .limit(50)
        .toArray()
      if (want.has('accounts')) {
        out.push({
          id: 'accounts',
          title: 'Accounts',
          items: assets.map((a) => ({
            label: String(a['name'] ?? a['institution'] ?? a['kind'] ?? 'Account'),
            detail: want.has('balances')
              ? String(a['balance'] ?? a['current_value'] ?? '') || undefined
              : [a['institution'], a['kind']].filter(Boolean).map(String).join(' · ') || undefined,
          })),
        })
      }
      if (want.has('policies')) {
        out.push({
          id: 'policies',
          title: 'Cover on file',
          items: policies.map((p) => ({
            label: String(p['provider'] ?? p['type'] ?? 'Policy'),
            detail:
              [p['type'], p['renewal_date'] && `renews ${p['renewal_date']}`]
                .filter(Boolean)
                .map(String)
                .join(' · ') || undefined,
          })),
        })
      }
    }

    // Content-free audit: which sections were asked for, never the content.
    getAuditLogger()?.log({
      tenant_id,
      user_id,
      action: 'family.emergency_sheet_generated',
      resource_type: 'emergency_sheet',
      resource_id: tenant_id,
      metadata: { sections: [...want] },
      ip: '',
      user_agent: '',
      timestamp: new Date(),
    })

    return reply.header('Cache-Control', 'no-store').send({ sections: out })
  })
}
