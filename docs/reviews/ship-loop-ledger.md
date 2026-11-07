# Ship loop ledger

Tracks the rounds in `docs/reviews/ux-journey-notifications-review-2026-11-07.md` (section 4; added in PR 379). One row per round. "Production-ready" here means ready for the owner to merge and deploy. Nothing in this loop merges or deploys.

Updated: 2026-11-07 (loop stopped at iteration 9: all 10 PRs green, no human review comments, round 9 deferred. Iteration 8: critic pass 3 folded in and its confirmed findings fixed on 384, 386, 387. Iteration 7: PRs 378-386 CI green; shipped round (c) as PR 387; critic pass 3 running, report will be docs/reviews/critic-pass-3-2026-11-07.md. Iteration 6: PRs 378-385 CI green; shipped round (b) as PR 386. Iteration 5: PRs 378-384 CI green; shipped round (a) as the next PR. Iteration 4: critic pass 2 folded in, report in `docs/reviews/critic-pass-2-2026-11-07.md`; its three High findings fixed on their own PRs).

| Round | What | Status | PR | Acceptance check |
|---|---|---|---|---|
| core | Domain packs: contract, API, page, bereavement, three-door home, car | open | [378](https://github.com/balureddy003/LifeKeel/pull/378) | 458 API tests, 847 web tests, CI green; not run against the real API |
| 2a/2b | Touch targets 48px, focusable matrix region | open | [379](https://github.com/balureddy003/LifeKeel/pull/379) | axe + 48px measured at 375px on domains pages; shell footer contrast still 2.65:1 |
| 2c | Domains reachable: fourth door, nav entry, pack list state | blocked-on-owner | | Needs a name for the fourth door |
| 3a | Joiner approval email | open | [380](https://github.com/balureddy003/LifeKeel/pull/380) | Mutation red; organizer-side notice waits on the catalogue (now built) and the safeguarding default (email/in-app only) |
| 3b | `adult_action_needed` | blocked-on-owner | | Safeguarding sign-off on wording and "private to me" |
| 4a/4b | Closed lock-screen words, catalogue, mute per kind | open | [381](https://github.com/balureddy003/LifeKeel/pull/381) | 3 mutations red; web settings list not built |
| 4c | Family time zone for quiet hours | blocked-on-owner | | Where the time zone is collected |
| 5a | Dated-obligation sweep for packs | blocked-on-owner | | Whether pack dates reuse the renewal-reminder scope grant |
| 5b | Domain lines in the monthly digest | open | [382](https://github.com/balureddy003/LifeKeel/pull/382) | Renderer mutation red; job wiring not covered end to end |
| 6a | Shortened first value | blocked-on-owner | | Whether to drop the welcome carousel |
| 6b | Neutral copy pass | open | [383](https://github.com/balureddy003/LifeKeel/pull/383) | Copy-pressure test red on old wording; tone is a human judgement |
| 7 | Document-ready draft | blocked-on-owner | | Privacy review + registered gateway task |
| 8 | Holder changed | blocked-on-owner | | Safeguarding review |
| 9 | Primitives migration of invite, signup and welcome | deferred by the loop | | Touches signup, which drives conversion, and there is no visual-regression harness to prove it safe; needs the owner's go-ahead |
| 10 | Measured a11y gate in CI | open (jsdom half) | [384](https://github.com/balureddy003/LifeKeel/pull/384) | axe + 48px + reduced-motion checks, 3 regressions red; 375px browser gate (Playwright) not built: needs live-stack harness |

## Critic pass 2 (read-only agent; all claims below checked in code before acting)

| Finding | Status |
|---|---|
| High: joiner screen said the family was "let know" and offered a sign-in that fails until approval | fixed on #380 (`PendingApproval`, email promised, test red on old wording) |
| High: catalogue "closed set" implied alerts only reach push and email; SMS/WhatsApp/chat carry the finding, a confidence figure and a signed approve link | catalogue now lists every channel (#381); **owner decision:** whether those messages should drop detail and the approve link (not changed) |
| High: sticky matrix column claimed in #379 but never applied | fixed on #379, measured in browser (row header stays at offset 0 after a 200px scroll); control text raised to 16px |
| Med: vault reminder emails the other adults naming reporter and event type; catalogue said reporter only | fixed on #381: split into checklist (reporter) and vault (other adults, safeguarding) kinds |
| Med: catalogue is not a gate (checklist, vault, continuity, low-credit, lifecycle senders bypass it); budget ledger id `renewal_reminder` vs catalogue `policy_renewal_reminder` | open: [PR 385](https://github.com/balureddy003/LifeKeel/pull/385) sender allow-list tripwire + ledger-kind mapping; continuity emails still uncatalogued (stated in the test) |
| Med: join creates an `email_verified` account without mailbox proof; the new email goes to that unverified address | open: [PR 386](https://github.com/balureddy003/LifeKeel/pull/386) unverified account + confirm link when verification is on (same switch as signup) + 14-day request expiry; owner: turning `EMAIL_VERIFICATION_ENABLED` on is a deployment call |
| Med: domains delete is one tap with no undo; focus lost after "I have seen this"; second adult has `viewer` role and cannot add records, with no explanation | open: [PR 387](https://github.com/balureddy003/LifeKeel/pull/387) confirm-before-remove (not undo: no restore endpoint), focus to the status line, read-only explanation, Try again; focus and 48px measured in a browser at 375px |
| Med: mute is API-only, organizer-only, silent to the second adult | todo: settings list for kinds (owner: per-adult or organizer-only?) |
| Med: digest repeats "not yet seen by every adult" monthly with no ceiling; "family list" means two things | todo (vocabulary needs an owner choice of noun) |
| Acceptance table: 2a, 2b, 3a, 4a, 4b, 5b, 6b all "partly met" | recorded; each todo above closes a gap |

Verified clean by the critic: new domain routes are tenant-scoped, adult/editor-gated, strictly validated, no cross-tenant read found; join-approved email is sent at most once per request and only after organizer approval.

New rounds from the critic, in order: (a) catalogue truthfulness (inventory + tripwire + ids), (b) join mailbox proof + expiring requests, (c) domains page hardening, (d) settings list for kinds [owner: per-adult mute?], (e) digest cadence cap + vocabulary [owner: noun], (f) generic SMS/WhatsApp/chat bodies [owner: does any family rely on the detail?], (g) organizer join-request notice email/in-app only [owner: safeguarding sign-off], (h) decline notice to joiner [owner: silence may be safer in separation cases]. Recommended for 5a: a separate consent grant for pack dates (the renewal-reminder consent does not cover MOT or other pack dates).

## Critic pass 3 (read-only agent; every claim below checked in code before acting; report: `docs/reviews/critic-pass-3-2026-11-07.md`)

| Finding | Status |
|---|---|
| Pass-2 Highs: join waiting screen true; sticky column and 16px controls exist; catalogue closed only as documentation | confirmed closed, except the catalogue: SMS/WhatsApp/chat alerts still carry confidence, impact and signed approve/dismiss links, and email subjects carry the finding (**owner decision**) |
| High (386): "mailbox proof" gates nothing: sign-in never checks `email_verified` (the flag is returned only in the signup response; no web code reads it); with `EMAIL_VERIFICATION_ENABLED` unset the squatting weakness is unchanged; with it on, the real owner clicking the link verifies the squatter's account | confirmed. Fixed the claim, not the design: PR 386 title/body and code comment now state the limit. The real fix (account with no usable password + emailed set-password link) changes the join form and account model: **owner decision** |
| Med (387): read-only line promised an organizer path that does not exist (joiners get `viewer`; only operators change roles); focus dropped after remove and Keep it | fixed on 387 (copy now says this account cannot add or remove; focus restored, tested with mutations). **Owner decision:** should the organizer be able to grant edit rights? |
| Med (384): touch-target regex counted h-10 (40px) and h-11 (44px) as 48px and only scanned buttons | fixed on 384 (explicit helper with its own tests, scans button-styled links, mutation red) |
| Med (386/380): waiting screen silent on the 14-day expiry; "we will email you" false if mail is unconfigured or mistyped; expired requests kept password hashes | fixed on 386: screen says 14 days, address check and what to do; expired requests are deleted when the organizer opens the list (mutation red) |
| Med: checklist email subject names the event type (to the reporter only; the vault reminder subject is generic) | not changed: **owner decision** on the safeguarding default for subjects |
| Low (385): allow-list is file-level; `auth-email.ts` is a blanket entry; "every live kind has a sender" is satisfied by the list, not the code | accepted; stated in the PR |

**Merge order recommended by the critic** (git merge-tree found no conflicts between PR heads): 378, 379, 380 (before 381, because the catalogue lists `join_approved` as live), 381, 383, 382, 384, 385, 387, 386. Stacked: 384 and 387 on 379, 385 on 381, 386 on 380, 382 on 378. Merging is yours; nothing here merges.

Owner decisions collected so far: SMS/WhatsApp detail and approve links; join account model (set-password link); whether production has `EMAIL_VERIFICATION_ENABLED` or OTP login on; organizer-granted edit rights; safeguarding default for email subjects; noun for "family list" vs "on file"; per-adult or organizer-only mute; plus 2c, 3b, 4c, 5a, 6a, 7, 8, (g), (h).

Also blocked: anything serving the external-person view (PRD-229); the shell footer contrast token (shell-wide).

Owner-only items: merges and deploy; a real-API two-adult end-to-end run; the decisions above.
