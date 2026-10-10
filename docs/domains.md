# Mapping lifekeel.co.uk and lifekeel.si

Domains are registered and their DNS is managed at **Hostinger** (hPanel). The website is served by
**Firebase Hosting**; the API runs on **Cloud Run**. This page is the order of operations. After each stage,
run `scripts/check-domains.sh` (read-only, needs only `curl`) to see what is and is not mapped.

## State on 10 Oct 2026 (observed, not assumed)

| Name | Today |
|---|---|
| `lifekeel.co.uk`, `www.lifekeel.co.uk`, `lifekeel.si`, `www.lifekeel.si` | All four show Hostinger's **"Parked Domain"** page (A record `2.57.91.91`). **Nothing is mapped yet.** |
| Nameservers | Hostinger parking nameservers (`*.dns-parking.com`): edit records in hPanel, no need to move the domains. |
| Email on `lifekeel.co.uk` | **Live records: `MX` to `mx1/mx2.hostinger.com` and SPF `v=spf1 include:_spf.mail.hostinger.com ~all`. Keep them.** |
| Email on `lifekeel.si` | No mail records. |

## Target

- **Canonical site: `https://lifekeel.co.uk`** (the site's metadata, sitemap and share cards already use it).
- `www.lifekeel.co.uk`, `lifekeel.si` and `www.lifekeel.si` **redirect** to it (one site, no duplicate content).
- **API: stay on its Cloud Run `*.run.app` URL for now.** It costs nothing and the web app's CSP already allows
  it. Cloud Run's own domain mapping is a poor fit: Google lists it as preview and "not production-ready" because
  of latency, and it is only offered in ten regions that **do not include London** (europe-west2). A load balancer
  works anywhere but adds a standing monthly cost. See "Later: api.lifekeel.co.uk".

## Before you start

1. **Confirm the Firebase project.** `apps/web/.firebaserc` maps hosting target `family` to the site `lifekeel`
   in project `dyocense-502208`, and the deploy workflow defaults to that project. The name looks like an older
   product; make sure it is the project you want for LifeKeel (and that its billing/ownership is right).
2. GitHub settings the web deploy needs: variable `NEXT_PUBLIC_API_URL` (an **https** URL), optional
   `FIREBASE_PROJECT_ID`, secret `FIREBASE_SA_KEY`.
3. **Deploy the web app first** (Actions > Deploy > Run workflow), so the site has content and the security
   headers from `apps/web/firebase.json` before the domain starts pointing at it. The workflow now adds the API
   origin to the Content-Security-Policy automatically.

## Stage 1: the website (Firebase + Hostinger)

In the Firebase console: **Hosting > (site `lifekeel`) > Add custom domain**.

1. Add **`lifekeel.co.uk`**. The wizard shows a **TXT record** (proves ownership) and **A record(s)** (the exact
   values come from the wizard, copy them from there). Firebase says to keep the TXT record **permanently**: it is
   used to authorise certificate issuance and renewal.
2. In Hostinger: **hPanel > Domains > lifekeel.co.uk > DNS / Nameservers > DNS zone**:
   - **Add** the TXT and A record(s) from the wizard.
   - **Remove only** the parking A record(s) for the apex (`2.57.91.91`) and any `AAAA` on the apex. Firebase
     needs the apex to point only at it.
   - **Do not touch** `MX`, the SPF `TXT`, or any DKIM / other `TXT` records.
3. Add **`www.lifekeel.co.uk`** and choose **redirect to `lifekeel.co.uk`** (the wizard's optional redirect). Hostinger
   currently has `www` as a CNAME to the apex; replace it with whatever the wizard asks for.
4. Add **`lifekeel.si`** and **`www.lifekeel.si`** the same way, each redirecting to `https://lifekeel.co.uk`. The
   `.si` domain has no mail records, so there is nothing to protect there.
5. Wait for each domain to show **Connected** (TXT propagation and certificates can take up to a day).
6. Run `scripts/check-domains.sh` until it reports `0 failed`. It checks that every name ends at
   `https://lifekeel.co.uk`, that the non-canonical names redirect, that our CSP header is present, and that the
   mail records are still there.

## Stage 2: point the apps at the new domain

| Setting | Value | Why |
|---|---|---|
| Repo variable `LIFEKEEL_URL` | `https://lifekeel.co.uk` | Drives the API's `CORS_ORIGIN` and links in emails. Without it the browser's calls from the new domain are blocked by CORS. Redeploy the API after changing it. |
| Repo variable `API_BASE_URL` | the API's public URL | OAuth callbacks and share links. |
| Google OAuth client | authorised origin `https://lifekeel.co.uk`; redirect URIs for the API and the web `/auth/callback` | Sign-in with Google. |
| Stripe | webhook endpoint `<API URL>/billing/webhook`; return URLs on `https://lifekeel.co.uk` | Billing. |
| Transactional email (SendGrid) | domain authentication CNAMEs from SendGrid; add `include:sendgrid.net` **into the existing single SPF record** | Only one SPF record may exist; two invalidate both. |

Verify the API side with `API_URL=<your api url> scripts/check-domains.sh` (checks `/health/ready` and that CORS
allows `https://lifekeel.co.uk`).

## Later: api.lifekeel.co.uk (optional)

Staying on `*.run.app` is fine. If you want a branded API address, in rough order of cost:

| Option | Cost | Caveat |
|---|---|---|
| Keep the `*.run.app` URL | free | URL is not branded; changing it later means a web redeploy plus OAuth/Stripe URL updates |
| Firebase Hosting as a second site that proxies to Cloud Run | free-tier | Hosting caps proxied requests at about 60 s, so check long calls; confirm your Cloud Run region is supported |
| Cloud Run domain mapping | free | Preview, "not production-ready", not available in London |
| Global load balancer with a serverless backend | a standing monthly charge | Works in any region; most production-grade |

Whichever you pick, the deploy workflow keeps the web CSP in step with `NEXT_PUBLIC_API_URL`, and the API needs
`LIFEKEEL_URL` set so CORS allows the web origin.

## Cost

Static hosting with custom domains and certificates is within Firebase's free (Spark) plan as I recall it; check the
current quotas and plan terms in the console. The only recurring cost here is the two domain renewals at Hostinger.

## If something looks wrong

| Symptom | Cause / fix |
|---|---|
| Still the Hostinger parking page | The apex still has the parking A record, or DNS has not propagated. Re-check hPanel; the checker prints the A records it sees. |
| Browser says the certificate is invalid / pending | Firebase is still issuing it, or a `CAA` record excludes its authority. Wait; check the wizard; remove or widen a restrictive `CAA`. |
| Site loads but is blank or buttons do nothing | The web app was not deployed from this repo's `firebase.json` (its CSP must allow inline scripts and the API origin). Redeploy via the Deploy workflow. |
| Login works on `lifekeel.co.uk` but the API says "CORS" | `LIFEKEEL_URL` is not `https://lifekeel.co.uk`; set it and redeploy the API. |
| Mail stopped arriving | An MX or SPF record was removed. Restore `mx1/mx2.hostinger.com` and the SPF record from the table above. |
