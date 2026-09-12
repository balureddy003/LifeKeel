/**
 * Connector Loader
 *
 * Loads and validates connector YAML definitions from a directory.
 * Connectors are defined in YAML — no code needed for new integrations.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { ConnectorConfigSchema, type ConnectorConfig } from './schemas.js'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'connector-loader', version: '0.0.0' })

export class ConnectorLoader {
  private connectors: Map<string, ConnectorConfig> = new Map()

  async load(connectorsDir: string): Promise<void> {
    const files = await this.findYamlFiles(connectorsDir)

    for (const file of files) {
      try {
        const raw = await fs.readFile(file, 'utf-8')
        const parsed = yaml.load(raw)
        const config = ConnectorConfigSchema.parse(parsed)
        this.connectors.set(config.id, config)
      } catch (err) {
        log.warn({ file, err }, 'Failed to load connector')
      }
    }
  }

  get(connectorId: string): ConnectorConfig | undefined {
    return this.connectors.get(connectorId)
  }

  getOrThrow(connectorId: string): ConnectorConfig {
    const connector = this.connectors.get(connectorId)
    if (!connector) throw new Error(`Connector not found: ${connectorId}`)
    return connector
  }

  list(): ConnectorConfig[] {
    return [...this.connectors.values()]
  }

  get count(): number {
    return this.connectors.size
  }

  private async findYamlFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...(await this.findYamlFiles(fullPath)))
        } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          results.push(fullPath)
        }
      }
    } catch { /* dir not found */ }
    return results
  }
}
