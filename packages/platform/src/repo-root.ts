/**
 * Resolve the monorepo root from any process cwd.
 *
 * turborepo/pnpm workspace scripts execute with cwd = the package's own
 * directory (e.g. apps/api/), not the repo root — so anything that reads
 * content from repo-root-relative paths (definitions/, verticals/,
 * detectors/, connectors/) via `process.cwd()` silently sees nothing in the
 * real dev/prod run. This was found and fixed twice independently this
 * session (VerticalLoader, OutcomePackLoader) before being extracted here —
 * new loaders should call this instead of adding a third copy.
 */
import * as fs from 'fs'
import * as path from 'path'

export function repoRoot(startDir: string = process.cwd()): string {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}
