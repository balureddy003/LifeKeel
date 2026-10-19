# Intent: claim-drift remediation bundle

**Problem** — six places where the docs claim "Implemented" but production
code doesn't deliver it. Each is small; together they are exactly the
failure mode the Stage-0 fitness tests exist to prevent. (Items marked
XS qualify for the CONTRIBUTING.md fast path and can ship as a docs/fix PR.)

**Done looks like** — each line becomes true or the claim is corrected:

1. **OTel (S):** add `sdk-trace-base` + OTLP exporter deps and wire `withSpan`
   on route/queue/model paths — or downgrade §12's claim to "telemetry seam,
   not exporting". Currently only `@opentelemetry/api` is installed;
   `initTelemetry` always no-ops.
2. **WebLLM (S):** add `huggingface.co` connect-src +
   `wasm-unsafe-eval`/`worker-src` to `firebase.json` CSP, or gate the
   feature off until verified live. Currently shipped but CSP-blocked.
3. **deploy-local-judge (S):** eval gate before traffic (`--no-traffic` →
   eval → shift), matching deploy-api's canary pattern; a failing model must
   never serve.
4. **`localhost` out of production CSRF Origin allowlist** (XS) — env-gated
   dev only (`session-cookie.ts:63-83`).
5. **`/auth/login` route-level rate limit** (XS) — signup/invites/quiz have
   tighter limits; login only has the global bucket + lockout.
6. **Encryption fallback hardening** (XS) — `getKey` fails closed on unknown
   version instead of silently using the legacy key; `decryptIfNeeded`'s
   plaintext-passthrough documented or removed.
7. **Cleanup** (XS): `console.log` leftovers in `llm.ts`; stale
   `apps/web/Dockerfile` ("Trellis"); drop `*.run.app` from CSP +
   `allowNavigation` once same-origin `/api` is verified sole path; delete
   `deploy-out/` SA keys from disk.

**Constraints**
- Trust tier touched: none (1–7 are hardening); approval gate: per-item PR.
- Regulated-advice check: none.
- Data/privacy limits: items 4/6/7 are security-sensitive — review as such.

**Out of scope** — the structural fixes each drift item points at (covered by
their own intents); new telemetry features beyond wiring the claimed ones.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md (or fast-path PRs)
