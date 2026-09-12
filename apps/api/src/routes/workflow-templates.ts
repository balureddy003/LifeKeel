/**
 * Workflow Template Routes
 *
 * GET  /workflows/templates          — list all available templates
 * POST /workflows/templates/:id/install — install a template for the tenant
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'workflow-templates', version: '0.0.0' })

interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: string
  required_connectors: string[]
  estimated_roi: string
  setup_minutes: number
  featured: boolean
  version: string
}

const WORKFLOWS_DIR = path.resolve(process.cwd(), '../../../definitions/workflows')

export function registerWorkflowTemplateRoutes(fastify: FastifyInstance, db: Db): void {

  // GET /workflows/templates — list all available templates
  fastify.get('/workflows/templates', async (_req) => {
    const files = await fs.readdir(WORKFLOWS_DIR)
    const templates: WorkflowTemplate[] = []

    for (const file of files.filter(f => f.endsWith('.yaml'))) {
      try {
        const content = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8')
        const doc = yaml.load(content) as any

        if (!doc) continue

        // Handle both flat and nested workflow structures
        const workflow = doc.workflow ?? doc
        const template = workflow.template ?? {}

        templates.push({
          id: workflow.id ?? file.replace('.yaml', ''),
          name: workflow.name ?? 'Untitled',
          description: workflow.description ?? '',
          category: template.category ?? 'operations',
          required_connectors: template.required_connectors ?? [],
          estimated_roi: template.estimated_roi ?? 'Variable',
          setup_minutes: template.setup_minutes ?? 2,
          featured: template.featured ?? false,
          version: workflow.version ?? '1.0.0',
        })
      } catch (err) {
        log.warn({ file, error: err }, 'Failed to parse workflow template')
      }
    }

    return { templates: templates.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)) }
  })

  // POST /workflows/templates/:id/install — install a template for the tenant
  fastify.post<{ Params: { id: string } }>('/workflows/templates/:id/install', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id } = req.params

    // Find the template file
    const files = await fs.readdir(WORKFLOWS_DIR)
    const file = files.find(f => f.replace('.yaml', '') === id)

    if (!file) {
      return reply.status(404).send({ error: 'Template not found' })
    }

    // Check if already installed
    const existing = await db.collection('tenant_workflows').findOne({
      tenant_id,
      workflow_id: id,
    })

    if (existing) {
      return reply.status(409).send({
        error: 'Workflow already installed',
        installed_at: existing.installed_at,
      })
    }

    // Read and parse the template
    const content = await fs.readFile(path.join(WORKFLOWS_DIR, file), 'utf-8')
    const workflow = yaml.load(content) as any

    // Store the installed workflow
    await db.collection('tenant_workflows').insertOne({
      tenant_id,
      workflow_id: id,
      name: workflow.name ?? id,
      definition: workflow,
      installed_at: new Date().toISOString(),
      status: 'installed',
    })

    return reply.status(201).send({
      id,
      message: 'Template installed successfully',
      installed_workflows: [id],
    })
  })
}
