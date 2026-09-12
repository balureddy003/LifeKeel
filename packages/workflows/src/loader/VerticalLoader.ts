/**
 * Vertical Loader
 *
 * Loads vertical (template) manifests from verticals/<id>/vertical.yaml and
 * validates them against VerticalSchema. A vertical is pure composition over the
 * shared core — see docs/prd/vertical-template-framework.md.
 *
 * Mirrors OutcomePackLoader. The loader also exposes a lightweight referential
 * check so a vertical that names a detector/pack/goal-template id that doesn't
 * exist fails loudly rather than silently shipping a broken bundle.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { VerticalSchema, type Vertical } from '@kairos/specifications'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'vertical-loader', version: '0.0.0' })

// verticals/<id>/vertical.yaml ships with the deployed code, not edited at
// runtime, so re-parsing all 6 manifests from disk on every call is pure
// waste — kairos-web/kairos-mobile hit /verticals or /verticals/active on
// nearly every screen transition (unlike Studio, which loads it once per
// app-shell mount), and each uncached call took 2-4s here. Cached forever
// per rootDir; a process restart is the only thing that should ever see a
// vertical.yaml edit anyway.
const verticalsCache = new Map<string, Vertical[]>()

/** Repo root to resolve content against; defaults to the process working dir. */
export function loadVerticals(rootDir: string = process.cwd()): Vertical[] {
  const cached = verticalsCache.get(rootDir)
  if (cached) return cached
  const verticals = loadVerticalsUncached(rootDir)
  verticalsCache.set(rootDir, verticals)
  return verticals
}

function loadVerticalsUncached(rootDir: string): Vertical[] {
  const verticalsDir = path.join(rootDir, 'verticals')
  try {
    if (!fs.existsSync(verticalsDir)) {
      log.warn({ path: verticalsDir }, 'Verticals directory not found')
      return []
    }

    const dirs = fs
      .readdirSync(verticalsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())

    const verticals: Vertical[] = []

    for (const dir of dirs) {
      const manifestPath = path.join(verticalsDir, dir.name, 'vertical.yaml')
      if (!fs.existsSync(manifestPath)) {
        log.warn({ dir: dir.name }, 'Vertical directory has no vertical.yaml')
        continue
      }

      const content = fs.readFileSync(manifestPath, 'utf-8')
      const parsed = yaml.load(content) as unknown

      try {
        const validated = VerticalSchema.parse(parsed)
        verticals.push(validated)
        log.debug({ vertical: validated.id }, 'Loaded vertical')
      } catch (err) {
        log.error({ dir: dir.name, error: err }, 'Failed to validate vertical schema')
      }
    }

    log.info({ count: verticals.length }, 'Loaded verticals')
    return verticals
  } catch (err) {
    log.error({ error: err }, 'Failed to load verticals')
    return []
  }
}

export function loadVertical(id: string, rootDir: string = process.cwd()): Vertical | null {
  return loadVerticals(rootDir).find((v) => v.id === id) ?? null
}

/**
 * Referential-integrity check for a vertical: verify every content id it
 * references actually resolves against the flat content directories. Returns the
 * list of missing references (empty === healthy). Cheap enough to run in CI.
 */
export function checkVerticalReferences(vertical: Vertical, rootDir: string = process.cwd()): string[] {
  const missing: string[] = []

  const detectorIds = collectYamlIds(path.join(rootDir, 'detectors'))
  const packIds = collectYamlIds(path.join(rootDir, 'definitions', 'outcome-packs'))
  const connectorIds = collectConnectorIds(path.join(rootDir, 'connectors'))
  const goalTemplateIds = collectYamlIds(path.join(rootDir, 'definitions', 'goal-templates'))

  for (const d of vertical.detectors) {
    if (!detectorIds.has(d)) missing.push(`detector:${d}`)
  }
  for (const p of vertical.outcome_packs) {
    if (!packIds.has(p)) missing.push(`outcome_pack:${p}`)
  }
  for (const c of [...vertical.required_connectors, ...vertical.optional_connectors]) {
    if (!connectorIds.has(c)) missing.push(`connector:${c}`)
  }
  for (const g of vertical.goal_templates) {
    if (!goalTemplateIds.has(g)) missing.push(`goal_template:${g}`)
  }

  return missing
}

/**
 * Reverse of checkVerticalReferences: finds outcome packs and goal templates
 * that exist in content but aren't claimed by any shipped vertical. Content
 * an old flow (onboarding, goal quick-create) can still surface directly by
 * id even when orphaned, so this doesn't mean the content is broken — it
 * means no vertical's activation/theming/personalization applies to it,
 * which is worth knowing deliberately rather than discovering by accident.
 */
export function findOrphanedContent(rootDir: string = process.cwd()): { outcome_packs: string[]; goal_templates: string[] } {
  const verticals = loadVerticals(rootDir)
  const claimedPacks = new Set(verticals.flatMap((v) => v.outcome_packs))
  const claimedTemplates = new Set(verticals.flatMap((v) => v.goal_templates))

  const allPacks = collectYamlIds(path.join(rootDir, 'definitions', 'outcome-packs'))
  const allTemplates = collectYamlIds(path.join(rootDir, 'definitions', 'goal-templates'))

  return {
    outcome_packs: [...allPacks].filter((id) => !claimedPacks.has(id)).sort(),
    goal_templates: [...allTemplates].filter((id) => !claimedTemplates.has(id)).sort(),
  }
}

/**
 * A persona with no primary_goal_templates is a documented job-to-be-done
 * with nothing in the product for that user to actually start with — a dead
 * end in the onboarding flow that the schema alone won't catch, since an
 * empty array is perfectly valid per PersonaSchema.
 */
export function findThinPersonas(vertical: Vertical): string[] {
  return vertical.personas
    .filter((p) => p.primary_goal_templates.length === 0)
    .map((p) => `${vertical.id}:${p.id}`)
}

/** Collect `id:` fields from every YAML under a directory tree. */
function collectYamlIds(root: string): Set<string> {
  const ids = new Set<string>()
  if (!fs.existsSync(root)) return ids
  for (const file of walkYaml(root)) {
    const parsed = yaml.load(fs.readFileSync(file, 'utf-8')) as { id?: string } | null
    if (parsed?.id) ids.add(parsed.id)
  }
  return ids
}

/** Connectors live as flat <id>.yaml files (with optional per-connector dirs). */
function collectConnectorIds(root: string): Set<string> {
  const ids = new Set<string>()
  if (!fs.existsSync(root)) return ids
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
    const parsed = yaml.load(fs.readFileSync(path.join(root, file), 'utf-8')) as { id?: string } | null
    if (parsed?.id) ids.add(parsed.id)
  }
  return ids
}

function walkYaml(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkYaml(full))
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) out.push(full)
  }
  return out
}
