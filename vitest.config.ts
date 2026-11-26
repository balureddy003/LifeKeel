import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    // mongodb-memory-server cold-starts (binary download + first mongod
    // launch) can exceed the 10s default on a fresh CI runner — the binary
    // caches per-job, so only the first create() in a suite pays this.
    hookTimeout: 60_000,
    // The full turbo run builds and tests every package at once; under that load route tests that
    // boot Fastify (operator, support, billing) and the real-MongoDB index test passed alone but
    // missed vitest's 5s default, failing runs for no fault in the code. A genuinely hung test
    // still fails, just later.
    testTimeout: 20_000,
  },
})
