import type { Db, Collection } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type {
  WorkflowApproval,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun,
} from './types.js'

interface StepOutcome<TState> {
  ok: boolean
  state?: Partial<TState> | undefined
  nextStepId?: string | undefined
  error?: string | undefined
}

/**
 * Durable, Mongo-backed step-sequence executor. Nothing here runs unless
 * application code explicitly calls start()/resume()/approve()/reject() —
 * no cron, no auto-registration, no boot-time scheduling. See
 * packages/workflows/README.md for why that distinction matters.
 */
export class WorkflowEngine {
  private runsCol: Collection<WorkflowRun<Record<string, unknown>>>
  private stepRunsCol: Collection<WorkflowStepRun>
  private approvalsCol: Collection<WorkflowApproval>

  constructor(db: Db) {
    this.runsCol = db.collection<WorkflowRun<Record<string, unknown>>>('workflow_runs')
    this.stepRunsCol = db.collection<WorkflowStepRun>('workflow_step_runs')
    this.approvalsCol = db.collection<WorkflowApproval>('workflow_approvals')
    this.runsCol.createIndex({ id: 1 }, { unique: true }).catch(() => {})
    this.stepRunsCol.createIndex({ run_id: 1, step_id: 1 }, { unique: true }).catch(() => {})
    this.approvalsCol.createIndex({ run_id: 1 }).catch(() => {})
  }

  async start<TState>(
    def: WorkflowDefinition<TState>,
    opts: { tenantId: string; initialState: unknown },
  ): Promise<WorkflowRun<TState>> {
    const state = def.stateSchema.parse(opts.initialState)
    const now = new Date()
    const run: WorkflowRun<Record<string, unknown>> = {
      id: randomUUID(),
      tenant_id: opts.tenantId,
      workflow_id: def.id,
      status: 'running',
      current_step_id: def.steps[0]!.id,
      state: state as Record<string, unknown>,
      started_at: now,
      updated_at: now,
    }
    await this.runsCol.insertOne(run)
    return this.runLoop(def, run.id, opts.tenantId)
  }

  /** Continues a 'running' or 'failed' run from its current step. Safe after a crash or to retry a failure — a 'failed' run is atomically reclaimed to 'running' first, mirroring insights.ts's retry-execution. No-ops (returns the run as-is) for awaiting_approval/completed/rejected. */
  async resume<TState>(def: WorkflowDefinition<TState>, runId: string, tenantId: string): Promise<WorkflowRun<TState>> {
    const existing = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
    if (!existing) throw new Error(`No workflow run ${runId}`)

    if (existing.status === 'failed') {
      const reclaimResult = await this.runsCol.updateOne(
        { id: runId, tenant_id: tenantId, status: 'failed' },
        { $set: { status: 'running', updated_at: new Date() }, $unset: { error: '' } },
      )
      if (reclaimResult.matchedCount === 0) return this.refetch<TState>(runId, tenantId)
    } else if (existing.status !== 'running') {
      return existing as unknown as WorkflowRun<TState>
    }

    return this.runLoop(def, runId, tenantId)
  }

  /** Records an approval decision and un-pauses the run to 'running'. Does NOT continue execution — call resume() afterwards, matching the already-shipped approve-then-retry-execution pattern (an HTTP approval request never synchronously blocks on unrelated step execution). */
  async approve(runId: string, opts: { tenantId: string; approvedBy: string }): Promise<void> {
    await this.decideGate(runId, opts.tenantId, {
      pendingFilterExtra: {},
      approvalSet: { decision: 'approved', decided_at: new Date(), decided_by: opts.approvedBy },
      runStatus: 'running',
    })
  }

  /** Records a rejection. Terminal — the run cannot be resumed afterwards. */
  async reject(runId: string, opts: { tenantId: string; rejectedBy: string; reason?: string }): Promise<void> {
    await this.decideGate(runId, opts.tenantId, {
      pendingFilterExtra: {},
      approvalSet: { decision: 'rejected', decided_at: new Date(), decided_by: opts.rejectedBy, reason: opts.reason },
      runStatus: 'rejected',
    })
  }

  async getRun<TState>(runId: string, tenantId: string): Promise<WorkflowRun<TState> | null> {
    const run = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
    return run as unknown as WorkflowRun<TState> | null
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async decideGate(
    runId: string,
    tenantId: string,
    opts: {
      pendingFilterExtra: Record<string, unknown>
      approvalSet: Record<string, unknown>
      runStatus: 'running' | 'rejected'
    },
  ): Promise<void> {
    const run = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
    if (!run) throw new Error(`No workflow run ${runId}`)
    if (run.status !== 'awaiting_approval') {
      throw new Error(`Workflow run ${runId} is not awaiting approval (status: ${run.status})`)
    }

    const decided = await this.approvalsCol.updateOne(
      { run_id: runId, step_id: run.current_step_id, decision: { $exists: false }, ...opts.pendingFilterExtra },
      { $set: opts.approvalSet },
    )
    if (decided.matchedCount === 0) {
      throw new Error(`No pending approval for run ${runId} at step ${run.current_step_id}`)
    }

    await this.runsCol.updateOne(
      { id: runId, tenant_id: tenantId, status: 'awaiting_approval' },
      {
        $set: {
          status: opts.runStatus,
          updated_at: new Date(),
          ...(opts.runStatus === 'rejected' ? { completed_at: new Date() } : {}),
        },
      },
    )
  }

  private async refetch<TState>(runId: string, tenantId: string): Promise<WorkflowRun<TState>> {
    const run = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
    if (!run) throw new Error(`No workflow run ${runId}`)
    return run as unknown as WorkflowRun<TState>
  }

  private async runLoop<TState>(def: WorkflowDefinition<TState>, runId: string, tenantId: string): Promise<WorkflowRun<TState>> {
    for (;;) {
      const run = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
      if (!run) throw new Error(`No workflow run ${runId}`)
      if (run.status !== 'running') return run as unknown as WorkflowRun<TState>

      const stepIndex = def.steps.findIndex((s) => s.id === run.current_step_id)
      if (stepIndex === -1) throw new Error(`defineWorkflow(${def.id}): unknown step id "${run.current_step_id}" on run ${runId}`)
      const step = def.steps[stepIndex]!

      if (step.kind === 'approval_gate') {
        const nextStepId = def.steps[stepIndex + 1]?.id
        const passed = await this.tryPassGate(runId, tenantId, run.current_step_id, step, nextStepId)
        if (!passed) return this.refetch<TState>(runId, tenantId) // awaiting approval, or another caller already advanced this run — stop either way
        continue // we advanced past the gate ourselves — loop again to execute whatever comes next
      }

      const outcome = await this.runActionStep<TState>(runId, tenantId, run.state as TState, step)
      if (!outcome.ok) {
        await this.runsCol.updateOne(
          { id: runId, tenant_id: tenantId, current_step_id: step.id, status: 'running' },
          { $set: { status: 'failed', error: outcome.error ?? 'Unknown error', updated_at: new Date() } },
        )
        return this.refetch<TState>(runId, tenantId)
      }

      const nextStepId = outcome.nextStepId ?? def.steps[stepIndex + 1]?.id
      const mergedState = def.stateSchema.parse({ ...run.state, ...(outcome.state ?? {}) }) as unknown as Record<string, unknown>

      const advance = await this.runsCol.updateOne(
        { id: runId, tenant_id: tenantId, current_step_id: step.id, status: 'running' },
        nextStepId
          ? { $set: { current_step_id: nextStepId, state: mergedState, updated_at: new Date() } }
          : { $set: { status: 'completed', state: mergedState, updated_at: new Date(), completed_at: new Date() } },
      )
      if (advance.matchedCount === 0) return this.refetch<TState>(runId, tenantId) // concurrent resume() already advanced this run — stop cleanly, not an error
      if (!nextStepId) return this.refetch<TState>(runId, tenantId)
      // else: loop again to execute nextStepId
    }
  }

  /**
   * Returns true only if THIS call advanced current_step_id past the gate
   * (decision was 'approved' and we won the atomic race). Returns false if
   * the gate is still undecided (freshly paused, or a crash left an
   * approval doc without the status flip — handled idempotently below) or
   * if another concurrent caller already advanced it first — either way
   * the caller (runLoop) stops and refetches rather than looping forever.
   */
  private async tryPassGate<TState>(
    runId: string,
    tenantId: string,
    stepId: string,
    step: WorkflowStep<TState>,
    nextStepId: string | undefined,
  ): Promise<boolean> {
    let approval: WorkflowApproval | null = await this.approvalsCol.findOne({ run_id: runId, step_id: stepId })
    if (!approval) {
      const run = await this.runsCol.findOne({ id: runId, tenant_id: tenantId })
      const description = step.describeForApproval!((run?.state ?? {}) as TState)
      approval = {
        id: randomUUID(),
        run_id: runId,
        tenant_id: tenantId,
        step_id: stepId,
        description,
        requested_at: new Date(),
      }
      await this.approvalsCol.insertOne(approval)
    }

    if (!approval.decision) {
      // Idempotent — also covers a crash that inserted the approval doc but
      // never got to flip the run's status before the process died.
      await this.runsCol.updateOne(
        { id: runId, tenant_id: tenantId, current_step_id: stepId, status: 'running' },
        { $set: { status: 'awaiting_approval', updated_at: new Date() } },
      )
      return false
    }

    if (approval.decision === 'rejected') {
      // Shouldn't happen — reject() moves status to 'rejected' directly,
      // so a rejected run never re-enters runLoop — but fail safe.
      throw new Error(`Workflow run ${runId} step ${stepId} was rejected`)
    }

    const advance = await this.runsCol.updateOne(
      { id: runId, tenant_id: tenantId, current_step_id: stepId, status: 'running' },
      nextStepId
        ? { $set: { current_step_id: nextStepId, updated_at: new Date() } }
        : { $set: { status: 'completed', updated_at: new Date(), completed_at: new Date() } },
    )
    return advance.matchedCount === 1
  }

  /**
   * Idempotent step execution — mirrors apps/api/src/actions/action-executor.ts's
   * runAction exactly: an existing 'succeeded' record is reused without
   * re-invoking run() (never repeat a side effect that already happened); an
   * existing 'failed' record is superseded (this is a retry) before running
   * again.
   */
  private async runActionStep<TState>(
    runId: string,
    tenantId: string,
    state: TState,
    step: WorkflowStep<TState>,
  ): Promise<StepOutcome<TState>> {
    const existing = await this.stepRunsCol.findOne({ run_id: runId, step_id: step.id })
    if (existing?.status === 'succeeded') {
      return { ok: true, state: existing.result_state as Partial<TState> | undefined, nextStepId: existing.next_step_id }
    }
    if (existing) {
      await this.stepRunsCol.deleteOne({ run_id: runId, step_id: step.id })
    }

    try {
      const result = await step.run!({ runId, tenantId, state })
      await this.insertStepRun({
        run_id: runId,
        step_id: step.id,
        tenant_id: tenantId,
        status: 'succeeded',
        result_state: result.state as Record<string, unknown>,
        ...(result.nextStepId !== undefined ? { next_step_id: result.nextStepId } : {}),
        executed_at: new Date(),
      })
      return { ok: true, state: result.state, nextStepId: result.nextStepId }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await this.insertStepRun({
        run_id: runId,
        step_id: step.id,
        tenant_id: tenantId,
        status: 'failed',
        error,
        executed_at: new Date(),
      })
      return { ok: false, error }
    }
  }

  private async insertStepRun(stepRun: WorkflowStepRun): Promise<void> {
    try {
      await this.stepRunsCol.insertOne(stepRun)
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err
      // A concurrent caller already recorded this step first — defer to it.
    }
  }
}
