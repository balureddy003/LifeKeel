# Security

This is a private repository. If you find a security issue, open a GitHub issue
or contact the repo owner directly rather than filing publicly.

## Known, deliberately deferred issues

- **Auth token in `localStorage`.** `src/lib/auth-context.tsx` and `src/lib/api.ts`
  store the bearer token in `localStorage` (`kairos_token`), which is readable by
  any script running on the page (XSS). The correct fix is for the backend to
  set an `httpOnly`, `Secure`, `SameSite` cookie instead of returning a bearer
  token — that's a backend change, tracked against the dedicated Trellis backend
  build-out, not something this frontend-only repo can fix alone.
- **CSP `connect-src` placeholder.** `firebase.json`'s Content-Security-Policy
  allows `connect-src 'self' https://*.run.app` to match the current shared
  Cloud Run API. Update this to the dedicated backend's actual origin once it
  ships, and narrow it — a wildcard subdomain match is broader than necessary
  once there's a fixed URL to pin to.
- **No Session Replay.** Deliberately not enabled in `src/lib/observability.ts`
  — this app displays household financial data on screen, and Replay would
  capture it. Don't add it without a specific masking/redaction plan.
