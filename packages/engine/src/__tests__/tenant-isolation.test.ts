import { describe, expect, it, vi } from 'vitest'
import { ScoreCalibrator } from '../calibration.js'
import { IntentClassifier } from '../intent-classifier.js'
import { SkillOptimizer } from '../skill-opt/SkillOptimizer.js'

describe('tenant ML isolation', () => {
  it('keys calibration reads and writes by tenant', async () => {
    const replaceOne = vi.fn(async () => undefined)
    const findOne = vi.fn(async () => null)
    const db = {
      collection: () => ({
        createIndex: vi.fn(async () => undefined),
        replaceOne,
        findOne,
      }),
    }
    const calibrator = new ScoreCalibrator(db)

    await calibrator.fit('tenant-a', 'detector-1', [])
    await calibrator.calibrate('tenant-b', 'detector-1', 0.8)

    const writes = replaceOne.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(writes[0]?.[0]).toEqual({ tenant_id: 'tenant-a', detector_id: 'detector-1' })
    expect(findOne).toHaveBeenCalledWith({ tenant_id: 'tenant-b', detector_id: 'detector-1' })
  })

  it('loads intent centroids only for the requested tenant', async () => {
    const find = vi.fn(() => ({ toArray: async () => [] }))
    const classifier = new IntentClassifier({ db: { collection: () => ({ find }) } })

    await classifier.load('tenant-a')
    expect(find).toHaveBeenCalledWith({ tenant_id: 'tenant-a' })
  })

  it('rejects cross-tenant SkillOptimizer runs', async () => {
    const optimizer = new SkillOptimizer(
      { collection: () => ({}) },
      async () => '',
    )

    await expect(optimizer.run({
      target: 'skill',
      target_id: 'summarize',
      tenant_id: 'all',
    })).rejects.toThrow(/cross-tenant optimization is forbidden/)
  })
})
