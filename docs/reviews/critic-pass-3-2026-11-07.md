# Critic pass 3: shipped UX and notification work (PRs 378-387)

Date: 2026-11-07. Read-only. Method: `gh pr view/diff` and `git show origin/<branch>:<path>` on every PR head (SHAs: 378 156fd9d3, 379 059b50f5, 380 5de86405, 381 c95535e3, 382 0a89a764, 383 65ee7814, 384 b87732f3, 385 67d8bed8, 386 f5603ffb, 387 47cf3eed), plus `git merge-tree` for conflict checks. I ran no app, no tests, no browser, touched no database and read no `.env`. Anything about rendering, focus or screen readers is inferred from code and marked as such. Pass-2 report and ledger were read from `feat/digest-domain-summary`.

CI at review time: all green except 382 and 387, which each had one check still pending (neither failed).

---

## 1. Verdict per PR

| PR | Verdict | Reason |
|---|---|---|
| 378 domain packs | **ok (base of stack)** | Pass-2 verified tenant scoping and authz; the UX gaps it named are addressed in 387. Unrelated erasure edit and 401-vs-403 remain (Low). Not re-audited line by line this pass. |
| 379 a11y 2a/2b + fix | **ok** | Sticky column now exists in code; settings Approve/Decline are 48px/16px. Test asserts classes only (see F9). |
| 380 joiner approval email + honest waiting screen | **ok, one Medium** | Waiting screen is now true. But "we will email you" is silently false when no mail provider is configured, and the screen never mentions the 14-day expiry that 386 adds. |
| 381 catalogue + all channels + vault/checklist split | **ok to merge; High 1 stays an owner decision** | Catalogue is now truthful about reach. It does not change what SMS/WhatsApp/chat/email actually send. |
| 382 digest domain lines | **ok** | Counts and dates only; failure-wrapped. Pass-2 F10 (monthly "not yet seen" nag, overdue fallback, ignores `member_scope`) still unaddressed. CI check pending. |
| 383 neutral copy + test | **ok** | Real improvement. "Two recent alerts had no response" and "each of you confirms you have seen it" are still vague. |
| 384 jsdom a11y gate | **needs change (small)** | The touch-target check has a regex hole: `h-10`/`h-11` (40/44px) pass as 48px. |
| 385 sender allow-list + ledger mapping | **ok** | Does what it says; coarse (file-level, `auth-email.ts` is a blanket entry). Low findings only. |
| 386 join mailbox proof + 14-day expiry | **needs change** | Expiry is good. "Mailbox proof" is not: unverified accounts can sign in and use the app, so the confirm link gates nothing, and the flag is off by default. The squat is not closed either way. |
| 387 domains hardening | **needs change (small)** | Confirm-before-remove, focus-after-confirm and retry are real. The new read-only line says "the organizer can arrange" edit access; no organizer path exists, so it is untrue. |

---

## 2. Pass-2 High findings: closed?

| Pass-2 High | Closed? | Evidence (branch code, not PR text) |
|---|---|---|
| F2 join waiting screen untrue / dead-end sign-in | **Yes (one caveat)** | `origin/feat/join-approved-email:apps/web/src/app/invite/[code]/PendingApproval.tsx`: "Your request is with {family}'s organizer. When they approve it, we will email you…"; header comment says the organizer is not pushed to; link reworded "Already approved? Sign in", 48px. `InviteJoinClient.tsx:207` renders it on submit. Test `pending-approval.test.tsx` fails on `let .* know|notified`. Caveat: "we will email you" is false if `emailConfigured()` is false (`sendJoinApprovedEmail` logs a warn and returns) or the typed address is wrong. Organizer is still not told (accepted, ledger 3a part 2). |
| F1 catalogue channel honesty + vault/checklist split | **Partly: documentation closed, behaviour unchanged** | `origin/feat/notification-catalogue:apps/api/src/delivery/notification-catalogue.ts`: `insight_alert.channels = ['push','email','sms','whatsapp','chat']`, header says the closed set governs push only. `life_event_checklist_reminder` (reporter only) and `life_event_vault_reminder` (other adults, `safeguarding: true`, "names who reported it and the type of event", no push) are separate; old `life_event_reminder` removed (tested). `channels.ts` still sends `Confidence: N%`, impact range and `Approve:` / `Dismiss:` signed URLs by WhatsApp/SMS/chat (lines ~252-290) and puts hypothesis, confidence and impact in the email subject (line ~310). The honesty test is a hard-coded `arrayContaining`; it would not fail if a channel were added to `channels.ts` (385 covers files, not channels). Ledger correctly records this as an owner decision. |
| F3 sticky matrix column, 16px controls | **Yes** | `origin/fix/domains-a11y-round2:apps/web/src/app/domains/page.tsx:174-176`: row `<th scope="row" className="sticky left-0 … bg-surface-1 …">`. Person chips `text-base min-h-[48px]` (l.282); settings Approve/Decline `min-h-[48px] … text-base` (settings/page.tsx l.948, 958). Caveats: only the body row headers are sticky (the "Policy" header corner scrolls away); the test (`domains.test.tsx:346-352`) checks `className` contains `sticky`/`left-0`, which jsdom cannot make behave, so the "offset 0 after 200px" measurement is the only evidence and is not re-runnable. Note `html{font-size:17px}` and `.text-sm{font-size:16px}` in a mobile block (globals.css 35, 371), so the "under 16px" concern was largely already met on phones. |

---

## 3. Findings, ranked

Effort: S under half a day, M a day or two, L multi-PR.

### High

**H1. 386: the "mailbox proof" gates nothing, and with `EMAIL_VERIFICATION_ENABLED` unset (the default) the squat is exactly as before.**
- Where: `apps/api/src/routes/family-join.ts` approve (`email_verified: !verification`); `apps/api/src/routes/auth-users.ts` login (~l.690-760) and `/auth/me`: no check of `email_verified`. I grepped the whole API and web source on the branch: the only consumer of `email_verified === false` is the dismissible `VerifyEmailBanner` in `AppShell.tsx:297`. A request-time-password joiner can sign in and use the family immediately without ever clicking the link.
- Plain statement on the flag: **flag off** (`EMAIL_VERIFICATION_ENABLED !== 'true'`, the `.env.example` default; I could not see prod's value): `email_verified: true`, no token, no confirm link, behaviour identical to before 386. The pass-2 Medium (attacker types a victim's address, organizer approves, attacker's chosen password now owns a "verified" login on that address, victim later gets "Email already registered") is **unchanged**. **Flag on**: the account is `email_verified:false` and the email carries a confirm link, but the attacker still has a working password and a family seat, and if the victim clicks the (unexpected) confirm link it flips to verified. The pass-2 smallest fix (do not honour the request-time password; email a one-time set-password link) was not taken. The ledger row ("unverified account + confirm link") and the email text ("First confirm… Then sign in") imply a gate that does not exist.
- Smallest fix: on approve, store no usable password and send a one-time set-password link (the per-member invite token machinery is in the same file); or make login return `requires_verification` and refuse sessions for unverified join-created users. Until then reword PR/ledger to "adds a confirm link; does not prevent sign-in".
- Effort: M.

### Medium

**M1. 387: read-only note promises something that cannot happen.** `apps/web/src/app/domains/page.tsx` (new `!view.can_edit` paragraph): "Changing what is on file needs edit access, which the organizer can arrange." Joiners get JWT role `viewer` (`family-join.ts:603`); `EDITOR_AUTH_ROLES` is owner/admin/operator/analyst; the only role-writing code is operator-only (`operator.ts:1263,1314`). No organizer UI or API grants it. Fix: "Only the person who set this up can change what is on file." (true today) and raise the real capability as an owner decision. Effort: S.

**M2. 386: the joiner is never told a request expired or that approval can lapse.** `PendingApproval` (380) says nothing about 14 days; after day 14 the request disappears from the organizer list, `approve` returns 410 to the organizer only, and the joiner's "Already approved? Sign in" fails with a generic error. Persona A dead end after two weeks of silence. Fix: one sentence on the waiting screen ("Requests lapse after 14 days; ask them to resend if yours does"); optional reminder to the organizer inside the app. Effort: S.

**M3. 380/386: "we will email you" can be false.** `auth-email.ts sendJoinApprovedEmail` returns silently if `emailConfigured()` is false or the send throws (swallowed, logged), and `family-join.ts` still returns `approved: true`. A typo in the address means a stranger receives the family name and a sign-in link. Fix: return a boolean from the send; show the organizer "we could not email them, tell them yourself" in the approve response/UI. Effort: S.

**M4. 384: touch-target gate has a hole.** `apps/web/src/app/__tests__/a11y.test.tsx`: the pass regex `/min-h-\[(48|56)px\]|\bh-1[2-9]\b|\bh-\d{2,}\b/` treats `h-10` (40px) and `h-11` (44px) as compliant (I ran it: `h-10 px-3` and `h-11` both match). Also scans `button` only, not links or chips rendered as `a`. The PR's "3 regressions red" used `min-h-[40px]` and a footnote link, which the regex does catch. Fix: allow only `min-h-[48px]`, `h-12`+, `min-h-[56px]`; include `a, [role=button]`. Effort: S.

**M5. 381 (carried from pass-2 F4, still open): the checklist email subject names the event type.** `life-events/checklist-reminder.ts:86` `subject: Your ${playbookTitle} checklist`. The catalogue marks the kind `safeguarding` but its test only forbids the `push` channel. An email preview on a locked or shared phone shows a bereavement/medical title. The same lock-screen exposure applies to insight-alert email subjects (hypothesis, confidence, impact in the subject, `channels.ts` ~l.310). Fix: neutral subjects for safeguarding kinds plus a test over subject templates. Effort: S (checklist), M (alerts, owner decision).

**M6. 381/385: approve and dismiss links plus figures still go out by SMS/WhatsApp/chat.** Not a regression (catalogue now says so), but it contradicts the round-1 rejected idea and the pass-2 "must not build" list, and `approve_url` is a one-click signed link on an insight (check against the Tier-0/approval gate before it is considered harmless). Remains the owner decision in the ledger. Effort: M once decided.

**M7. 386: no purge of expired join requests; request-time password hashes persist.** Expired requests only leave the list and are deleted if someone tries to approve or re-request that address. `password_hash` and `salt` of unapproved strangers stay indefinitely. Fix: TTL index on `requested_at` (14 days + slack). Effort: S.

**M8. 387: removing a record or choosing "Keep it" still drops focus to the document.** `RecordList.tsx`: both buttons unmount their own container (`setConfirming(null)`) and the row may unmount; only the "I have seen this" path got a focus fix. Also the confirm text does not say that removing resets both adults' confirmations (pass-2 F8). Inferred from code, not tested. Fix: return focus to the trash button for Keep it, to the list heading/status for remove; add the sentence. Effort: S.

### Low

- **L1 (385)** Tripwire is file-level: `auth-email.ts` is one blanket entry (kinds + "outside" reason), so a new email function in it (continuity, a new nudge) passes. The check "every live kind has a sender" is satisfied by the allow-list entry itself, not by code that sends it (e.g. `join_approved` passes even if 380 is not merged). Primitives scanned are strings; a sender using `fetch` to a chat webhook or a new helper escapes. The ledger-kind regex only sees literal `kind: '…'`. Fix: per-function entries or a naming rule for `send*Email` exports; S.
- **L2 (385)** Continuity check-in/alert emails ("we haven't seen you in N days") still uncatalogued; stated honestly in the test comment. S to add an `outside`-with-reason kind and justify it.
- **L3 (382)** Pass-2 F10 unaddressed: "not yet seen by every adult" repeats monthly with no ceiling; falls back to the oldest overdue date; ignores `member_scope: 'mine'`. The email body also names the pack title (e.g. the bereavement pack) to every adult. S.
- **L4 (383)** `copy-pressure.test.ts` skips missing files silently (guard `>= 4`); does not scan `auth-email.ts`, vault/checklist emails, `lifecycle-emails.ts`, `PendingApproval.tsx`. "Two recent alerts had no response" is still vague; "each of you confirms you have seen it" in `InvitePartnerPrompt` has no referent on the home screen and the link under it is `py-2` text-sm (not 48px). S.
- **L5 (386)** Enumeration: `/family/join` answers 409 "Email already registered" vs 409 "request already pending" to anyone holding an invite code (pre-existing; code is 6 hex, Turnstile plus 10/min). Not worsened. Unbounded pending requests per family let a code-holder fill the organizer list (now hidden after 14 days). S.
- **L6 (387)** Pack-list load failure (`getDomains` fallback) and the "Only adults on the family list can see it" error text for network failures remain; retry only covers the single-domain view. S.
- **L7 (379/384)** Matrix header "Policy" corner is not sticky; sticky assertions are class strings. A Playwright check remains unbuilt (stated). M.
- **L8 (378)** Unrelated erasure edit rides along; "Adults only" returns 401; no per-tenant record cap (pass-2 F15, unchanged). S.
- **L9 (386/380)** Subject line says "You can now sign in" even in verify mode, which is true only because login is not gated (see H1). S.

### Verified (from code this pass)

- 386 token handling: the raw token is only in the emailed URL fragment; only the sha256 is stored (`email_verification_token_hash`), 24h expiry, single-use atomic `findOneAndUpdate` in `/auth/verify-email`; resend is rate-limited, Turnstile-gated and returns the same answer for unknown, verified or existing addresses. The test (`token != stored`, `sha256(token) == stored`) would fail if the token were stored raw.
- 386 expiry: approve returns 410, clears the request, sends nothing, creates no user; list hides expired; an expired request no longer blocks a new one; a fresh pending request still blocks (409). Boundary is `<` cutoff, request time not approval time; fine. Join-created token expiry (24h) is shorter than request life (14d) but the resend path covers it because login works.
- 386 after verify: `/verify-email` verifies, shows "Email verified", redirects to `/` if signed in else `/login` after 2.5s. No loop. Expired link tells a signed-out user to "sign in and use the verification prompt" which works only because login is ungated.
- 385: allow-list mutation behaviour is plausible from the code; I did not re-run mutations.
- Merge conflicts (`git merge-tree`): no conflicts among 378/380/381/383, 386+385, 387+384, 382+379, 386+383.
- CLAUDE.md rules: nothing here adds autonomous execution, advice copy or model use on family content. 387, 384, 385, 383 are UI/tests only.

---

## 4. Merge-readiness and order

**Safe to merge now (no blocker):** 378, 379, 380, 381, 382 (once its pending check is green), 383, 385.

**Merge after a small change:**
- 384: tighten the touch regex (M4). S.
- 387: replace the untrue "organizer can arrange" line (M1). S. Strongly preferred also: focus on remove/keep (M8).
- 386: either reword PR and ledger honestly ("adds a confirm link and expiry; does not stop an unverified joiner signing in; squat remains") and merge for the expiry alone, or implement the set-password link first (H1). Do not mark the pass-2 Medium closed.

**Stacking note:** 381 lists `join_approved` as a live kind, so merge 380 before 381 or the catalogue briefly describes a sender that does not exist (385's test would not notice, see L1).

**Order:** 378 -> 379 -> 380 -> 381 -> 383 -> 382 -> 384 (after fix) -> 385 -> 387 (after fix) -> 386 (after fix or reword). 382 needs 378; 384 and 387 need 379; 385 needs 381; 386 needs 380 (all stack bases above precede them). Retarget stacked PRs to `main` after each base merges.

**Overall:** the set is production-ready for the owner to merge as a stack except 386's security claim, 387's one false sentence and 384's regex. Deploy decisions (turning on `EMAIL_VERIFICATION_ENABLED`, SMS/WhatsApp content) remain the owner's.

---

## 5. Remaining owner decisions

1. Do SMS/WhatsApp/chat alerts keep detail, confidence and one-click approve/dismiss links (M6)? Default recommendation: generic words plus a deep link to the signed-in screen.
2. Join account model: accept the request-time password (current), or send a set-password link on approval (H1, recommended)? And whether unverified users may sign in at all.
3. Whether `EMAIL_VERIFICATION_ENABLED` is on in production, and whether the platform's OTP login mode is on (if the login OTP is on, the emailed code proves the mailbox at every sign-in and H1 shrinks a lot; I could not see either value).
4. Can the organizer grant a second adult edit rights (needed to make any "arrange edit access" wording true), or is view-and-confirm the intended role?
5. Safeguarding default for subjects of checklist/vault/alert emails (M5), the organizer join-request notice (ledger 3a part 2) and decline notice (silence may be safer).
6. Noun for the records ("family list" vs "on file"), and per-adult vs organizer-only mute (carried from pass 2).

## 6. What I could not verify

- Nothing was run: no tests, no mutation re-runs, no browser. The 375px axe and bounding-box numbers in 379 and 387 ("17px text", "offset 0 after 200px", "Keep it focused") are PR-body claims; I only confirmed the code that would produce them.
- Real email delivery and rendering of the join-approved message (both variants); the real-API two-adult flow end to end; whether production has `EMAIL_VERIFICATION_ENABLED` or OTP login mode on.
- Screen-reader output; focus order after remove/keep (inferred); colour contrast (shell footer 2.65:1 is a known open item).
- 378's server routes were not re-audited line by line this pass (I relied on pass 2 and the unchanged heads); 382's job wiring end to end; CI results for the two pending checks (382, 387).
- Whether any other route consumes `email_verified` (I grepped `apps/api/src` and `apps/web/src` non-test files on the 386 branch; none gate on it).
