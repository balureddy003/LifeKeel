import fs from 'node:fs'
import path from 'node:path'
import { DomainPackSchema, type DomainPack } from './types.js'
import { car } from './packs/car.js'
import { children } from './packs/children.js'
import { lifeProtection } from './packs/life-protection.js'

/**
 * Every pack the product ships. Adding a domain means adding a manifest here;
 * registry.test.ts then checks it against the contract and the cross-references.
 */
const RAW: unknown[] = [lifeProtection, car, children]

export const DOMAINS: readonly DomainPack[] = RAW.map((p) => DomainPackSchema.parse(p))

export function getDomain(id: string): DomainPack | undefined {
  return DOMAINS.find((d) => d.id === id)
}

/**
 * Cross-reference problems the schema cannot see. Returned, not thrown, so the
 * fitness test can name every problem at once.
 */
export function validateDomains(domains: readonly DomainPack[], playbookDir: string): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const d of domains) {
    if (ids.has(d.id)) problems.push(`${d.id}: duplicate domain id`)
    ids.add(d.id)
    const recs = new Map(d.records.map((r) => [r.key, r]))
    if (recs.size !== d.records.length) problems.push(`${d.id}: duplicate record key`)
    for (const r of d.records) {
      const keys = new Set(r.fields.map((f) => f.key))
      if (keys.size !== r.fields.length) problems.push(`${d.id}.${r.key}: duplicate field key`)
      if (r.identity) {
        const idf = r.fields.find((f) => f.key === r.identity)
        if (!idf) problems.push(`${d.id}.${r.key}: identity names unknown field ${r.identity}`)
        else if (idf.kind !== 'text')
          problems.push(`${d.id}.${r.key}: identity field ${r.identity} must be a text field`)
        if (r.source.kind !== 'store')
          problems.push(`${d.id}.${r.key}: identity only applies to stored records`)
      }
      for (const f of r.fields) {
        if (f.sensitive && r.source.kind === 'store')
          problems.push(
            `${d.id}.${r.key}.${f.key}: a stored record cannot hold a sensitive field until it is encrypted`,
          )
        if (f.kind === 'choice' && !f.choices?.length)
          problems.push(`${d.id}.${r.key}.${f.key}: choice field needs choices`)
      }
    }
    if (d.matrix && !recs.has(d.matrix.record))
      problems.push(`${d.id}: matrix names unknown record ${d.matrix.record}`)
    if (d.playbook) {
      if (!fs.existsSync(path.join(playbookDir, `${d.playbook.playbook}.yaml`)))
        problems.push(`${d.id}: playbook ${d.playbook.playbook}.yaml not found`)
      for (const k of d.playbook.show_records)
        if (!recs.has(k)) problems.push(`${d.id}: playbook shows unknown record ${k}`)
    }
    for (const t of d.planning) {
      if (t.on.kind !== 'date_field') continue
      const { record, field } = t.on
      const rec = recs.get(record)
      if (!rec) problems.push(`${d.id}: trigger ${t.key} names unknown record`)
      else if (!rec.fields.some((f) => f.key === field && f.kind === 'date'))
        problems.push(`${d.id}: trigger ${t.key} field is not a date field`)
    }
    for (const [rk, fk] of Object.entries(d.external.permitted)) {
      const rec = recs.get(rk)
      if (!rec) problems.push(`${d.id}: external names unknown record ${rk}`)
      else
        for (const f of fk) {
          const field = rec.fields.find((x) => x.key === f)
          if (!field) problems.push(`${d.id}.${rk}: external names unknown field ${f}`)
          else if (field.sensitive)
            problems.push(`${d.id}.${rk}.${f}: a sensitive field cannot be externally visible`)
        }
    }
  }
  return problems
}
