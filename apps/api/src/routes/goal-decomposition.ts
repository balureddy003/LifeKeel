/**
 * Goal Decomposition — Break down goals into sub-tasks with dependencies.
 *
 * Phase 4 Feature: Advanced Features
 *
 * Routes:
 *   GET  /goals/:id/decomposition  — Get goal decomposition
 *   POST /goals/:id/decomposition  — Create/update decomposition
 *   POST /goals/:id/subtasks       — Add sub-task
 *   PUT  /goals/:id/subtasks/:id   — Update sub-task
 *   DELETE /goals/:id/subtasks/:id — Delete sub-task
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'goal-decomposition', version: '0.0.0' })

// ── Schema ─────────────────────────────────────────────────────────────────────

const SubTaskSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  progress: z.number().min(0).max(100),
  dependencies: z.array(z.string()),
  estimated_hours: z.number().optional(),
  actual_hours: z.number().optional(),
  assigned_to: z.string().optional(),
  due_date: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

const DependencySchema = z.object({
  id: z.string(),
  from_subtask_id: z.string(),
  to_subtask_id: z.string(),
  type: z.enum(['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish']),
})

const GoalDecompositionSchema = z.object({
  goal_id: z.string(),
  subtasks: z.array(SubTaskSchema),
  dependencies: z.array(DependencySchema),
  created_at: z.string(),
  updated_at: z.string(),
})

export type SubTask = z.infer<typeof SubTaskSchema>
export type Dependency = z.infer<typeof DependencySchema>
export type GoalDecomposition = z.infer<typeof GoalDecompositionSchema>

// ── Route Handlers ─────────────────────────────────────────────────────────────

export async function registerGoalDecompositionRoutes(app: FastifyInstance, db: Db) {
  const subtasksCol = db.collection<SubTask>('goal_subtasks')
  const dependenciesCol = db.collection<Dependency>('goal_dependencies')
  const decompositionsCol = db.collection<GoalDecomposition>('goal_decompositions')

  // Create indexes
  subtasksCol.createIndex({ goal_id: 1 }).catch(() => {})
  subtasksCol.createIndex({ goal_id: 1, status: 1 }).catch(() => {})
  dependenciesCol.createIndex({ from_subtask_id: 1 }).catch(() => {})
  dependenciesCol.createIndex({ to_subtask_id: 1 }).catch(() => {})
  decompositionsCol.createIndex({ goal_id: 1 }, { unique: true }).catch(() => {})

  // ── GET /goals/:id/decomposition ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/goals/:id/decomposition', async (req, reply) => {
    const { id: goalId } = req.params

    try {
      const decomposition = await decompositionsCol.findOne({ goal_id: goalId })
      
      if (!decomposition) {
        // Return empty decomposition
        return reply.status(200).send({
          goal_id: goalId,
          subtasks: [],
          dependencies: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }

      return reply.status(200).send(decomposition)
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch goal decomposition')
      return reply.status(500).send({
        error: 'Failed to fetch goal decomposition',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /goals/:id/decomposition ──────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/goals/:id/decomposition', async (req, reply) => {
    const { id: goalId } = req.params

    const parsed = GoalDecompositionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid goal decomposition',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const decomposition: GoalDecomposition = {
      ...parsed.data,
      goal_id: goalId,
      updated_at: new Date().toISOString(),
    }

    try {
      // Update or create decomposition
      await decompositionsCol.updateOne(
        { goal_id: goalId },
        { $set: decomposition },
        { upsert: true }
      )

      // Update subtasks
      if (decomposition.subtasks.length > 0) {
        await subtasksCol.deleteMany({ goal_id: goalId })
        await subtasksCol.insertMany(decomposition.subtasks)
      }

      // Update dependencies
      if (decomposition.dependencies.length > 0) {
        await dependenciesCol.deleteMany({
          $or: [
            { from_subtask_id: { $in: decomposition.subtasks.map(st => st.id) } },
            { to_subtask_id: { $in: decomposition.subtasks.map(st => st.id) } },
          ],
        })
        await dependenciesCol.insertMany(decomposition.dependencies)
      }

      return reply.status(200).send(decomposition)
    } catch (error) {
      log.error({ err: error }, 'Failed to save goal decomposition')
      return reply.status(500).send({
        error: 'Failed to save goal decomposition',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /goals/:id/subtasks ────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/goals/:id/subtasks', async (req, reply) => {
    const { id: goalId } = req.params

    const parsed = SubTaskSchema.partial({ id: true }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid sub-task',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const subtask: SubTask = {
      ...parsed.data,
      id: parsed.data.id || `subtask-${Date.now()}`,
      goal_id: goalId,
      status: parsed.data.status || 'pending',
      progress: parsed.data.progress || 0,
      created_at: parsed.data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    try {
      await subtasksCol.insertOne(subtask)
      
      // Update decomposition timestamp
      await decompositionsCol.updateOne(
        { goal_id: goalId },
        { $set: { updated_at: new Date().toISOString() } },
        { upsert: true }
      )

      return reply.status(201).send(subtask)
    } catch (error) {
      log.error({ err: error }, 'Failed to create sub-task')
      return reply.status(500).send({
        error: 'Failed to create sub-task',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── PUT /goals/:id/subtasks/:subtaskId ───────────────────────────────────────────
  app.put<{ Params: { id: string; subtaskId: string } }>('/goals/:id/subtasks/:subtaskId', async (req, reply) => {
    const { id: goalId, subtaskId } = req.params

    const parsed = SubTaskSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid sub-task update',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    try {
      const result = await subtasksCol.updateOne(
        { id: subtaskId, goal_id: goalId },
        { $set: { 
          ...parsed.data, 
          updated_at: new Date().toISOString(), 
          created_at: parsed.data.created_at || new Date().toISOString(),
          id: parsed.data.id || subtaskId,
          goal_id: parsed.data.goal_id || goalId,
          status: parsed.data.status || 'pending',
          name: parsed.data.name || '',
          description: parsed.data.description || '',
          progress: parsed.data.progress ?? 0,
          dependencies: parsed.data.dependencies || [],
        } }
      )

      if (result.matchedCount === 0) {
        return reply.status(404).send({ error: 'Sub-task not found' })
      }

      // Update decomposition timestamp
      await decompositionsCol.updateOne(
        { goal_id: goalId },
        { $set: { updated_at: new Date().toISOString() } }
      )

      const updated = await subtasksCol.findOne({ id: subtaskId })
      return reply.status(200).send(updated)
    } catch (error) {
      log.error({ err: error }, 'Failed to update sub-task')
      return reply.status(500).send({
        error: 'Failed to update sub-task',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── DELETE /goals/:id/subtasks/:subtaskId ────────────────────────────────────────
  app.delete<{ Params: { id: string; subtaskId: string } }>('/goals/:id/subtasks/:subtaskId', async (req, reply) => {
    const { id: goalId, subtaskId } = req.params

    try {
      const result = await subtasksCol.deleteOne({ id: subtaskId, goal_id: goalId })

      if (result.deletedCount === 0) {
        return reply.status(404).send({ error: 'Sub-task not found' })
      }

      // Delete related dependencies
      await dependenciesCol.deleteMany({
        $or: [{ from_subtask_id: subtaskId }, { to_subtask_id: subtaskId }],
      })

      // Update decomposition timestamp
      await decompositionsCol.updateOne(
        { goal_id: goalId },
        { $set: { updated_at: new Date().toISOString() } }
      )

      return reply.status(204).send()
    } catch (error) {
      log.error({ err: error }, 'Failed to delete sub-task')
      return reply.status(500).send({
        error: 'Failed to delete sub-task',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
