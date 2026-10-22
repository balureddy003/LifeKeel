# PCI DSS scope — working note

Status: **for the acquirer or a QSA to confirm** (R16). This records how payment data
moves today; it does not certify compliance.

## Data flow

1. The web app asks the API to start checkout (`POST /billing/checkout`,
   `apps/api/src/routes/billing.ts`).
2. The API creates a Stripe-hosted Checkout Session and returns its URL.
3. The browser is **redirected to checkout.stripe.com**. Card number, expiry and CVC are
   entered on Stripe's page only.
4. Stripe sends signed webhooks; the API stores customer and subscription ids, plan and
   credit state. No card data is ever received, stored or logged.

## Proposed validation

A full redirect to a Stripe-hosted page is the pattern SAQ A is written for. Under PCI DSS
v4.0.1 the merchant must still confirm its site is not susceptible to script attacks that
could affect the redirect, and keep the SAQ A eligibility criteria true. *Decision for the
acquirer/QSA:* SAQ A, and any scan requirement that applies.

## Rules that keep the scope small

- Never embed Stripe Elements, a card iframe or a payment form on LifeKeel pages without
  re-assessing scope first.
- Card numbers must not be collected anywhere else: uploads, email reading, support forms,
  the assistant. If a document or message contains a card number:
  - uploaded files and email attachments are stored as received, so a card image or a
    statement showing a full card number would be stored too. Extraction does not pull card
    numbers into structured fields. *Decision:* whether to add PAN detection at upload;
  - when one is found (in a file, a message or a support case), delete or redact it and
    record it as a security incident (`docs/runbooks/breach-response.md`).
- The payment redirect pages keep the strict CSP in `apps/web/firebase.json`.

## Evidence to keep each year

Stripe's PCI attestation of compliance, the completed SAQ, the acquirer's confirmation, the
owner and date of the next review.
