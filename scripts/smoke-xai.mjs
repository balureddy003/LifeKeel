// xAI Grok provider smoke test — exercises the real router path end to end:
//   env key → createLlmRouterFromEnv → providerOverride('xai') → callXai
//   → api.x.ai → response + usage accounting
// Run: node --env-file=.env scripts/smoke-xai.mjs
// Requires XAI_API_KEY in .env (gitignored — never paste it anywhere else).
// IMPORTANT: xAI's DPA requires ZDR for Personal Data — enable Zero Data
// Retention in xAI Console → Team Settings before routing governed tasks
// here. This smoke test sends no personal data, so it is safe either way.

import { createLlmRouterFromEnv, detectActiveProvider } from '../packages/platform/dist/index.js'

if (!process.env['XAI_API_KEY']) {
  console.error('XAI_API_KEY is not set — put it in .env first')
  process.exit(1)
}

console.log('detectActiveProvider() →', detectActiveProvider())

const usages = []
// Mirrors the task-gateway's wiring: runtime override via the accessor seam.
const router = createLlmRouterFromEnv({
  providerOverride: () => 'xai',
  onUsage: (u) => usages.push(u),
})

console.log('calling tier:fast …')
const t0 = Date.now()
const out = await router(
  'You are a terse assistant. Reply with exactly one short sentence.',
  'What is 2+2? Answer with the number only.',
  'tier:fast',
)
console.log(`response (${Date.now() - t0}ms):`, out)
console.log('usage:', usages)

console.log('\ncalling tier:powerful …')
const t1 = Date.now()
const out2 = await router(
  'You are a terse assistant. Reply with exactly one short sentence.',
  'Name one primary colour.',
  'tier:powerful',
)
console.log(`response (${Date.now() - t1}ms):`, out2)
console.log('usage:', usages)

if (!out || !out2 || usages.length < 2) {
  console.error('\nFAIL: empty response or missing usage rows')
  process.exit(1)
}
if (!usages.every((u) => u.provider === 'xai')) {
  console.error('\nFAIL: usage rows not attributed to xai', usages)
  process.exit(1)
}
console.log('\nPASS — xAI routed via override, responses + usage returned')
