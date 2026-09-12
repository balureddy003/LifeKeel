/**
 * Reports Routes — ROI Report Export (UX-007)
 *
 * POST /reports/roi — generate ROI report as PDF or shareable link
 * Returns board-ready PDF with headline impact, top workflows, causal confidence
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'

export async function registerReportRoutes(app: FastifyInstance, db?: Db): Promise<void> {
  /**
   * POST /reports/roi
   * Body: { goal_id?: string, workflow_id?: string, days: number }
   * Returns: PDF buffer or shareable link
   */
  app.post<{
    Body: {
      goal_id?: string
      workflow_id?: string
      days?: number
    }
  }>('/reports/roi', async (req) => {
    const { tenant_id } = req.authContext
    const { goal_id, workflow_id, days = 30 } = req.body

    if (!db) {
      return { error: 'Database not connected' }
    }

    try {
      // Fetch attribution data
      const attributionCol = db.collection('attribution')
      const summary = await attributionCol.findOne({ tenant_id })

      // Fetch goal data if specified
      let goal = null
      if (goal_id) {
        const goalsCol = db.collection('goals')
        goal = await goalsCol.findOne({ id: goal_id, tenant_id })
      }

      // Fetch workflow data if specified
      let workflow = null
      if (workflow_id) {
        const workflowsCol = db.collection('workflows')
        workflow = await workflowsCol.findOne({ id: workflow_id, tenant_id })
      }

      // Calculate report data
      const totalValue = summary?.['total_value_minor_units'] ?? 0
      const totalRuns = summary?.['total_runs'] ?? 0
      const currency = summary?.['currency'] ?? 'GBP'

      const topWorkflows = summary?.['workflows']?.slice(0, 5) ?? []

      // Generate report ID
      const reportId = randomUUID()

      // Store report record
      const reportsCol = db.collection('reports')
      await reportsCol.insertOne({
        id: reportId,
        tenant_id,
        type: 'roi',
        goal_id,
        workflow_id,
        days,
        data: {
          total_value_minor_units: totalValue,
          total_runs: totalRuns,
          currency,
          top_workflows: topWorkflows,
          goal,
          workflow,
        },
        created_at: new Date(),
      })

      // For now, return a shareable link (PDF generation would require pdfkit/puppeteer)
      const shareableLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/reports/${reportId}`

      return {
        ok: true,
        report_id: reportId,
        shareable_link: shareableLink,
        data: {
          headline: `£${(totalValue / 100).toFixed(1)}k recovered in ${days} days`,
          total_value: totalValue,
          total_runs: totalRuns,
          currency,
          top_workflows: topWorkflows,
        },
      }
    } catch (err) {
      return { error: String(err) }
    }
  })

  /**
   * GET /reports/:id
   * Returns report data for viewing/sharing
   */
  app.get<{ Params: { id: string } }>('/reports/:id', async (req) => {
    const { tenant_id } = req.authContext
    const { id } = req.params

    if (!db) {
      return { error: 'Database not connected' }
    }

    const reportsCol = db.collection('reports')
    const report = await reportsCol.findOne({ id, tenant_id })

    if (!report) {
      return { error: 'Report not found' }
    }

    return { report }
  })
}
