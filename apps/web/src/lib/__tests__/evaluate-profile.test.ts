import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateSavedProfile } from '../evaluate-profile'

beforeEach(() => vi.restoreAllMocks())

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

describe('evaluateSavedProfile', () => {
  it('returns the number of insights generated', async () => {
    const spy = respond(200, { ok: true, insights_generated: 3 })
    expect(await evaluateSavedProfile()).toBe(3)
    expect(String(spy.mock.calls[0]![0])).toContain('/family/financial-profile/evaluate')
  })

  it('explains an incomplete saved profile (422) in plain language', async () => {
    respond(422, { error: 'Saved profile is incomplete' })
    await expect(evaluateSavedProfile()).rejects.toThrow(/missing some required numbers/)
  })

  it('surfaces the server error otherwise', async () => {
    respond(404, { error: 'No financial profile on file yet' })
    await expect(evaluateSavedProfile()).rejects.toThrow('No financial profile on file yet')
  })
})
