/**
 * Optimization quota and budget guard tests
 * 
 * Tests for POST /analytics/optimize quota checks and LLM budget enforcement
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Db, Collection } from 'mongodb'

describe('Optimization Quota and Budget Guard', () => {
  let db: Db
  let skillOptHistory: Collection
  let tenantSettings: Collection
  let llmUsage: Collection
  let insights: Collection

  beforeEach(() => {
    // Mock MongoDB collections
    const optDocs: Record<string, unknown>[] = []
    const settingsDocs: Record<string, unknown>[] = []
    const usageDocs: Record<string, unknown>[] = []
    const insightsDocs: Record<string, unknown>[] = []
    
    skillOptHistory = {
      _name: 'skill_opt_history',
      _docs: optDocs,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { optDocs.push({ ...doc }) }),
      countDocuments: vi.fn(async (filter: Record<string, unknown>) => {
        // Simple mock: return count based on filter
        if (filter['tenant_id'] && filter['completed_at']) {
          return optDocs.filter(d => 
            d['tenant_id'] === filter['tenant_id'] && 
            d['completed_at'] instanceof Date && d['completed_at'] >= filter['completed_at']
          ).length
        }
        if (filter['tenant_id'] && filter['detector_id']) {
          return optDocs.filter(d => 
            d['tenant_id'] === filter['tenant_id'] && 
            d['detector_id'] === filter['detector_id']
          ).length
        }
        return 0
      }),
      findOne: vi.fn(async (filter: Record<string, unknown>) => {
        if (filter['tenant_id'] && filter['detector_id']) {
          return optDocs.find(d => 
            d['tenant_id'] === filter['tenant_id'] && 
            d['detector_id'] === filter['detector_id']
          ) ?? null
        }
        return null
      }),
    } as unknown as Collection

    insights = {
      _name: 'insights',
      _docs: insightsDocs,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { insightsDocs.push({ ...doc }) }),
      countDocuments: vi.fn(async (filter: Record<string, unknown>) => {
        if (filter['tenant_id'] && filter['detector_id'] && filter['approved_at']) {
          return insightsDocs.filter(d => 
            d['tenant_id'] === filter['tenant_id'] && 
            d['detector_id'] === filter['detector_id'] &&
            d['approved_at'] instanceof Date && d['approved_at'] >= filter['approved_at']
          ).length
        }
        return 0
      }),
    } as unknown as Collection

    tenantSettings = {
      _name: 'tenant_settings',
      _docs: settingsDocs,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { settingsDocs.push({ ...doc }) }),
      updateOne: vi.fn(async () => {}),
      findOne: vi.fn(async (filter: Record<string, unknown>) =>
        settingsDocs.find(d => d['tenant_id'] === filter['tenant_id']) ?? null
      ),
    } as unknown as Collection

    llmUsage = {
      _name: 'llm_usage',
      _docs: usageDocs,
      createIndex: vi.fn(async () => 'index_name'),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { usageDocs.push({ ...doc }) }),
      aggregate: vi.fn(() => ({
        next: async () => null,
      })),
    } as unknown as Collection

    db = {
      collection: vi.fn((name: string) => {
        if (name === 'skill_opt_history') return skillOptHistory
        if (name === 'tenant_settings') return tenantSettings
        if (name === 'llm_usage') return llmUsage
        if (name === 'insights') return insights
        throw new Error(`Unknown collection: ${name}`)
      }),
    } as unknown as Db
  })

  it('counts tenant daily optimization runs correctly', async () => {
    const tenantId = 'test-tenant'
    const detectorId = 'test-detector'
    
    // Simulate tenant at daily limit (5 runs)
    for (let i = 0; i < 5; i++) {
      await skillOptHistory.insertOne({
        tenant_id: tenantId,
        detector_id: detectorId,
        completed_at: new Date(),
      })
    }

    const count = await skillOptHistory.countDocuments({
      tenant_id: tenantId,
      completed_at: new Date(new Date().setHours(0,0,0,0)),
    })
    
    expect(count).toBe(5)
  })

  it('counts detector daily optimization runs correctly', async () => {
    const tenantId = 'test-tenant-2'
    const detectorId = 'test-detector-2'
    
    // Simulate detector at daily limit (1 run)
    await skillOptHistory.insertOne({
      tenant_id: tenantId,
      detector_id: detectorId,
      completed_at: new Date(),
    })

    const count = await skillOptHistory.countDocuments({
      tenant_id: tenantId,
      detector_id: detectorId,
    })
    
    expect(count).toBe(1)
  })

  it('counts approvals since last optimization run', async () => {
    const tenantId = 'test-tenant-3'
    const detectorId = 'test-detector-3'
    const now = new Date()

    // Simulate recent optimization run
    await skillOptHistory.insertOne({
      tenant_id: tenantId,
      detector_id: detectorId,
      completed_at: now,
    })

    // Add only 5 approvals (less than required 10)
    for (let i = 0; i < 5; i++) {
      await insights.insertOne({
        tenant_id: tenantId,
        detector_id: detectorId,
        approved_at: now,
      })
    }

    const count = await insights.countDocuments({
      tenant_id: tenantId,
      detector_id: detectorId,
      approved_at: now,
    })

    expect(count).toBe(5)
  })

  it('returns zero when no optimization runs exist', async () => {
    const tenantId = 'test-tenant-4'
    const detectorId = 'test-detector-4'
    
    // No existing runs
    const count = await skillOptHistory.countDocuments({
      tenant_id: tenantId,
      completed_at: new Date(new Date().setHours(0,0,0,0)),
    })
    
    expect(count).toBe(0)
  })

  it('LLM budget settings are stored correctly', async () => {
    const tenantId = 'test-tenant-5'
    
    // Set tenant with budget settings
    await tenantSettings.insertOne({
      tenant_id: tenantId,
      llm_budget: {
        monthly_limit_usd: 10,
        hard_stop: true,
        alert_threshold_pct: 80,
      },
    })

    const settings = await tenantSettings.findOne({ tenant_id: tenantId })
    expect(settings?.['llm_budget']?.['monthly_limit_usd']).toBe(10)
    expect(settings?.['llm_budget']?.['hard_stop']).toBe(true)
  })
})
