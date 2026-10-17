import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Minimal E2E suite against a live dev stack — a real starting point for
 * the "no automated E2E suite" gap, scoped to the flows this session
 * already proved out manually: events readiness, the Ask AI handoff, and
 * life-events prepare. Each run signs up its own disposable tenant
 * (e2e/global-setup.ts) rather than depending on a shared account.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Serialized on purpose: Next dev compiles each route on its first visit
  // this run, and several workers hitting different first-time routes at
  // once produced flaky failures (concurrent-compile contention), not a
  // real app bug — confirmed by the failures changing from run to run.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3002',
    storageState: path.resolve(__dirname, 'e2e/.auth/storage-state.json'),
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @lifekeel/api dev',
      url: 'http://localhost:3001/status',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: path.resolve(__dirname, '../..'),
    },
    {
      command: 'pnpm --filter @lifekeel/web dev',
      url: 'http://localhost:3002',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: path.resolve(__dirname, '../..'),
    },
  ],
})
