import type {
  StripeAdminClient,
  StripePrice,
  StripeProduct,
  StripePortalConfig,
  StripeWebhookEndpoint,
} from '../../stripe-reconcile.js'

/** In-memory Stripe: just enough behaviour to prove idempotence and diffs. */
export function fakeStripe() {
  const state = {
    products: [] as StripeProduct[],
    prices: [] as StripePrice[],
    endpoints: [] as StripeWebhookEndpoint[],
    portals: [] as StripePortalConfig[],
    calls: [] as string[],
  }
  let n = 0
  const id = (p: string): string => `${p}_${++n}`
  const client: StripeAdminClient = {
    products: {
      list: async () => ({ data: state.products.filter((p) => p.active !== false) }),
      create: async (p) => {
        state.calls.push('products.create')
        const row = { id: id('prod'), active: true, ...p } as StripeProduct
        state.products.push(row)
        return row
      },
      update: async (pid, p) => {
        state.calls.push('products.update')
        const row = state.products.find((x) => x.id === pid)!
        Object.assign(row, p)
        return row
      },
    },
    prices: {
      list: async (p) => {
        const keys = (p['lookup_keys'] as string[]) ?? []
        return {
          data: state.prices.filter((x) => x.active !== false && keys.includes(x.lookup_key ?? '')),
        }
      },
      create: async (p) => {
        state.calls.push('prices.create')
        if (p['transfer_lookup_key']) {
          for (const old of state.prices)
            if (old.lookup_key === p['lookup_key']) old.lookup_key = null
        }
        const row = {
          id: id('price'),
          active: true,
          product: p['product'],
          currency: p['currency'],
          unit_amount: p['unit_amount'],
          lookup_key: p['lookup_key'],
          recurring: p['recurring'],
        } as StripePrice
        state.prices.push(row)
        return row
      },
      update: async (pid, p) => {
        state.calls.push('prices.update')
        const row = state.prices.find((x) => x.id === pid)!
        Object.assign(row, p)
        return row
      },
    },
    webhookEndpoints: {
      list: async () => ({ data: state.endpoints }),
      create: async (p) => {
        state.calls.push('webhookEndpoints.create')
        const row = {
          id: id('we'),
          status: 'enabled',
          url: p['url'],
          enabled_events: p['enabled_events'],
          secret: 'whsec_FAKE',
        } as StripeWebhookEndpoint
        // Like Stripe, the secret is returned on create but never listed again.
        state.endpoints.push({ ...row, secret: undefined })
        return row
      },
      update: async (eid, p) => {
        state.calls.push('webhookEndpoints.update')
        const row = state.endpoints.find((x) => x.id === eid)!
        if (p['enabled_events']) row.enabled_events = p['enabled_events'] as string[]
        if (p['disabled'] === false) row.status = 'enabled'
        return row
      },
    },
    billingPortal: {
      configurations: {
        list: async () => ({ data: state.portals }),
        create: async (p) => {
          state.calls.push('portal.create')
          const row = { id: id('bpc'), active: true, ...p } as StripePortalConfig
          state.portals.push(row)
          return row
        },
        update: async (pid, p) => {
          state.calls.push('portal.update')
          const row = state.portals.find((x) => x.id === pid)!
          Object.assign(row, p)
          return row
        },
      },
    },
  }
  return { client, state }
}
