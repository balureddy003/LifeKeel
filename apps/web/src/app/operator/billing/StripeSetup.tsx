'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchStripeSetup,
  reconcileStripeSetup,
  StripeSetupConfirmError,
  type StripeSetupAction,
  type StripeSetupStatus,
} from '@/lib/api'

const OP_STYLE: Record<StripeSetupAction['op'], string> = {
  noop: 'text-ink-tertiary',
  skipped: 'text-warning',
  create: 'text-family-400',
  update: 'text-family-400',
  replace: 'text-danger',
}

const OP_LABEL: Record<StripeSetupAction['op'], string> = {
  noop: 'in sync',
  skipped: 'needs infra',
  create: 'will create',
  update: 'will update',
  replace: 'will replace',
}

const OBJECT_LABEL: Record<StripeSetupAction['object'], string> = {
  product: 'Product',
  price: 'Price',
  webhook: 'Webhook endpoint',
  portal: 'Customer portal',
}

/**
 * Billing setup: shows whether Stripe matches definitions/stripe-config.yaml and
 * lets an operator fix product / price / portal drift without opening the
 * Stripe Dashboard. The webhook endpoint is reported, never created here: its
 * signing secret is shown by Stripe once and must go to Secret Manager.
 */
export function StripeSetup() {
  const toast = useToast()
  const [status, setStatus] = useState<StripeSetupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confirmLive, setConfirmLive] = useState(false)
  const [confirmPrice, setConfirmPrice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    fetchStripeSetup()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load Stripe status'))
  }, [])

  useEffect(load, [load])

  const actions = status?.reconcile?.actions ?? []
  const fixable = actions.filter(
    (a) => a.object !== 'webhook' && a.op !== 'noop' && a.op !== 'skipped',
  )
  const priceReplace = actions.some((a) => a.object === 'price' && a.op === 'replace')
  const webhookMissing = actions.some((a) => a.object === 'webhook' && a.op === 'skipped')
  const live = status?.mode === 'live'

  async function apply(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setBusy(true)
    try {
      await reconcileStripeSetup({
        reason: reason.trim(),
        apply: true,
        confirm_live: confirmLive,
        confirm_price_change: confirmPrice,
      })
      toast({ message: 'Stripe now matches the configuration' })
      setReason('')
      setConfirmLive(false)
      setConfirmPrice(false)
      load()
    } catch (err) {
      setFormError(
        err instanceof StripeSetupConfirmError || err instanceof Error
          ? err.message
          : 'Apply failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const input =
    'glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40'

  return (
    <GlassCard className="mt-5 p-4">
      <div className="flex items-center justify-between" data-testid="stripe-setup">
        <h2 className="font-semibold">Billing setup</h2>
        <Settings2 size={18} className="text-family-400" />
      </div>
      <p className="mt-1 text-xs text-ink-tertiary">
        Whether Stripe matches <code>definitions/stripe-config.yaml</code>. Product, price and
        portal can be fixed here; the webhook endpoint is created from infrastructure because Stripe
        shows its signing secret only once.
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {!status && !error && <p className="mt-3 text-sm text-ink-tertiary">Checking Stripe…</p>}

      {status && !status.configured && (
        <p className="mt-3 text-sm text-ink-secondary">
          Stripe is not configured on this API. Set <code>STRIPE_RECONCILE_KEY</code> (a restricted
          key) and redeploy.
        </p>
      )}

      {status?.configured && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${live ? 'bg-danger/15 text-danger' : 'bg-family-500/15 text-family-400'}`}
              data-testid="stripe-mode"
            >
              {status.mode === 'live' ? 'LIVE' : status.mode === 'test' ? 'TEST' : 'UNKNOWN KEY'}
            </span>
            <span className="text-ink-tertiary">{status.key_kind} key</span>
          </div>
          {status.key_warning && <p className="mt-2 text-xs text-warning">{status.key_warning}</p>}

          <div className="mt-3 divide-y divide-tint/[0.06]">
            {actions.map((a) => (
              <div
                key={`${a.object}:${a.key}`}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
              >
                <span className="text-ink-secondary">
                  {OBJECT_LABEL[a.object]}{' '}
                  <span className="text-xs text-ink-tertiary">{a.key}</span>
                </span>
                <span className={`text-xs ${OP_STYLE[a.op]}`}>
                  {OP_LABEL[a.op]}
                  {a.details.length > 0 && (
                    <span className="ml-1 text-ink-tertiary">({a.details.join('; ')})</span>
                  )}
                </span>
              </div>
            ))}
            {status.reconcile?.errors.map((e) => (
              <p key={`${e.object}:${e.key}`} className="py-2 text-sm text-danger">
                {e.object}: {e.message}
              </p>
            ))}
          </div>

          {webhookMissing && (
            <p className="mt-3 text-sm text-warning" data-testid="webhook-missing">
              The webhook endpoint does not exist yet. Create it from infrastructure:{' '}
              <code>STRIPE_APPLY=1 ./scripts/provision-infra.sh stripe</code>
            </p>
          )}

          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-ink-tertiary">Last webhook</div>
              <div>
                {status.webhook.last_event_at
                  ? `${status.webhook.last_event_type} · ${new Date(status.webhook.last_event_at).toLocaleString()}`
                  : 'none received'}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-tertiary">Processed, 24h</div>
              <div>{status.webhook.completed_24h}</div>
            </div>
            <div>
              <div className="text-xs text-ink-tertiary">Failed, 24h</div>
              <div className={status.webhook.failed_24h > 0 ? 'text-danger' : ''}>
                {status.webhook.failed_24h}
              </div>
            </div>
          </div>

          {fixable.length > 0 && (
            <form onSubmit={apply} className="mt-4 space-y-3 border-t border-tint/[0.06] pt-4">
              <label className="block text-xs text-ink-secondary" htmlFor="stripe-reason">
                Reason (recorded in the audit log)
              </label>
              <input
                id="stripe-reason"
                className={input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. initial billing setup"
                minLength={8}
                required
              />
              {priceReplace && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmPrice}
                    onChange={(e) => setConfirmPrice(e.target.checked)}
                  />
                  <span>I understand this changes the price new subscribers pay.</span>
                </label>
              )}
              {live && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmLive}
                    onChange={(e) => setConfirmLive(e.target.checked)}
                  />
                  <span>This is the LIVE Stripe account.</span>
                </label>
              )}
              {formError && <p className="text-sm text-danger">{formError}</p>}
              <button
                type="submit"
                disabled={
                  busy ||
                  reason.trim().length < 8 ||
                  (priceReplace && !confirmPrice) ||
                  (live && !confirmLive)
                }
                className="rounded-xl bg-family-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy
                  ? 'Applying…'
                  : `Apply ${fixable.length} change${fixable.length === 1 ? '' : 's'}`}
              </button>
            </form>
          )}
          {fixable.length === 0 && !webhookMissing && !status.reconcile?.errors.length && (
            <p className="mt-3 text-sm text-ink-tertiary">Everything matches the configuration.</p>
          )}
        </>
      )}
    </GlassCard>
  )
}
