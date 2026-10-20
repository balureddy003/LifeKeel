#!/usr/bin/env node
// Public pages must carry their real text in the static HTML (PRD-210, phase 1).
//
// The app shell used to render a loading skeleton until the browser finished its sign-in check, so
// the HTML a search engine fetches held "Skip to content" and nothing else. This fails when a public
// page's prerendered HTML has no real text, or lacks a phrase it must contain.
//
//   node scripts/check-public-html.mjs [--next apps/web/.next | out-dir]
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const nextMode = args[0] === '--next'
if (nextMode) args.shift()
const dir = args[0] ?? (nextMode ? 'apps/web/.next' : 'apps/web/out')

// [route, phrase that must be in the visible text, minimum visible characters]
const PAGES = [
  ['/', 'kept current', 3000],
  ['/guides', 'guides', 1000],
  ['/terms', 'Terms of Service', 2000],
  ['/privacy', 'Privacy', 2000],
  ['/support', 'Support', 800],
]

function htmlFor(route) {
  const rel = route === '/' ? 'index' : route.replace(/^\//, '')
  const candidates = nextMode
    ? [path.join(dir, 'server/app', `${rel}.html`)]
    : [path.join(dir, rel, 'index.html'), path.join(dir, `${rel}.html`)]
  const f = candidates.find((c) => existsSync(c))
  if (!f) throw new Error(`no prerendered HTML for ${route} (looked in ${candidates.join(', ')})`)
  return readFileSync(f, 'utf8')
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
}

let failed = false
for (const [route, phrase, min] of PAGES) {
  let text
  try {
    text = visibleText(htmlFor(route))
  } catch (e) {
    console.error(`FAIL ${route}: ${e.message}`)
    failed = true
    continue
  }
  const problems = []
  if (text.length < min) problems.push(`only ${text.length} characters of text (need ${min})`)
  if (!text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`missing "${phrase}"`)
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${route}  ${text.length} chars${problems.length ? '  ' + problems.join('; ') : ''}`)
  if (problems.length) failed = true
}
if (failed) process.exit(1)
