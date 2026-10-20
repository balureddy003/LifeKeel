# Store listing copy & submission checklist

Drafted so the App Store / Play Console forms can be filled in one sitting once
the accounts exist (`mobile-release.md` covers the pipeline; this covers the
storefront). **Verify the privacy declarations against the live
`/privacy` policy and what's actually collected before submitting** — getting
these wrong is the most common rejection/flag reason for data-handling apps.

## Identity

| Field | Value |
|---|---|
| App name | LifeKeel |
| Bundle / package | `uk.co.lifekeel.app` |
| Subtitle (iOS, ≤30 chars) | `Your family's chart` |
| Short description (Play, ≤80 chars) | `Your family's chart — what's on file, what Keel noticed, the next step.` |
| Primary category | Finance (Lifestyle secondary) |
| Age rating | 4+ / Everyone — no UGC, no ads, no objectionable content |
| Privacy policy URL | `https://lifekeel.co.uk/privacy` |
| Support URL | `https://lifekeel.co.uk/support` |
| Marketing URL | `https://lifekeel.co.uk` |

## Long description (draft — works for both stores)

> LifeKeel is the digital twin for your family: a single place that knows
> what's on file, what changed, and what needs attention before it becomes a
> crisis.
>
> • A secure family vault for wills, insurance, pensions and key documents
> • Readiness checks across your household's finances — emergency fund,
>   protection, retirement and estate gaps, shown as informational estimates
> • Reminders for renewals, expiring documents and life events
> • Approved actions only — LifeKeel prepares, you decide. Nothing is sent,
>   moved or changed without your explicit approval
> • Your data is never used to train AI models
>
> LifeKeel provides information, not financial advice. For decisions about
> specific products, speak to a qualified professional.

## Keywords (iOS, ≤100 chars, comma-separated)

```
family,vault,documents,estate,will,insurance,emergency fund,retirement,readiness,reminders
```

## Privacy declarations (draft — verify before submitting)

| Data type | Collected? | Linked to user | Used for |
|---|---|---|---|
| Contact info (name, email) | Yes | Yes | Account, notifications |
| Financial info (profile answers, balances on file) | Yes | Yes | Core features (readiness checks) |
| User content (uploaded documents, vault) | Yes | Yes | Core features (vault, OCR extraction) |
| Email content (consented scan) | Yes | Yes | Extracted commitments (opt-in connector) |
| Identifiers (device push token) | Yes | Yes | Notifications |
| Diagnostics (crash/perf) | TBD — set to whatever the API/web actually emits | — | Stability |
| Tracking / advertising | **No** — state "not used to track" on both stores | | |

App Store "privacy nutrition" + Play "Data safety" both need: encryption in
transit = yes, data deleted on request = yes (`/account` erasure flow exists).
Model-training: **no** — that's a product rule worth stating explicitly.

## Submission checklist

- [ ] Screenshots: iOS needs 6.7" class (iPhone 15 Pro Max sim) — 3–10 shots;
      Play needs min 2 phone + feature graphic 1024×500. Grab them from the
      **sandbox demo mode** (`?sandbox=1`) — seeded family data, no PII, and it
      shows the product populated.
- [ ] App Review notes: explain the shell loads `app.lifekeel.co.uk` (same
      content as the PWA), provide the demo-token path or a reviewer account.
      Apple's 4.2 "repackaged website" clause is the realistic review risk —
      push/camera/biometric make it a real app; say so.
- [ ] Encryption question pre-answered: `ITSAppUsesNonExemptEncryption=false`
      is already in Info.plist (standard HTTPS only).
- [ ] Device family: iPhone-only (`TARGETED_DEVICE_FAMILY=1` in the Fastfile).
      Flip to universal + iPad screenshots if tablet support is wanted.
- [ ] Android deep links (later): App Links for `lifekeel.co.uk` needs the
      upload-cert SHA-256 → host `/.well-known/assetlinks.json`. Defer until
      the keystore exists; deferred deep links are a post-release change.
- [ ] iOS associated domains (later): same story — `apple-app-site-association`
      on the domain + `com.apple.developer.associated-domains` entitlement.
- [ ] Server-side push: APNs auth key (Apple account) + FCM service account
      env — ops config, not store-blocking for v1 without push.
- [ ] Manual QA gate (mobile-release.md): Slovenia-region sim check before
      the first submission.

## Versioning

`version_name`/`versionName` is the public version (`0.1.0` now) — bump it in
the dispatch input per release. `build_number`/`versionCode` defaults to the
workflow run number and must only ever increase for a given listing.
