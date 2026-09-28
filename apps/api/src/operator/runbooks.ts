import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

export interface Runbook {
  what: string
  safe_to_requeue: string
  escalate: string
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
// apps/api/src/operator → repo root is four levels up.
const RUNBOOKS_PATH = path.join(HERE, '../../../../runbooks.yaml')

let cached: Record<string, Runbook> | null = null

/** Load runbooks.yaml once per process — it's operator-facing reference
 *  material, not request-critical data, so a parse failure degrades to an
 *  empty map rather than a 500. */
export function getRunbooks(): Record<string, Runbook> {
  if (cached) return cached
  try {
    const parsed = yaml.load(readFileSync(RUNBOOKS_PATH, 'utf8'))
    cached = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, Runbook>
  } catch {
    cached = {}
  }
  return cached
}
