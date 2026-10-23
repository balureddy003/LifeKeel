// Groq provider smoke test — exercises the real router path end to end:
//   env key → createLlmRouterFromEnv → providerOverride('groq') → callGroq
//   → api.groq.com → response + usage accounting
// Run: node --env-file=.env scripts/smoke-groq.mjs
// Requires GROQ_API_KEY in .env (gitignored — never paste it anywhere else).

import { createLlmRouterFromEnv, detectActiveProvider } from '../packages/platform/dist/index.js'

if (!process.env['GROQ_API_KEY']) {
  console.error('GROQ_API_KEY is not set — put it in .env first')
  process.exit(1)
}

console.log('detectActiveProvider() →', detectActiveProvider())

const usages = []
// Mirrors the task-gateway's wiring: runtime override via the accessor seam.
const router = createLlmRouterFromEnv({
  providerOverride: () => 'groq',
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

console.log('\ncalling tier:balanced …')
const t1 = Date.now()
const out2 = await router(
  'You are a terse assistant. Reply with exactly one short sentence.',
  'Name one primary colour.',
  'tier:balanced',
)
console.log(`response (${Date.now() - t1}ms):`, out2)
console.log('usage:', usages)

if (!out || !out2 || usages.length < 2) {
  console.error('\nFAIL: empty response or missing usage rows')
  process.exit(1)
}
if (!usages.every((u) => u.provider === 'groq')) {
  console.error('\nFAIL: usage rows not attributed to groq', usages)
  process.exit(1)
}
console.log('\nPASS — Groq routed via override, responses + usage returned')
