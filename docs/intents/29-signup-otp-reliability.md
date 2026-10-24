# Intent 29: Signup OTP reliability

**Problem** — The critic review reports the email OTP/security check is
intermittent and `example.com` addresses fail outright, slowing or blocking
first-time users at the very first step. Unverified root cause: could be
domain validation, deliverability, or test-environment routing. An
unreliable front door undermines every downstream metric.

**Done looks like**
- The failure is reproduced and root-caused (OTP route
  `apps/api/src/routes/auth-otp.ts` / `auth-users.ts`, verify page
  `apps/web/src/app/verify-otp/page.tsx`).
- Clear, honest error states when an OTP can't be delivered or expires —
  no silent hang; resend path works within rate limits.
- A deterministic OTP path for test/dev environments so the suite and QA
  automation don't depend on real mail delivery.
- A monitorable signal for OTP delivery failure rate (counter/log on the
  send path) so recurrence is visible.

**Constraints**
- Trust tier: 0 — auth plumbing on the existing mechanism.
- Regulated-advice check: n/a.
- Data/privacy: no email content in logs; failure metrics carry counts and
  domain-class, not addresses.

**Out of scope** — auth redesign, passwordless/magic-link flows (deferred
with PRD-203), SMS OTP.

**Becomes** — fast-path fix PR if root cause is small; PRD only if the fix
touches the send/verify contract.

---

**Status: partially implemented — PR #244** shipped the deterministic test path
(`LIFEKEEL_TEST_OTP_CODE`, dev/test only, boot violation outside dev) and
confirmed the error surfaces (`delivery: failed|unknown` → resend,
`recordOtpDelivery` metric, audit) already exist. Remaining open item:
reproduce the reported intermittency against a live environment — likely
provider-bounce behaviour on undeliverable domains and/or Turnstile
flakiness in automated browsers — and decide whether a delivery webhook
(bounce → honest "couldn't deliver" state) is worth it.
