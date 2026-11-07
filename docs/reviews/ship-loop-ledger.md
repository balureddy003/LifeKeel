# Ship loop ledger

Tracks the rounds in `docs/reviews/ux-journey-notifications-review-2026-11-07.md` (section 4; added in PR 379). One row per round. "Production-ready" here means ready for the owner to merge and deploy. Nothing in this loop merges or deploys.

Updated: 2026-11-07 (loop iteration 3: PRs 378-383 CI green, no review comments; shipped 384; critic pass 2 running, report will be docs/reviews/critic-pass-2-2026-11-07.md).

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

Also blocked: anything serving the external-person view (PRD-229); the shell footer contrast token (shell-wide).

Owner-only items: merges and deploy; a real-API two-adult end-to-end run; the decisions above.
