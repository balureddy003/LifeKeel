/**
 * WorkflowQueue — wraps QueueManager for workflow trigger events.
 *
 * Priority mapping:
 *   manual_trigger   → 0  (high)
 *   detector_signal  → 5  (normal)
 *   schedule         → 10 (low)
 */

import type { WorkflowDef, EventPayload } from '@agentoak/workflows'
import type { WorkflowEngine, WorkflowLoader } from '@agentoak/workflows'
import type { Db } from 'mongodb'
import { queueManager } from './QueueManager.js'
import { createLlmRouter, createLlmRouterFromEnv, retryWithPolicy, createLogger, type LlmProvider } from '@agentoak/platform'
import { guardLlmBudget } from '../lib/llm-guard.js'

const log = createLogger({ service: 'workflow-queue', version: '0.0.0' })
import { getTenantLlmConfig } from '../routes/settings.js'

export const WORKFLOW_TRIGGER_QUEUE = 'workflow.trigger'

const PRIORITY_MAP: Record<string, number> = {
  manual_trigger: 0,
  detector_signal: 5,
  schedule: 10,
}

export interface WorkflowTriggerJob {
  workflowId: string
  workflowDef: WorkflowDef
  event: EventPayload
  tenantId: string
}

/** Publish a workflow trigger to the queue */
export async function enqueueWorkflowTrigger(
  def: WorkflowDef,
  event: EventPayload,
  tenantId: string,
  _llmFn?: (system: string, prompt: string, model: string) => Promise<string>,
): Promise<void> {
  const priority = PRIORITY_MAP[event.event_type] ?? 5

  const job: WorkflowTriggerJob = {
    workflowId: def.id,
    workflowDef: def,
    event,
    tenantId,
  }

  await queueManager.publish(WORKFLOW_TRIGGER_QUEUE, job, { priority })
  log.info({ workflow_id: def.id, event_type: event.event_type, priority }, 'Enqueued workflow')
}

/** Start the workflow trigger worker — subscribes to the queue and executes workflows */
export function startWorker(
  engine: WorkflowEngine,
  loader: WorkflowLoader,
  db: Db,
  opts?: { concurrency?: number },
): void {
  const envLlm = createLlmRouterFromEnv()

  queueManager.subscribe(
    WORKFLOW_TRIGGER_QUEUE,
    async (payload) => {
      const job = payload as WorkflowTriggerJob

      // Re-fetch the latest definition from loader (may have been hot-reloaded)
      const latestDef = loader.get(job.workflowId) ?? job.workflowDef

      try {
        let llmFnForRun = envLlm
        try {
          const tenantCfg = await getTenantLlmConfig(db, job.tenantId)
          if (tenantCfg) {
            llmFnForRun = createLlmRouter({
              provider: tenantCfg.provider as LlmProvider,
              defaultModel: tenantCfg.model,
              temperature: tenantCfg.temperature,
              maxTokens: tenantCfg.maxTokens,
              ...(tenantCfg.apiKey !== undefined ? { apiKey: tenantCfg.apiKey } : {}),
              ...(tenantCfg.azureEndpoint !== undefined ? { azureEndpoint: tenantCfg.azureEndpoint } : {}),
              ...(tenantCfg.azureDeployment !== undefined ? { azureDeployment: tenantCfg.azureDeployment } : {}),
              ...(tenantCfg.azureApiVersion !== undefined ? { azureApiVersion: tenantCfg.azureApiVersion } : {}),
              ...(tenantCfg.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: tenantCfg.ollamaBaseUrl } : {}),
              ...(tenantCfg.tierModels !== undefined ? { tierModels: tenantCfg.tierModels } : {}),
            })
          }
        } catch { /* use env fallback */ }

        // Enforce tenant LLM budget before starting a workflow that may call LLMs
        const guard = await guardLlmBudget(db, job.tenantId)
        if (!guard.allowed) {
          throw new Error(`LLM budget exhausted: ${guard.reason}`)
        }

        const run = await retryWithPolicy('llm_workflow', () =>
          engine.start(latestDef, job.event, job.tenantId, llmFnForRun))
        log.info({ workflow_id: job.workflowId, run_id: run.id }, 'Workflow completed')
      } catch (err) {
        await db.collection('workflow_dlq').insertOne({
          job_id: `${job.workflowId}:${Date.now()}`,
          workflow_id: job.workflowId,
          tenant_id: job.tenantId,
          error: {
            message: (err as Error).message,
            stack: (err as Error).stack,
          },
          attempts: 3,
          failed_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 86_400_000),
        })
        log.error({ workflow_id: job.workflowId, err }, 'Workflow execution failed')
      }
    },
    { concurrency: opts?.concurrency ?? 2 },
  )

  log.info({ queue: WORKFLOW_TRIGGER_QUEUE }, 'Worker started')
}
