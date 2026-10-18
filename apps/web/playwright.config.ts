import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Minimal E2E suite against a live dev stack — a real starting point for
 * the "no automated E2E suite" gap, scoped to the flows this session
 * already proved out manually: events readiness, the Ask AI handoff, and
 * life-events prepare. Each run signs up its own disposable tenant
 * (e2e/global-setup.ts) rather than depending on a shared account.
 */
// Point E2E_WEB_BASE (and E2E_API_BASE, read by global-setup) at a deployed
// stack — e.g. https://app.lifekeel.si — to run the same suite against it;
// the local dev servers are only started when it is unset.
const WEB_BASE = process.env['E2E_WEB_BASE'] ?? 'http://localhost:3002'
const DEVICE_SPECS = /(anonymous-check|save-result|logout-purge|responsive)\.spec\.ts$/
const useLocalStack = !process.env['E2E_WEB_BASE']

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
    baseURL: WEB_BASE,
    storageState: path.resolve(__dirname, 'e2e/.auth/storage-state.json'),
    trace: 'retain-on-failure',
  },
  // Device matrix. Most users are on iOS Safari, so three of the five run on
  // WebKit. Install engines once with: pnpm exec playwright install chromium webkit
  // chromium-desktop runs every spec; the other four run only the
  // device-agnostic specs below, so the older feature specs aren't run 5x.
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-desktop', testMatch: DEVICE_SPECS, use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', testMatch: DEVICE_SPECS, use: { ...devices['iPhone 14'] } },
    { name: 'android', testMatch: DEVICE_SPECS, use: { ...devices['Pixel 7'] } },
    { name: 'ipad', testMatch: DEVICE_SPECS, use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: !useLocalStack
    ? []
    : [
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
