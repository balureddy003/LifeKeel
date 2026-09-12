/**
 * Outcome Pack Loader
 * 
 * Loads outcome pack definitions from YAML files in definitions/outcome-packs/
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { OutcomePackSchema, type OutcomePack } from '@agentoak/specifications'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'outcome-pack-loader', version: '0.0.0' })

/**
 * rootDir defaults to process.cwd() for backwards compatibility, but that is
 * wrong in the real dev/prod run: turborepo/pnpm workspace scripts execute
 * with cwd = the package's own directory (apps/api/), not the repo root, so
 * the default silently returned an empty pack list — reproduced live via the
 * onboarding outcome-selection screen (GET /outcome-packs returned 0 packs).
 * See apps/api/src/routes/verticals.ts's repoRoot() for the same fix applied
 * to loadVerticals(); callers should resolve and pass the real repo root the
 * same way.
 */
export function loadOutcomePacks(rootDir: string = process.cwd()): OutcomePack[] {
  const packsDir = path.join(rootDir, 'definitions', 'outcome-packs')
  try {
    if (!fs.existsSync(packsDir)) {
      log.warn({ path: packsDir }, 'Outcome packs directory not found')
      return []
    }

    const files = fs.readdirSync(packsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    const packs: OutcomePack[] = []

    for (const file of files) {
      const filePath = path.join(packsDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = yaml.load(content) as unknown

      try {
        const validated = OutcomePackSchema.parse(parsed)
        packs.push(validated)
        log.debug({ pack: validated.id }, 'Loaded outcome pack')
      } catch (err) {
        log.error({ file, error: err }, 'Failed to validate outcome pack schema')
      }
    }

    log.info({ count: packs.length }, 'Loaded outcome packs')
    return packs
  } catch (err) {
    log.error({ error: err }, 'Failed to load outcome packs')
    return []
  }
}

export function loadOutcomePack(id: string, rootDir: string = process.cwd()): OutcomePack | null {
  const packs = loadOutcomePacks(rootDir)
  return packs.find(p => p.id === id) ?? null
}
