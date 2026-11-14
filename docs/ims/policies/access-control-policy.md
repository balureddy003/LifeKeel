# Access control policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-023 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Architect (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.5.15–A.5.18, A.8.2–A.8.5.

## Statements

1. **Deny by default, server-side.** Every request is authorised on the server against the
   tenant and the member's family role; client-side checks are convenience only.
2. **Tenant isolation.** Tenant-scoped data is read and written only through the tenant-scoped
   collection wrapper; cross-tenant access is a S1 defect (ISO_AUDITABLE.md §4).
3. **Least privilege inside a household.** Writes to shared household facts require household
   editor rights; removed members lose access immediately; minors get youth-scoped access only.
4. **Operators** reach household data only through the operator console with RBAC, step-up
   authentication and dual control for sensitive actions; every operator action is audited.
   Bootstrap operator access expires.
5. **Authentication.** Passwords hashed with scrypt; MFA (TOTP) available; email OTP; sign-in
   throttling; session revocation on removal, logout and password change. Phishing-resistant
   MFA for staff and operators is the target (A.8.5).
6. **Staff and cloud access** (GitHub, GCP, Cloudflare, MongoDB host, Stripe, SendGrid, LLM
   consoles) is granted per role, reviewed quarterly with a record, and revoked the same day on
   leaving (A.5.18, A.6.5).
7. **Machine identity.** Workload identity federation replaces long-lived service-account JSON
   keys (G-SEC-02).

## Enforced today

| Statement | Evidence |
|---|---|
| 2 | `packages/platform/src/tenant-scoped-collection.ts`, `apps/api/src/__tests__/ml-tenant-isolation.test.ts` |
| 3 | `apps/api/src/family/family-permissions.ts` |
| 4 | `apps/api/src/operator/operator-auth.ts`, `apps/api/src/operator/dual-control.ts`, `apps/api/src/operator/operator-audit.ts` |
| 5 | `apps/api/src/routes/auth-users.ts`, `apps/api/src/auth/totp.ts`, `apps/api/src/auth/otp.ts`, `apps/api/src/auth/session-revocation.ts` |

## Not yet in place

Quarterly access review records (A.5.18); joiner/mover/leaver for staff accounts (A.5.16);
workload identity (G-SEC-02); raw-collection access inventory (G-SEC-07); server-side
disclosure classification (G-SEC-06); bearer-token fallback (G-SEC-10).
