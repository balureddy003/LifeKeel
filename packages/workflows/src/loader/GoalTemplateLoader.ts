/**
 * Goal Template Loader
 *
 * Loads goal template definitions from YAML files in definitions/goal-templates/.
 * Mirrors OutcomePackLoader/VerticalLoader — rootDir must be resolved via
 * repoRoot() by the caller since these paths are repo-root-relative, not
 * relative to process.cwd() (see packages/platform/src/repo-root.ts).
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { GoalTemplateSchema, type GoalTemplate } from '@agentoak/specifications'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'goal-template-loader', version: '0.0.0' })

export function loadGoalTemplates(rootDir: string = process.cwd()): GoalTemplate[] {
  const templatesDir = path.join(rootDir, 'definitions', 'goal-templates')
  try {
    if (!fs.existsSync(templatesDir)) {
      log.warn({ path: templatesDir }, 'Goal templates directory not found')
      return []
    }

    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    const templates: GoalTemplate[] = []

    for (const file of files) {
      const filePath = path.join(templatesDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = yaml.load(content) as unknown

      try {
        const validated = GoalTemplateSchema.parse(parsed)
        templates.push(validated)
        log.debug({ template: validated.id }, 'Loaded goal template')
      } catch (err) {
        log.error({ file, error: err }, 'Failed to validate goal template schema')
      }
    }

    log.info({ count: templates.length }, 'Loaded goal templates')
    return templates
  } catch (err) {
    log.error({ error: err }, 'Failed to load goal templates')
    return []
  }
}

export function loadGoalTemplate(id: string, rootDir: string = process.cwd()): GoalTemplate | null {
  return loadGoalTemplates(rootDir).find(t => t.id === id) ?? null
}
