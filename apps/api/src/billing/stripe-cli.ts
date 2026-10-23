/**
 * CLI for the Stripe reconciler.
 *
 *   pnpm --filter @lifekeel/api stripe:reconcile                 # dry-run, prints the diff
 *   pnpm --filter @lifekeel/api stripe:reconcile --apply          # makes the changes
 *
 * Flags
 *   --apply                     write changes (default is a read-only dry-run)
 *   --api-origin <url>          where the API is served (webhook URL); default $STRIPE_API_ORIGIN / $API_BASE_URL
 *   --app-origin <url>          web app origin (portal return URL); default $LIFEKEEL_URL
 *   --only <a,b>                product,price,webhook,portal
 *   --no-webhook-create         never create the webhook endpoint (it returns a secret)
 *   --webhook-secret-file <p>   when this run creates the endpoint, write its signing
 *                               secret to <p> (mode 0600). It is never printed.
 *   --allow-live                required to --apply against a live key
 *   --json                      machine-readable output
 *
 * Key: $STRIPE_RECONCILE_KEY if set (use a restricted key), else $STRIPE_SECRET_KEY.
 *
 * Exit codes: 0 in sync, 2 drift found (dry-run) , 1 error.
 */
import { writeFileSync } from 'node:fs'
import Stripe from 'stripe'
import { loadStripeConfig } from './stripe-config.js'
import {
  detectStripeMode,
  reconcileStripe,
  type ReconcileObject,
  type ReconcileResult,
  type StripeAdminClient,
} from './stripe-reconcile.js'

interface Args {
  apply: boolean
  json: boolean
  allowLive: boolean
  webhookCreate: boolean
  apiOrigin?: string
  appOrigin?: string
  only?: ReconcileObject[]
  secretFile?: string
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Args {
  const a: Args = {
    apply: false,
    json: false,
    allowLive: false,
    webhookCreate: true,
    apiOrigin: env['STRIPE_API_ORIGIN'] || env['API_BASE_URL'] || undefined,
    appOrigin: env['LIFEKEEL_URL'] || undefined,
  }
  const valid = new Set<ReconcileObject>(['product', 'price', 'webhook', 'portal'])
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (!v) throw new Error(`${f} needs a value`)
      return v
    }
    if (f === '--apply') a.apply = true
    else if (f === '--json') a.json = true
    else if (f === '--allow-live') a.allowLive = true
    else if (f === '--no-webhook-create') a.webhookCreate = false
    else if (f === '--api-origin') a.apiOrigin = next()
    else if (f === '--app-origin') a.appOrigin = next()
    else if (f === '--webhook-secret-file') a.secretFile = next()
    else if (f === '--only') {
      a.only = next()
        .split(',')
        .map((s) => s.trim()) as ReconcileObject[]
      for (const o of a.only) if (!valid.has(o)) throw new Error(`--only: unknown object "${o}"`)
    } else throw new Error(`Unknown argument ${f}`)
  }
  return a
}

export function formatResult(res: ReconcileResult): string {
  const lines = [
    `Stripe mode: ${res.mode}   ${res.applied ? 'APPLIED' : 'dry-run (no changes written)'}`,
  ]
  for (const a of res.actions) {
    const d = a.details.length ? `  (${a.details.join('; ')})` : ''
    lines.push(`  ${a.op.padEnd(8)} ${a.object.padEnd(8)} ${a.key}${d}`)
  }
  for (const e of res.errors) lines.push(`  ERROR    ${e.object.padEnd(8)} ${e.key}: ${e.message}`)
  lines.push(
    res.drift
      ? res.applied
        ? 'Changes were made.'
        : 'Drift found: run with --apply.'
      : 'In sync.',
  )
  if (res.webhookSecret)
    lines.push(
      'A webhook endpoint was created; its signing secret was written to the requested file only.',
    )
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  const args = parseArgs(argv, env)
  const key = env['STRIPE_RECONCILE_KEY'] || env['STRIPE_SECRET_KEY']
  if (!key) {
    console.error('Set STRIPE_RECONCILE_KEY (preferred, restricted) or STRIPE_SECRET_KEY.')
    return 1
  }
  const mode = detectStripeMode(key)
  if (args.apply && mode === 'live' && !args.allowLive) {
    console.error('Refusing to --apply against a LIVE key without --allow-live.')
    return 1
  }
  if (
    args.apply &&
    args.webhookCreate &&
    !args.secretFile &&
    !(args.only && !args.only.includes('webhook'))
  ) {
    console.error(
      '--apply may create the webhook endpoint: pass --webhook-secret-file <path> (or --no-webhook-create).',
    )
    return 1
  }

  const stripe = new Stripe(key) as unknown as StripeAdminClient
  const res = await reconcileStripe(stripe, loadStripeConfig(), key, {
    apply: args.apply,
    apiOrigin: args.apiOrigin,
    appOrigin: args.appOrigin,
    allowWebhookCreate: args.webhookCreate,
    only: args.only,
  })

  if (res.webhookSecret && args.secretFile) {
    writeFileSync(args.secretFile, res.webhookSecret, { mode: 0o600 })
  }
  // Never serialise the secret.
  const safe = {
    ...res,
    webhookSecret: undefined,
    webhookSecretWritten: Boolean(res.webhookSecret && args.secretFile),
  }
  console.log(args.json ? JSON.stringify(safe, null, 2) : formatResult(res))

  if (res.errors.length) return 1
  if (!args.apply && res.drift) return 2
  return 0
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /stripe-cli\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
