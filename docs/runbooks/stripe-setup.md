# Stripe setup as code

Billing setup (product, price, webhook endpoint, Customer Portal) is declared in
[`definitions/stripe-config.yaml`](../../definitions/stripe-config.yaml) and applied by an idempotent
reconciler. Nobody needs to click through the Stripe Dashboard to set LifeKeel up, in a sandbox or in live
mode.

| Piece | Where |
|---|---|
| What should exist | `definitions/stripe-config.yaml` |
| The reconciler | `apps/api/src/billing/stripe-reconcile.ts` |
| Run it from a terminal | `pnpm --filter @lifekeel/api run stripe:reconcile` (dry-run), add `--apply` |
| Run it as infra | `./scripts/provision-infra.sh stripe` (`STRIPE_APPLY=1` to apply) |
| Check for drift | `.github/workflows/stripe-drift.yml` (weekly, read-only) |
| Fix product/price/portal from the browser | Operator console, Billing, **Billing setup** |
| Prices are found by | `lookup_key` (never a hard-coded `price_…` id) |

## What still needs a person, once

Stripe does not let code do these:

1. Create the Stripe account (or a **sandbox** inside it) and accept its terms.
2. For live mode: business verification, bank details, tax registrations (UK VAT) and business details.
3. Create **one restricted API key** (below). Everything after that is code.

## 1. Create the restricted key

Dashboard, Developers, API keys, **Create restricted key**. Grant only:

| Resource | Permission |
|---|---|
| Products | Write |
| Prices | Write |
| Webhook endpoints | Write |
| Customer portal | Write |
| Checkout Sessions | Write |
| Customers | Write |
| Subscriptions | Write |
| Charges and Refunds | **Read** |

Do **not** grant Charges write, Refunds write, Payouts or Transfers. The reconciler never initiates a charge,
refund or payout (CLAUDE.md rule 1 and rule 2), and the key should be unable to.

The app itself (`STRIPE_SECRET_KEY`) needs a key that can create Checkout and portal sessions and read
subscriptions; the reconciler can use the same restricted key, or a separate `STRIPE_RECONCILE_KEY`.

## 2. First run, sandbox

```bash
export STRIPE_RECONCILE_KEY=rk_test_...
export STRIPE_API_ORIGIN=http://localhost:3001   # or your staging API
export LIFEKEEL_URL=http://localhost:3002
pnpm --filter @lifekeel/api run stripe:reconcile
```

It prints a diff and changes nothing. Exit code 2 means drift was found. To apply, with a secrets file for the
webhook signing secret:

```bash
pnpm --filter @lifekeel/api run stripe:reconcile --apply --webhook-secret-file /tmp/whsec
```

For a **local** API, Stripe cannot reach `localhost`; use `stripe listen --forward-to localhost:3001/billing/webhook`
instead and skip the webhook (`--no-webhook-create`). Put the `whsec_…` that `stripe listen` prints into
`LIFEKEEL_STRIPE_WEBHOOK_SECRET`.

## 3. Production / staging infrastructure

```bash
STRIPE_RECONCILE_KEY=rk_live_... ./scripts/provision-infra.sh stripe              # dry-run
STRIPE_RECONCILE_KEY=rk_live_... STRIPE_APPLY=1 STRIPE_ALLOW_LIVE=1 \
  ./scripts/provision-infra.sh stripe
```

If the run creates the webhook endpoint, Stripe returns its signing secret exactly once. The script moves it
from a `0600` temp file straight into Secret Manager (`lifekeel-stripe-webhook-secret`) and deletes the file.
**Then redeploy the API** so a new revision reads it.

Stripe's webhook secret cannot be read back later. If it is lost, delete the endpoint in Stripe (or have the
reconcile recreate it) and store the new secret.

## 4. Operator console

Operator, Billing, **Billing setup** shows TEST or LIVE, whether the key is restricted, the diff, and webhook
health (last event, processed and failed in 24h). Operators can fix product, price and portal drift; each apply
needs a recent login, a written reason, and is audited (`operator.billing.stripe_reconcile`).

Rules the page enforces:

- **Live account:** an explicit "this is LIVE" confirmation.
- **Price replacement:** an explicit confirmation, because it changes what new subscribers pay. Existing
  subscribers keep their price.
- **Webhook endpoint:** reported only. Creating it needs the infra step above, because of the one-time secret.

## 5. Changing a price

Edit `unit_amount` in `definitions/stripe-config.yaml`, open a PR, and after merge run the reconcile. It creates
a new price, moves the `lookup_key` to it, and archives the old one. Checkout resolves the price by key, so no
code change or deploy is needed. To pin a specific price during a rollout, set `STRIPE_PRICE_STARTER` (or
`STRIPE_PRICE_STARTER_GBP`).

## 6. Events

The webhook subscribes to exactly the events `routes/billing.ts` handles. A test
(`stripe-config-events.test.ts`) fails if the config and the handler disagree.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Activates the plan |
| `customer.subscription.updated` / `.deleted` | Plan, cancellation and churn reason |
| `invoice.payment_succeeded` / `.payment_failed` | Credit refill; past-due grace period |
| `checkout.session.expired` | Audit entry only |
| `charge.refunded` | Records the refund, audits, **alerts operators**. Does not change the plan. |
| `charge.dispute.created` / `.closed` | Records the dispute and evidence deadline, audits, **alerts operators**. Does not change access. |

Refunds and disputes deliberately do not end anyone's access automatically: that is a human decision.

## 7. Testing without the Dashboard

- **Unit tests** run the reconciler against an in-memory Stripe, and the webhook handler against signed
  fixture events, so CI needs no Stripe login.
- **Test cards:** `4242 4242 4242 4242` succeeds; `4000 0025 0000 3155` asks for 3-D Secure;
  `4000 0000 0000 0341` attaches then fails the charge; `4000 0000 0000 9995` has insufficient funds.
- **Time travel:** use Stripe test clocks to advance a subscription through renewal and the 7-day grace and
  14-day suspension periods.

## Known limits

- The reconciler manages objects it created (tagged `lifekeel_managed`); it will not adopt a Dashboard-made
  portal configuration.
- UK VAT (Stripe Tax) and promotion codes at Checkout are not configured here yet.
- Only the `starter` plan in GBP is declared.
