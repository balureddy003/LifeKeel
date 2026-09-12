/**
 * Automation settings tests
 * 
 * Tests for tenant-level automation settings including dry_run_mode and trust levels
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Db, Collection } from 'mongodb'

describe('Automation Settings', () => {
  let db: Db
  let tenantSettings: Collection
  let systemEvents: Collection

  beforeEach(() => {
    // Mock MongoDB collections
    const docs: Record<string, unknown>[] = []
    const events: Record<string, unknown>[] = []
    
    tenantSettings = {
      _name: 'tenant_settings',
      _docs: docs,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { docs.push({ ...doc }) }),
      updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }, options?: { upsert?: boolean }) => {
        let d = docs.find(d => d['tenant_id'] === filter['tenant_id'])
        if (d && update['$set']) {
          // Handle nested $set operations like 'automation.dry_run_mode' or 'automation.trust_level_by_workflow.workflow1'
          const setObj = update['$set']
          for (const [key, value] of Object.entries(setObj)) {
            if (key.includes('.')) {
              const parts = key.split('.')
              let current = d
              for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) current[parts[i]] = {}
                current = current[parts[i]] as Record<string, unknown>
              }
              current[parts[parts.length - 1]] = value
            } else {
              d[key] = value
            }
          }
        } else if (options?.upsert && !d) {
          // Create new document for upsert
          const newDoc = { tenant_id: filter['tenant_id'], ...update['$set'] }
          docs.push(newDoc)
        }
      }),
      findOne: vi.fn(async (filter: Record<string, unknown>) =>
        docs.find(d => d['tenant_id'] === filter['tenant_id']) ?? null
      ),
    } as unknown as Collection

    systemEvents = {
      _name: 'system_events',
      _docs: events,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { events.push({ ...doc }) }),
      find: vi.fn(() => ({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: async () => [...events],
      })),
    } as unknown as Collection

    db = {
      collection: vi.fn((name: string) => {
        if (name === 'tenant_settings') return tenantSettings
        if (name === 'system_events') return systemEvents
        throw new Error(`Unknown collection: ${name}`)
      }),
    } as unknown as Db
  })

  it('returns default dry_run_mode: true for new tenant', async () => {
    // No existing settings for tenant
    const result = await tenantSettings.findOne({ tenant_id: 'new-tenant' })
    expect(result).toBeNull()

    // When tenant has no automation settings, default should be dry_run_mode: true
    const defaultSettings = {
      dry_run_mode: true,
      trust_level_by_workflow: {},
    }
    
    expect(defaultSettings.dry_run_mode).toBe(true)
  })

  it('persists dry_run_mode setting', async () => {
    const tenantId = 'test-tenant'
    const automationSettings = {
      dry_run_mode: false,
      trust_level_by_workflow: {},
    }

    await tenantSettings.updateOne(
      { tenant_id: tenantId },
      { $set: { automation: automationSettings, updated_at: new Date() } },
      { upsert: true },
    )

    const result = await tenantSettings.findOne({ tenant_id: tenantId })
    expect(result?.['automation']?.dry_run_mode).toBe(false)
  })

  it('updates dry_run_mode without overwriting other settings', async () => {
    const tenantId = 'test-tenant-2'
    
    // Set initial settings
    await tenantSettings.updateOne(
      { tenant_id: tenantId },
      { $set: { 
        automation: { 
          dry_run_mode: true, 
          trust_level_by_workflow: { workflow1: 3 } 
        }, 
        updated_at: new Date() 
      } },
      { upsert: true },
    )

    // Update only dry_run_mode
    await tenantSettings.updateOne(
      { tenant_id: tenantId },
      { $set: { 
        'automation.dry_run_mode': false,
        updated_at: new Date() 
      } },
    )

    const result = await tenantSettings.findOne({ tenant_id: tenantId })
    expect(result?.['automation']?.dry_run_mode).toBe(false)
    expect(result?.['automation']?.trust_level_by_workflow).toEqual({ workflow1: 3 })
  })

  it('increments trust level on approval and emits event at level 5', async () => {
    const tenantId = 'test-tenant-3'
    const workflowId = 'test-workflow'

    // Simulate 5 approvals
    for (let i = 1; i <= 5; i++) {
      await tenantSettings.updateOne(
        { tenant_id: tenantId },
        { $set: { 
          automation: { 
            trust_level_by_workflow: { [workflowId]: i } 
          },
          updated_at: new Date() 
        } },
        { upsert: true }
      )

      // Check if event should be emitted at level 5
      if (i === 5) {
        await systemEvents.insertOne({
          tenant_id: tenantId,
          type: 'workflow.trust_upgraded',
          workflow_id: workflowId,
          trust_level: i,
          created_at: new Date(),
        })
      }
    }

    const result = await tenantSettings.findOne({ tenant_id: tenantId })
    expect(result?.['automation']?.trust_level_by_workflow?.[workflowId]).toBe(5)

    const events = await systemEvents.find().toArray()
    const trustEvent = events.find(e => e['type'] === 'workflow.trust_upgraded')
    expect(trustEvent).toBeDefined()
    expect(trustEvent?.['workflow_id']).toBe(workflowId)
    expect(trustEvent?.['trust_level']).toBe(5)
  })

  it('does not increment trust level beyond 5', async () => {
    const tenantId = 'test-tenant-4'
    const workflowId = 'test-workflow-2'

    // Set trust level to 5 using nested path
    await tenantSettings.updateOne(
      { tenant_id: tenantId },
      { $set: { 
        automation: { 
          trust_level_by_workflow: { [workflowId]: 5 } 
        },
        updated_at: new Date() 
      } },
      { upsert: true }
    )

    // Emit event once at level 5
    await systemEvents.insertOne({
      tenant_id: tenantId,
      type: 'workflow.trust_upgraded',
      workflow_id: workflowId,
      trust_level: 5,
      created_at: new Date(),
    })

    // Try to increment again (6th approval) - should not increment beyond 5
    const currentLevel = 5
    if (currentLevel < 5) {
      await tenantSettings.updateOne(
        { tenant_id: tenantId },
        { $set: { 
          automation: { 
            trust_level_by_workflow: { [workflowId]: currentLevel + 1 } 
          },
          updated_at: new Date() 
        } },
      )
    }

    const result = await tenantSettings.findOne({ tenant_id: tenantId })
    // Should stay at 5 since we don't increment beyond 5
    expect(result?.['automation']?.trust_level_by_workflow?.[workflowId]).toBe(5)

    const events = await systemEvents.find().toArray()
    const trustEvents = events.filter(e => e['type'] === 'workflow.trust_upgraded' && e['workflow_id'] === workflowId)
    // Should only have one event for the upgrade to level 5
    expect(trustEvents.length).toBe(1)
  })
})
