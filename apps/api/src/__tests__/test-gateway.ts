/**
 * Shared test helper — initialise the AI task gateway with the real registry.
 * Call once at module top in tests whose code path reaches taskLlm/taskDecide/
 * taskVision; it runs after the file's vi.mock declarations, so a mocked
 * createLlmRouterFromEnv still becomes the governed call's base fn.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { parseTaskRegistry, repoRoot } from '@lifekeel/platform'
import { initTaskGatewayForTests } from '../ai/task-gateway.js'

export function initTestGateway(): void {
  initTaskGatewayForTests(
    parseTaskRegistry(
      loadYaml(readFileSync(join(repoRoot(), 'definitions', 'ai-tasks.yaml'), 'utf8')),
    ),
  )
}
