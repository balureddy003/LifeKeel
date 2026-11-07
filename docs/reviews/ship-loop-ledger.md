# Ship loop ledger

Tracks the rounds in `docs/reviews/ux-journey-notifications-review-2026-11-07.md` (section 4; added in PR 379). One row per round. "Production-ready" here means ready for the owner to merge and deploy. Nothing in this loop merges or deploys.

Updated: 2026-11-07 (loop iteration 5: PRs 378-384 CI green; shipped round (a) as the next PR. Iteration 4: critic pass 2 folded in, report in `docs/reviews/critic-pass-2-2026-11-07.md`; its three High findings fixed on their own PRs).

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
| 9 | Primitives migration | todo | | |
| 10 | Measured a11y gate in CI | open (jsdom half) | [384](https://github.com/balureddy003/LifeKeel/pull/384) | axe + 48px + reduced-motion checks, 3 regressions red; 375px browser gate (Playwright) not built: needs live-stack harness |

## Critic pass 2 (read-only agent; all claims below checked in code before acting)

| Finding | Status |
|---|---|
| High: joiner screen said the family was "let know" and offered a sign-in that fails until approval | fixed on #380 (`PendingApproval`, email promised, test red on old wording) |
| High: catalogue "closed set" implied alerts only reach push and email; SMS/WhatsApp/chat carry the finding, a confidence figure and a signed approve link | catalogue now lists every channel (#381); **owner decision:** whether those messages should drop detail and the approve link (not changed) |
| High: sticky matrix column claimed in #379 but never applied | fixed on #379, measured in browser (row header stays at offset 0 after a 200px scroll); control text raised to 16px |
| Med: vault reminder emails the other adults naming reporter and event type; catalogue said reporter only | fixed on #381: split into checklist (reporter) and vault (other adults, safeguarding) kinds |
| Med: catalogue is not a gate (checklist, vault, continuity, low-credit, lifecycle senders bypass it); budget ledger id `renewal_reminder` vs catalogue `policy_renewal_reminder` | open: [PR 385](https://github.com/balureddy003/LifeKeel/pull/385) sender allow-list tripwire + ledger-kind mapping; continuity emails still uncatalogued (stated in the test) |
| Med: join creates an `email_verified` account without mailbox proof; the new email goes to that unverified address | todo (security fix, no decision needed) |
| Med: domains delete is one tap with no undo; focus lost after "I have seen this"; second adult has `viewer` role and cannot add records, with no explanation | todo (domains hardening) |
| Med: mute is API-only, organizer-only, silent to the second adult | todo: settings list for kinds (owner: per-adult or organizer-only?) |
| Med: digest repeats "not yet seen by every adult" monthly with no ceiling; "family list" means two things | todo (vocabulary needs an owner choice of noun) |
| Acceptance table: 2a, 2b, 3a, 4a, 4b, 5b, 6b all "partly met" | recorded; each todo above closes a gap |

Verified clean by the critic: new domain routes are tenant-scoped, adult/editor-gated, strictly validated, no cross-tenant read found; join-approved email is sent at most once per request and only after organizer approval.

New rounds from the critic, in order: (a) catalogue truthfulness (inventory + tripwire + ids), (b) join mailbox proof + expiring requests, (c) domains page hardening, (d) settings list for kinds [owner: per-adult mute?], (e) digest cadence cap + vocabulary [owner: noun], (f) generic SMS/WhatsApp/chat bodies [owner: does any family rely on the detail?], (g) organizer join-request notice email/in-app only [owner: safeguarding sign-off], (h) decline notice to joiner [owner: silence may be safer in separation cases]. Recommended for 5a: a separate consent grant for pack dates (the renewal-reminder consent does not cover MOT or other pack dates).

Also blocked: anything serving the external-person view (PRD-229); the shell footer contrast token (shell-wide).

Owner-only items: merges and deploy; a real-API two-adult end-to-end run; the decisions above.
