/**
 * Operator console: Billing setup (Stripe configuration as code).
 *
 *   GET  /operator/billing/stripe              status + dry-run diff + webhook health
 *   POST /operator/billing/stripe/reconcile    dry-run (default) or apply
 *
 * Scope is deliberately narrower than the CLI:
 *  - operators can reconcile product, price and portal; they can NOT create the
 *    webhook endpoint, because Stripe returns its signing secret exactly once
 *    and it belongs in Secret Manager (`./scripts/provision-infra.sh stripe`),
 *    not in a browser. A missing endpoint is reported, not created.
 *  - applying needs step-up auth, a written reason, and an audit entry;
 *  - replacing a live price (what new subscribers pay) needs an explicit
 *    confirm_price_change, and live mode needs confirm_live;
 *  - nothing here moves money. No keys are ever returned.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import Stripe from 'stripe'
import { z } from 'zod'
import { requireOperator } from '../operator/operator-auth.js'
import { OperatorAuditLogger } from '../operator/operator-audit.js'
import { loadStripeConfig, type StripeConfig } from '../billing/stripe-config.js'
import {
  detectStripeMode,
  reconcileStripe,
  type ReconcileResult,
  type StripeAdminClient,
} from '../billing/stripe-reconcile.js'

export interface OperatorStripeOptions {
  /** Tests inject these; production builds them from the environment. */
  stripe?: StripeAdminClient | null
  apiKey?: string
  config?: StripeConfig
  apiOrigin?: string
  appOrigin?: string
}

const ReconcileBody = z.object({
  reason: z.string().trim().min(8, 'Give a reason of at least 8 characters').max(500),
  apply: z.boolean().default(false),
  confirm_live: z.boolean().default(false),
  confirm_price_change: z.boolean().default(false),
})

function keyKind(key: string | undefined): 'restricted' | 'secret' | 'none' {
  if (!key) return 'none'
  return key.startsWith('rk_') ? 'restricted' : 'secret'
}

/** What the browser needs to see: no secrets, no raw Stripe payloads. */
function publicResult(res: ReconcileResult) {
  return {
    mode: res.mode,
    applied: res.applied,
    drift: res.drift,
    actions: res.actions,
    errors: res.errors,
    ids: res.ids,
  }
}

export function registerOperatorStripeRoutes(
  app: FastifyInstance,
  db: Db,
  opts: OperatorStripeOptions = {},
): void {
  const audit = new OperatorAuditLogger(db)

  const apiKey =
    opts.apiKey ?? (process.env['STRIPE_RECONCILE_KEY'] || process.env['STRIPE_SECRET_KEY'])
  const client: StripeAdminClient | null =
    opts.stripe !== undefined
      ? opts.stripe
      : apiKey
        ? (new Stripe(apiKey) as unknown as StripeAdminClient)
        : null
  const origins = () => ({
    apiOrigin: opts.apiOrigin ?? process.env['STRIPE_API_ORIGIN'] ?? process.env['API_BASE_URL'],
    appOrigin: opts.appOrigin ?? process.env['LIFEKEEL_URL'],
  })
  const loadConfig = (): StripeConfig => opts.config ?? loadStripeConfig()

  async function webhookHealth() {
    const col = db.collection('stripe_webhook_events')
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [last, completed, failed, recentFailed] = await Promise.all([
      col.find({}).sort({ processed_at: -1 }).limit(1).toArray(),
      col.countDocuments({ status: 'completed', processed_at: { $gte: since } }),
      col.countDocuments({ status: 'failed', processed_at: { $gte: since } }),
      col
        .find(
          { status: 'failed' },
          { projection: { _id: 0, event_id: 1, event_type: 1, failed_at: 1, error: 1 } },
        )
        .sort({ failed_at: -1 })
        .limit(5)
        .toArray(),
    ])
    return {
      last_event_at: (last[0]?.['processed_at'] as Date | undefined) ?? null,
      last_event_type: (last[0]?.['event_type'] as string | undefined) ?? null,
      completed_24h: completed,
      failed_24h: failed,
      recent_failures: recentFailed,
    }
  }

  app.get(
    '/operator/billing/stripe',
    { preHandler: requireOperator(db, 'billing.read') },
    async (_req, reply) => {
      const mode = detectStripeMode(apiKey)
      const base = {
        configured: Boolean(client),
        mode,
        key_kind: keyKind(apiKey),
        // A full secret key can do far more than this page needs.
        key_warning:
          keyKind(apiKey) === 'secret'
            ? 'A full secret key is in use. Create a restricted key (products, prices, webhook endpoints, customer portal) and set STRIPE_RECONCILE_KEY.'
            : null,
        webhook: await webhookHealth(),
      }
      if (!client) return { ...base, reconcile: null }
      try {
        const res = await reconcileStripe(client, loadConfig(), apiKey, {
          apply: false,
          ...origins(),
          allowWebhookCreate: false,
        })
        return { ...base, reconcile: publicResult(res) }
      } catch (err) {
        app.log.error(err)
        return reply.status(502).send({ ...base, error: 'Could not read Stripe', reconcile: null })
      }
    },
  )

  app.post(
    '/operator/billing/stripe/reconcile',
    { preHandler: requireOperator(db, 'billing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReconcileBody.safeParse(request.body ?? {})
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      const { reason, apply, confirm_live, confirm_price_change } = parsed.data
      if (!client) return reply.status(501).send({ error: 'Stripe is not configured on this API' })

      const mode = detectStripeMode(apiKey)
      if (apply && mode === 'live' && !confirm_live) {
        return reply
          .status(409)
          .send({
            error: 'This is a LIVE Stripe account. Re-send with confirm_live: true.',
            code: 'confirm_live_required',
          })
      }
      if (apply && mode === 'unknown') {
        return reply
          .status(409)
          .send({ error: 'Cannot tell whether the Stripe key is test or live; refusing to apply.' })
      }

      const run = (doApply: boolean) =>
        reconcileStripe(client, loadConfig(), apiKey, {
          apply: doApply,
          ...origins(),
          allowWebhookCreate: false,
          only: ['product', 'price', 'portal'],
        })

      let res: ReconcileResult
      try {
        // Always plan first: a price replacement must be confirmed on sight.
        res = await run(false)
        if (apply) {
          const replacing = res.actions.some((a) => a.object === 'price' && a.op === 'replace')
          if (replacing && !confirm_price_change) {
            return reply.status(409).send({
              error:
                'This changes the price new subscribers pay. Review the diff, then re-send with confirm_price_change: true.',
              code: 'confirm_price_change_required',
              reconcile: publicResult(res),
            })
          }
          res = await run(true)
        }
      } catch (err) {
        app.log.error(err)
        return reply.status(502).send({ error: 'Stripe request failed' })
      }

      await audit.log(
        request,
        'operator.billing.stripe_reconcile',
        'stripe_account',
        mode,
        reason,
        {
          applied: res.applied,
          drift: res.drift,
          // object/op/key only: no prices' amounts, no secrets.
          changes: res.actions
            .filter((a) => a.op !== 'noop')
            .map((a) => `${a.op}:${a.object}:${a.key}`),
          errors: res.errors.length,
        },
      )
      return publicResult(res)
    },
  )
}
