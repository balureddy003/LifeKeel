/**
 * Case Studies Routes — MKT-004: Verified Moment Case Studies
 *
 * GET /case-studies — list published case studies
 * POST /case-studies — submit new case study for review
 * POST /case-studies/:id/approve — approve and publish case study
 *
 * Orphaned-surface decision (remediation item 24): PARKED, not deleted.
 * No shipped UI calls any of these today, but GET /case-studies is on
 * the public open-paths list — a marketing surface like /blog/posts —
 * and the whole file is ~120 lines. Deleting it removes a public-facing
 * endpoint on spec rather than dead code. If the marketing site never
 * renders case studies, delete the file and its open-paths entry
 * together.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'

export async function registerCaseStudyRoutes(app: FastifyInstance, db?: Db): Promise<void> {
  /**
   * GET /case-studies
   * Returns list of published case studies
   */
  app.get('/case-studies', async () => {
    if (!db) {
      return { case_studies: [] }
    }

    try {
      const col = db.collection('case_studies')
      const studies = await col
        .find({ published: true })
        .sort({ created_at: -1 })
        .toArray()

      return { case_studies: studies }
    } catch {
      return { case_studies: [] }
    }
  })

  /**
   * POST /case-studies
   * Body: { company: string, industry: string, outcome: string, workflow: string, evidence: {...} }
   * Submits case study for admin review
   */
  app.post<{
    Body: {
      company: string
      industry: string
      outcome: string
      workflow: string
      evidence: {
        before_value: number
        after_value: number
        unit: string
        confidence: number
      }
    }
  }>('/case-studies', async (req) => {
    const { tenant_id, user_id } = req.authContext
    const { company, industry, outcome, workflow, evidence } = req.body

    if (!db) {
      return { error: 'Database not connected' }
    }

    try {
      const col = db.collection('case_studies')
      const study = {
        id: randomUUID(),
        tenant_id,
        company,
        industry,
        outcome,
        workflow,
        evidence,
        published: false,
        customer_approved: false,
        created_at: new Date(),
        created_by: user_id,
      }

      await col.insertOne(study)
      return { ok: true, study }
    } catch (err) {
      return { error: String(err) }
    }
  })

  /**
   * POST /case-studies/:id/approve
   * Admin-only: approve and publish case study
   */
  app.post<{ Params: { id: string } }>('/case-studies/:id/approve', async (req) => {
    const { id } = req.params

    if (!db) {
      return { error: 'Database not connected' }
    }

    try {
      const col = db.collection('case_studies')
      const result = await col.findOneAndUpdate(
        { id },
        {
          $set: {
            published: true,
            approved_at: new Date(),
            approved_by: req.authContext.user_id,
          },
        },
        { returnDocument: 'after' },
      )

      if (!result) {
        return { error: 'Case study not found' }
      }

      return { ok: true, study: result }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
