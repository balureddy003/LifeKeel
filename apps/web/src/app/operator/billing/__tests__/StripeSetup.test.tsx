import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StripeSetupStatus } from '@/lib/api'

const fetchStripeSetup = vi.fn()
const reconcileStripeSetup = vi.fn()

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchStripeSetup: () => fetchStripeSetup(),
    reconcileStripeSetup: (...a: unknown[]) => reconcileStripeSetup(...a),
  }
})
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))

import { StripeSetup } from '../StripeSetup'

const webhook = {
  last_event_at: null,
  last_event_type: null,
  completed_24h: 3,
  failed_24h: 0,
  recent_failures: [],
}

function status(over: Partial<StripeSetupStatus> = {}): StripeSetupStatus {
  return {
    configured: true,
    mode: 'test',
    key_kind: 'restricted',
    key_warning: null,
    webhook,
    reconcile: {
      mode: 'test',
      applied: false,
      drift: true,
      ids: { prices: {} },
      errors: [],
      actions: [
        { object: 'product', key: 'keel_plus', op: 'create', details: ['name=Keel Plus'] },
        { object: 'price', key: 'keel_plus_gbp_monthly', op: 'create', details: ['799 gbp/month'] },
        { object: 'portal', key: 'portal', op: 'noop', details: [] },
        {
          object: 'webhook',
          key: 'https://api/billing/webhook',
          op: 'skipped',
          details: ['endpoint missing'],
        },
      ],
    },
    ...over,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StripeSetup (operator Billing setup)', () => {
  it('shows the TEST badge, the diff, and where to create a missing webhook', async () => {
    fetchStripeSetup.mockResolvedValue(status())
    render(<StripeSetup />)
    expect((await screen.findByTestId('stripe-mode')).textContent).toBe('TEST')
    expect(screen.getByText(/keel_plus_gbp_monthly/)).toBeTruthy()
    expect(screen.getByTestId('webhook-missing').textContent).toContain('provision-infra.sh stripe')
    expect(screen.getByRole('button', { name: /Apply 2 changes/ })).toBeTruthy()
  })

  it('apply stays disabled until a reason of 8+ characters is given, then calls the API', async () => {
    fetchStripeSetup.mockResolvedValue(status())
    reconcileStripeSetup.mockResolvedValue({})
    render(<StripeSetup />)
    const button = await screen.findByRole('button', { name: /Apply 2 changes/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'initial billing setup' },
    })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() =>
      expect(reconcileStripeSetup).toHaveBeenCalledWith({
        reason: 'initial billing setup',
        apply: true,
        confirm_live: false,
        confirm_price_change: false,
      }),
    )
  })

  it('a price replacement needs its own confirmation checkbox', async () => {
    const s = status()
    s.reconcile!.actions[1] = {
      object: 'price',
      key: 'keel_plus_gbp_monthly',
      op: 'replace',
      details: ['unit_amount 799 -> 999'],
    }
    fetchStripeSetup.mockResolvedValue(s)
    render(<StripeSetup />)
    const button = (await screen.findByRole('button', {
      name: /Apply 2 changes/,
    })) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'restore declared price' },
    })
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/changes the price new subscribers pay/))
    expect(button.disabled).toBe(false)
  })

  it('a LIVE account needs the live confirmation and shows a LIVE badge', async () => {
    fetchStripeSetup.mockResolvedValue(status({ mode: 'live' }))
    render(<StripeSetup />)
    expect((await screen.findByTestId('stripe-mode')).textContent).toBe('LIVE')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'go live setup' } })
    const button = screen.getByRole('button', { name: /Apply 2 changes/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/LIVE Stripe account/))
    expect(button.disabled).toBe(false)
  })

  it('says so when nothing needs changing and when Stripe is not configured', async () => {
    fetchStripeSetup.mockResolvedValueOnce(
      status({
        reconcile: {
          mode: 'test',
          applied: false,
          drift: false,
          ids: { prices: {} },
          errors: [],
          actions: [{ object: 'product', key: 'keel_plus', op: 'noop', details: [] }],
        },
      }),
    )
    const { unmount } = render(<StripeSetup />)
    expect(await screen.findByText(/Everything matches the configuration/)).toBeTruthy()
    unmount()

    fetchStripeSetup.mockResolvedValueOnce(status({ configured: false, reconcile: null }))
    render(<StripeSetup />)
    expect(await screen.findByText(/Stripe is not configured on this API/)).toBeTruthy()
  })
})
