import { describe, expect, it } from 'vitest'
import { PromptVersionRegistry, type PromptEvalResult } from '../index.js'

function memoryDb() {
  const stores = new Map<string, Record<string, any>[]>()
  return {
    collection(name: string) {
      const docs = stores.get(name) ?? []
      stores.set(name, docs)
      return {
        createIndex: async () => '',
        insertOne: async (doc: Record<string, any>) => { docs.push(doc) },
        findOne: async (filter: Record<string, any>) => docs.find(doc => matches(doc, filter)) ?? null,
        find: (filter: Record<string, any>) => ({
          sort: () => ({ toArray: async () => docs.filter(doc => matches(doc, filter)) }),
        }),
        updateOne: async (filter: Record<string, any>, update: Record<string, any>) => {
          const doc = docs.find(item => matches(item, filter))
          if (doc && update.$set) Object.assign(doc, update.$set)
          if (doc && update.$push) {
            for (const [key, value] of Object.entries(update.$push)) (doc[key] ??= []).push(value)
          }
        },
        updateMany: async (filter: Record<string, any>, update: Record<string, any>) => {
          docs.filter(doc => matches(doc, filter)).forEach(doc => Object.assign(doc, update.$set ?? {}))
        },
      }
    },
  }
}

function matches(doc: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = key.split('.').reduce<any>((current, part) => current?.[part], doc)
    return typeof value === 'object' && value !== null && '$in' in value
      ? value.$in.includes(actual)
      : actual === value
  })
}

const passingEval: PromptEvalResult = {
  run_id: 'eval-1',
  dataset: 'golden',
  f1: 0.9,
  precision: 0.9,
  recall: 0.9,
  judge_quality_score: 0.9,
  p95_latency_ms: 100,
  cost_per_call_usd: 0.001,
  ran_at: new Date(),
}

describe('PromptVersionRegistry', () => {
  it('requires A/B and judge gates before production promotion', async () => {
    const registry = new PromptVersionRegistry(memoryDb())
    const candidate = await registry.createCandidate({
      template: 'Prompt',
      author: 'test',
      metadata: { detector_id: 'invoice', call_type: 'enrichment' },
    })
    await expect(registry.promote(candidate.id)).rejects.toThrow('A/B')
    await registry.startAbTest(candidate.id)
    await registry.addEval(candidate.id, passingEval)
    expect((await registry.promote(candidate.id)).status).toBe('production')
  })

  it('rejects candidates below the judge quality threshold', async () => {
    const registry = new PromptVersionRegistry(memoryDb())
    const candidate = await registry.createCandidate({
      template: 'Prompt',
      author: 'test',
      metadata: { skill_id: 'summary', call_type: 'summary' },
    })
    await registry.startAbTest(candidate.id)
    await registry.addEval(candidate.id, { ...passingEval, judge_quality_score: 0.79 })
    await expect(registry.promote(candidate.id)).rejects.toThrow('judge quality')
  })
})
