#!/usr/bin/env node
/**
 * PRD-218/18: print a tagged LifeKeel link for playbook actions.
 *   node scripts/utm-link.mjs --source reddit-personalfinanceuk --medium social \
 *     --campaign playbook --content a01 --path /
 * The token rule MUST stay identical to apps/api/src/marketing/utm.ts —
 * a vitest (post-stats/utm tests) fails if they diverge.
 */
const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const MEDIUMS = new Set(['social', 'email', 'content'])

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [])),
)
const { source, medium, campaign, content } = args
const path = args.path ?? '/'
const base = (args.base ?? 'https://lifekeel.co.uk').replace(/\/$/, '')

for (const [k, v] of Object.entries({ source, medium, campaign }))
  if (!v || !TOKEN.test(v)) {
    console.error(`--${k} must match ${TOKEN}`)
    process.exit(1)
  }
if (!MEDIUMS.has(medium)) {
  console.error(`--medium must be one of ${[...MEDIUMS].join(', ')}`)
  process.exit(1)
}
if (content !== undefined && !TOKEN.test(content)) {
  console.error('--content must match the token rule')
  process.exit(1)
}

const q = new URLSearchParams({
  utm_source: source,
  utm_medium: medium,
  utm_campaign: campaign,
})
if (content) q.set('utm_content', content)
console.log(`${base}${path}?${q}`)
