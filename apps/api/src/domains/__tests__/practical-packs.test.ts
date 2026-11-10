import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMAINS, getDomain, validateDomains } from '../registry.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..')
const PLAYBOOKS = path.join(ROOT, 'playbooks', 'family')

describe('health, papers and care areas on the family list', () => {
  it('ships the three practical areas beside protection, car and children', () => {
    const ids = DOMAINS.map((d) => d.id)
    for (const id of ['health', 'documents', 'care']) expect(ids, id).toContain(id)
    expect(validateDomains(DOMAINS, PLAYBOOKS)).toEqual([])
  })

  it('holds only what is not sensitive, confirmed by both adults, with no outside access', () => {
    for (const id of ['health', 'documents', 'care']) {
      const d = getDomain(id)!
      expect(d.confirm, id).toBe('both_adults')
      expect(d.external.enabled, id).toBe(false)
      for (const r of d.records) {
        expect(r.source.kind, `${id}.${r.key}`).toBe('store')
        expect(
          r.fields.filter((f) => f.sensitive),
          `${id}.${r.key}`,
        ).toEqual([])
      }
    }
  })

  it('health opens the medical first steps; the others keep to facts and states what is kept where', () => {
    expect(getDomain('health')!.playbook?.playbook).toBe('medical')
    expect(getDomain('documents')!.records[0]!.fields.map((f) => f.key)).toContain('where')
  })

  it('never says what to do, buy or whether anything is enough', () => {
    const text = ['health', 'documents', 'care']
      .map((id) => JSON.stringify(getDomain(id)))
      .join(' ')
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\benough\b|\brecommend/i)
  })
})
