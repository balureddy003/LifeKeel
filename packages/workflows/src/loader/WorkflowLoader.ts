import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import type { Db } from 'mongodb'
import type { WorkflowDef } from '../types.js'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'workflow-loader', version: '0.0.0' })
import { WorkflowVersionStore } from '../versioning/WorkflowVersionStore.js'

// ── Zod schema for YAML validation ───────────────────────

const EdgeSchema = z.object({
  from: z.union([z.string(), z.array(z.string())]),
  to: z.union([z.string(), z.array(z.string())]),
  condition: z.string().optional(),
  label: z.string().optional(),
})

const NodeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Node id must be lowercase snake_case'),
  type: z.enum(['trigger','ai_generate','skill','http','human_approval','connector_action','notify','condition','wait','transform','loop','sub_workflow','detector','error_handler','set_variable','filter','trade_intent']),
  label: z.string(),
  description: z.string().optional(),
  config: z.record(z.unknown()),
  output: z.record(z.string()).optional(),
})

const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  enabled: z.boolean().default(true),
  trigger: z.object({
    detector: z.string().optional(),
    condition: z.string().optional(),
    event_type: z.string().optional(),
    schedule: z.string().optional(),
  }),
  state: z.record(z.unknown()).default({}),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  settings: z.object({
    timeout_minutes: z.number().optional(),
    max_retries: z.number().default(3),
    on_error: z.enum(['stop','continue','notify']).default('stop'),
  }).optional(),
})

// ── Loader ────────────────────────────────────────────────

export class WorkflowLoader {
  private workflows = new Map<string, WorkflowDef>()
  private watchDir: string | null = null
  private versionStore?: WorkflowVersionStore

  constructor(private readonly workflowsDir: string, db?: Db) {
    if (db) this.versionStore = new WorkflowVersionStore(db)
  }

  loadAll(): WorkflowDef[] {
    if (!fs.existsSync(this.workflowsDir)) {
      fs.mkdirSync(this.workflowsDir, { recursive: true })
      return []
    }

    const files = fs.readdirSync(this.workflowsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))

    this.workflows.clear()

    for (const file of files) {
      try {
        const wf = this.loadFile(path.join(this.workflowsDir, file))
        if (wf) this.workflows.set(wf.id, wf)
      } catch (err) {
        log.error({ file, err }, 'Failed to load workflow')
      }
    }

    log.info({ count: this.workflows.size }, 'Loaded workflows')
    return [...this.workflows.values()]
  }

  loadFile(filePath: string): WorkflowDef | null {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(raw) as Record<string, unknown>
    if (!parsed) return null

    // Support both `workflow: { ... }` wrapper and top-level `id: ...` format
    const candidate = (parsed['workflow'] ?? parsed) as unknown

    const result = WorkflowSchema.safeParse(candidate)
    if (!result.success) {
      throw new Error(`Invalid workflow in ${filePath}: ${result.error.message}`)
    }
    return result.data as WorkflowDef
  }

  get(id: string): WorkflowDef | undefined {
    return this.workflows.get(id)
  }

  getAll(): WorkflowDef[] {
    return [...this.workflows.values()]
  }

  getByDetector(detectorId: string): WorkflowDef[] {
    return this.getAll().filter(w => w.enabled && w.trigger.detector === detectorId)
  }

  getByEventType(eventType: string): WorkflowDef[] {
    return this.getAll().filter(w => w.enabled && w.trigger.event_type === eventType)
  }

  saveWorkflow(def: WorkflowDef, savedBy?: string): void {
    const filePath = path.join(this.workflowsDir, `${def.id}.yaml`)
    const content = yaml.dump({ workflow: def }, { lineWidth: 120, quotingType: '"' })
    fs.writeFileSync(filePath, content, 'utf-8')
    this.workflows.set(def.id, def)
    // Auto-save version snapshot (non-blocking; version deduplicates by content hash)
    this.versionStore?.saveVersion(def, savedBy).catch(err =>
      log.warn({ err }, 'Version save failed')
    )
  }

  deleteWorkflow(id: string): void {
    const filePath = path.join(this.workflowsDir, `${id}.yaml`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    this.workflows.delete(id)
  }

  watch(onChange: (id: string) => void): void {
    if (!fs.existsSync(this.workflowsDir)) return
    fs.watch(this.workflowsDir, (event, filename) => {
      if (!filename || (!filename.endsWith('.yaml') && !filename.endsWith('.yml'))) return
      try {
        const filePath = path.join(this.workflowsDir, filename)
        if (fs.existsSync(filePath)) {
          const wf = this.loadFile(filePath)
          if (wf) { this.workflows.set(wf.id, wf); onChange(wf.id) }
        }
      } catch (err) {
        log.error({ err }, 'Hot-reload error')
      }
    })
  }
}
