import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    // mongodb-memory-server cold-starts (binary download + first mongod
    // launch) can exceed the 10s default on a fresh CI runner — the binary
    // caches per-job, so only the first create() in a suite pays this.
    hookTimeout: 60_000,
  },
})
