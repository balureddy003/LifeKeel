# Staging family simulation

Fictional families run against a **staging** API: happy paths through hostile
and abusive cases. Plain Node 22, no dependencies.

```bash
STAGING_API=https://<staging api> \
STAGING_TEST_TOKEN=<token, optional> \
node scripts/staging-sim/run.mjs [scenario-number-prefix]
```

- Refuses to run against a production host (`lifekeel.co.uk`, `.si`, or the
  production Cloud Run address).
- Accounts are made at `example.test` addresses. Fictional data only.
- `STAGING_TEST_TOKEN` (the staging mail-sink token) is optional. Without it the
  mail scenario is reported as SKIPPED. Never commit or print the token.
- Signup and join are limited to about 10 per minute per IP, so a full run takes
  about 5 minutes (it paces itself).
- Exit code 1 when any check fails.

## Scenarios

| # | Covers |
|---|---|
| 01 | Happy path: set up, add, confirm, edit, reconfirm, stale confirm |
| 02 | Edit access: grant, use without re-login, revoke |
| 03 | Members, children, roster, rename |
| 04 | Record validation (dates, size, secrets, unknown fields) |
| 05 | Hostile text (markup, SQL-like, emoji, right-to-left, null bytes) |
| 06 | Password, email and workspace corners; no account enumeration |
| 07 | Join: codes, duplicates, approval, deny, reset, wrong organizer |
| 08 | Families cannot see each other; token tampering |
| 09 | Child and read-only roles; malformed confirms |
| 10 | Parallel writes and double confirms |
| 11 | Large household |
| 12 | Notifications, push key, continuity |
| 13 | Brute-force throttling |
| 14 | Mail sink: verification and approval emails, token replay |
| 15 | 14-day join expiry (needs staging controls): 13 days stays, 15 days goes, expired cannot be approved, can ask again |
| 16 | Monthly digest (needs staging controls): reminder shown twice then stops, restarts after an edit, seen-by-all, held back without a sweep |
| 17 | Parallel upload burst: never a false daily limit; the cap of 3 in flight holds |

Scenarios 15 and 16 need the staging test controls (`STAGING_TEST_CONTROLS=on`,
see `docs/runbooks/staging-environment.md`) and the mail token. Without them they
are reported as SKIPPED, never as passed.

## Not covered

Real push, and anything a person sees in a browser. Scenarios 15 and 16 were
written before the controls were deployed, so their first live run may need the
wording of an assertion adjusted.
