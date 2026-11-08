# Critic pass 2: shipped UX and notification work (PRs 378-383)

Date: 2026-11-07. Read-only review. Method: `gh pr diff/view` and `git show <branch>:<path>` on the six PR branches. I ran nothing in a browser, touched no database, read no `.env`. Anything about contrast, tap size as rendered, focus order or screen-reader output is therefore **inferred from classes and markup, or taken from a PR body I could not re-run**; each is labelled below. Line numbers are approximate (from `git show`, not the working tree).

Constraints applied: CLAUDE.md trust tiers (autonomous = discover and prepare only), no regulated advice, no training on family content, round-1 section 3 and section 5 (rejected ideas).

CI note: PR 382's first check showed no conclusion when I read it; the rest of 378-383 were green. Nothing here was merged or deployed.

---

## 1. Verdict per PR

| PR | Verdict | One-line reason |
|---|---|---|
| 378 domain packs | **needs change (small)** | Authorization and tenant scoping are sound. UX gaps: one-tap permanent delete, no focus management, second adult cannot edit and is not told why. Unrelated erasure edits ride along. |
| 379 round 2a/2b a11y | **needs change** | Body and ledger claim a sticky first column; the code has none. "Measured" evidence is not committed or re-runnable. Control text under 16px remains. |
| 380 joiner approval email | **needs change** | Email itself is good. But the web "waiting" screen still says "we've let {family} know" (false) and never mentions the email; pre-existing mailbox-ownership gap is now amplified. Test file reformatted wholesale (noise). |
| 381 catalogue + closed words + mute | **needs change** | Push words are genuinely closed and tested. The catalogue overstates itself: SMS/WhatsApp/Slack/Teams bodies, other senders and email subjects bypass it; mute has no UI; ledger kind names do not match. |
| 382 digest domain lines | **ok** | Counts and dates only, sent to the same adults, wrapped so failure cannot block the digest. One wording/cadence nit (F10). |
| 383 neutral copy + test | **ok** | Real improvement, honest about being a tripwire. Test is narrow (F16); two phrases are still vague. |

---

## 2. Findings, ranked

Effort: S under half a day, M a day or two, L multi-PR.

### High

**F1. The catalogue says "closed set" and lists `insight_alert` channels as push/email, but the router also sends full alert content over WhatsApp, SMS, Slack and Teams, including confidence %, impact range and approve/dismiss links. (PR 381; pre-existing code, now masked)**
- Where: `apps/api/src/delivery/channels.ts` `buildWhatsAppMessage` and `buildSmsMessage` (~l.250-285): hypothesis, `Confidence: N%`, `Estimated impact: £x-£y`, "Approve: <url> | Dismiss: <url>"; Slack/Teams reuse them. `notification-catalogue.ts` `insight_alert.channels: ['push','email']`.
- Why it matters: round 1 rejected "approve/dismiss links inside messages" and the lock-screen principle (no figures). A family reading "why you got this" in settings is told a narrower truth than reality, and an SMS preview shows figures on a locked phone.
- Smallest fix: (a) make the catalogue `channels` list truthful and add a test that fails when a channel class exists that the catalogue does not list; (b) route WhatsApp/SMS through the same generic catalogue words plus a deep link, and drop approve/dismiss URLs from bodies (approve happens after sign-in). Owner decision only if WhatsApp/SMS must keep detail.
- Effort: M.

**F2. After a join request the joiner is told something untrue and given a path into a dead end; the organizer is still not told. (PR 380 + existing web; 383 touched this page and left it)**
- Where: `apps/web/src/app/invite/[code]/InviteJoinClient.tsx` `RequestJoin`, `submitted` block: "We've let {family} know you'd like to join" and a "Go to sign in" link. 380's own body says the organizer is not notified; no account exists until approval, so that sign-in attempt fails. Nothing says an email will arrive. Deny (`family-join.ts` deny handler) sends nothing, so a declined joiner waits forever.
- Smallest fix: change copy to "Your request is saved. {Organizer} approves it in LifeKeel. We will email {email} when they do." and replace "Go to sign in" with "Back to LifeKeel". Organizer half (3a part 2) stays on the roadmap (see section 4).
- Effort: S for copy; M for organizer notice.

**F3. Round 2b is reported as done but the sticky first column does not exist. (PR 379)**
- Where: PR body "Also: sticky first column on the matrix"; `apps/web/src/app/domains/page.tsx` row header `<th scope="row" className="min-w-[10rem] break-normal p-3 ...">` has no `sticky`/`left-0` (I grepped the branch: no `sticky` anywhere in the file). The ledger row repeats "axe + 48px measured".
- Why it matters: at 375px the table is `min-w-[520px]`, so the policy name scrolls off while the person columns are read. The loop's ledger is the owner's source of truth; it is overstated.
- Smallest fix: add `sticky left-0 bg-surface-1` (and the header cell) and correct the PR body/ledger. Commit the measurement as a re-runnable script (see F9).
- Effort: S.

### Medium

**F4. The catalogue is documentation, not a gate: several live senders are absent or mis-described. (PR 381)**
- Not in the catalogue and not subject to any test: `life-events/checklist-reminder.ts`, `life-events/vault-reminder.ts`, `jobs/continuity-check.ts` (via `auth-email.ts`), `billing/low-credit-alerts.ts`, `marketing/lifecycle-emails.ts`. 
- `life_event_reminder` says "only to the person who reported it", but `vault-reminder.ts` emails **every other active adult**, naming the reporter and the event type (bereavement, medical, disability) in the body. Checklist subject is `Your ${playbookTitle} checklist`, so the event type appears in an email preview on a lock screen. The catalogue's lock-screen rule covers push only.
- `continuity-check` emails say "we haven't seen you in N days" and tell designated contacts the organizer "hasn't checked in for N days". The catalogue header says no message counts days away; this one does (it is an opt-in safety feature, but it must be listed and justified, not contradicted).
- Smallest fix: add the missing kinds with honest audience/reason/`safeguarding`; extend the tripwire pattern of `trust-tier-gate.test.ts`: fail CI if a file outside an allow-list calls `sgMail.send`, `webpush.sendNotification` or a push sender; add a subject-line check (no event type, no digits) for safeguarding kinds.
- Effort: M.

**F5. Mute exists only in the API; a human cannot use it, and it is a silent family-wide decision. (PR 381)**
- No web code reads `kinds` or sets `kinds_muted` (grepped `apps/web/src` on the branch: none). PR body admits "settings screen not built". Only the organizer can PATCH; the second adult is not told that alerts or the digest were muted for them, and the kind copy does not say critical alerts still arrive. PATCH writes no audit entry.
- Smallest fix: settings list (reason, switch, "critical alerts still arrive"); audit the change; optionally per-adult mute for email kinds (owner decision, see section 4).
- Effort: M.

**F6. Budget ledger and catalogue use different kind names. (PR 381)**
- `delivery-router.ts` `deliverReminder` records `kind: 'renewal_reminder'`; catalogue id is `policy_renewal_reminder`. Round-1 4b asked that "ledger shows reason"; it cannot join to the catalogue. 
- Fix: one id set, import the constants into `notification-budget.ts` callers. Effort: S.

**F7. Pre-registration squat: approving a join request creates a verified account for an email nobody proved they own. (PR 380 amplifies; code pre-existing)**
- `family-join.ts` approve: `email_verified: true` with the comment "the invite link proves mailbox ownership", but the code-based `/family/join` path takes a typed email and a chosen password with only Turnstile and an invite code. An attacker with the code can submit a victim's address; if the organizer approves, the attacker holds a verified login on that address, the victim later hits "Email already registered", and 380 now emails the victim "sign in with the email and password you chose".
- Smallest fix: do not activate the request-time password; on approval send a one-time set-password link (the per-member invite token machinery already exists in the same file), or verify the mailbox at request time. Also expire pending requests (no TTL today).
- Effort: M.

**F8. Domains page UX that a stressed adult on a phone will hit. (PR 378, partly unchanged by 379)**
- Delete is one tap, permanent, no confirm or undo (`RecordList.tsx` ~l.46-55), and it resets both adults' confirmations. Now 48px, so easier to hit by accident.
- After "I have seen this" the button unmounts, dropping focus to `<body>`; the result is only in a `role=status` span (inferred from markup, not tested with a screen reader). Opening/cancelling the add form does not move focus. Opening a person in the "If someone dies" picker does not announce the result.
- A joined second adult has JWT role `viewer` (set at approve), so `can_edit` is false: `AddRecordForm` returns `null` silently. The person who just joined sees no way to add anything and no explanation.
- Pack list: `getDomains()` falls back to `{domains: []}`, so a failed load shows a header over blank space; the single-pack error reads "Only adults on the family list can see it" for a network failure too.
- Fix: confirm-then-undo toast for delete; move focus to the status line after confirm and to the first field on open; one line "Only the person who set this up can add or remove records" when `can_edit` is false; a real error state with Retry. Effort: S to M.

**F9. Round 2a/2b acceptance is not re-runnable and the unit tests assert class strings. (PR 379)**
- The new tests check `className` contains `min-h-[48px]`; the browser measurement lives only in the PR body. Settings Approve/Decline were changed "by code, not measured". Control text under 16px remains: chips, ghost buttons, Approve/Decline are `text-sm`; the home footnote link is `text-xs`. Round-1's check was "no control text under 16px".
- Fix: commit a Playwright+axe script at 375px (this is round 10 pulled forward). Effort: M.

**F10. Digest line repeats a not-yet-seen clause every month with no ceiling. (PR 382)**
- `render-quiet-care.ts` `listLines`: "…not yet seen by every adult." appears in every monthly email until the second adult confirms. If that adult never does, it becomes a monthly nag by design. `summariseDomains` also falls back to the oldest overdue date (`upcoming.find(days>=0) ?? upcoming[0]`) so a long-past date is repeated. Domain lines ignore `member_scope: 'mine'`.
- Fix: show the unseen clause only in the first digest after a change and the next one, then drop it; skip overdue-fallback older than 30 days. Effort: S.

**F11. Vocabulary is inconsistent across surfaces. (PRs 378, 381, 382, 383)**
- "family list" means the roster on `/domains` ("people on the family list") but means the records in push/catalogue copy ("A date on your family list"). Invite page says "your family's plan"; digest says "On your family list"; domains page says "What is on file"; confirm line says "this version" (jargon). Vault email still says "Keel never opens…" (round-1 6b acceptance: "LifeKeel everywhere").
- Fix: pick one noun for the records ("family record" or "what is on file") and one for the people ("family members"); change catalogue, digest header, invite page, domains copy together. Effort: S, but copy review needs the owner.

### Low

- **F12 (378)** Vehicle holder is optional in the form, yet a vehicle with no holder is auto-listed under "To check: Not yet matched to a family member". It manufactures a task from a choice the form offered. Fix: make gap text conditional on packs that need holders, or say "Not yet attributed (optional)". S.
- **F13 (378)** Form: every field says "(optional)" and Save is enabled with one field; only the first store record type can ever be added (`recKey` is never changed in the UI). S.
- **F14 (378)** `SECRET_PATTERNS` third regex (13-19 digits with spaces/dashes) will reject some international phone numbers in Recovery/Claims contact with "looks like a password or code". S.
- **F15 (378)** "Adults only" returns 401 (should be 403; the client already has a session). Delete returns 204 and writes an audit row even when nothing matched. No per-tenant cap on records. `erasure.ts` change for `growth_events` and `llm_budget_reservations` is unrelated to domain packs; split it out. S.
- **F16 (383)** `copy-pressure.test.ts` scans 6 files with a phrase blacklist, silently drops files that do not exist (guarded only by `>= 4`), and does not scan `auth-email.ts` (the continuity "haven't seen you in N days" text), the vault/checklist emails, `lifecycle-emails.ts` or `render-heartbeat.ts`. "Two recent alerts had no response" is vague (what is a response to an alert?) and still reads as a nudge; the new invite prompt "You both see the same answer" has no referent on the home screen. S.
- **F17 (381)** `drainDeliveryQueue` (escalations) sends via `sendOnChannel` with no `isKindMuted` check. Escalation needs a prior delivery so a muted kind should not reach it, but a mute set after delivery is not honoured. S.
- **F18 (380)** `sendJoinApprovedEmail` is awaited inside the approve request (latency; swallowed errors are fine). Logs the recipient address at info level (matches existing pattern). The 380 diff reformats about 400 lines of `family-join.test.ts` for 3 real test changes; run prettier in a separate commit next time. S.
- **F19 (379)** Region has `aria-label` identical to the table `<caption>`, so a screen reader announces it twice (inferred). No visible scroll cue. S.

### Verified clean (from code)

- Domain routes: every read and write is tenant-scoped (`getTenantCollection`), adults only for reads and confirm, `isHouseholdEditor` for writes, `.strict()` zod schemas, unknown field keys rejected, roster ids validated, secret-shaped text refused, `no-store` on views, sensitive fields refused on stored records. Confirm is bound to the exact `result_version` with a 409 on stale and an idempotent upsert. No cross-tenant read found. The `external` declaration is stripped from every response.
- 380: only the organizer can approve; the request is deleted first, so the email is sent at most once per request; nothing is sent on 404/403/409. No household data in the body; HTML-escaped name and family.
- 381: push bodies come only from the catalogue; `push-payload.ts` source scan blocks a new sentence; critical alerts cannot be muted; non-mutable kinds are refused with 400.
- 382: push body stays generic; no names/amounts in lines.

---

## 3. Acceptance-check results (against round 1, section 4)

| Round | Check | Result | Evidence |
|---|---|---|---|
| 2a | All interactive elements on `/domains`, `/settings#notifications`, `/invite/*` at least 48x48; no control text under 16px | **Partly** | Code raises chips, remove, ghost button and settings Approve/Decline to `min-h-[48px]` (verified). Domains measurement exists only in the PR body (could not re-run). `/settings#notifications` and `/invite/*` not touched or measured. `text-sm`/`text-xs` control text remains (ThreeDoors link, chips, Approve/Decline). |
| 2b | Table is a focusable labelled region; arrow keys scroll; row header stays visible at 375px; empty states with one primary action | **Partly** | Focusable labelled region: met (verified in code, class-string test). Sticky row header: **not met** (claimed, absent, F3). Empty state: "Nothing on file yet." has no primary action button; form is a ghost button below. |
| 3a | Approve in a test tenant: joiner gets one email with sign-in link in under 1 min; organizer push body in closed set, no name | **Partly** | Joiner email: met in a unit test with a mocked sender (once, right address, `/login` link, no household data). Not run against a real mailbox or timed. Organizer notice: **not built**. Web waiting screen contradicts the new behaviour (F2). |
| 4a | Test fails if any push body has a digit, currency symbol or name; every kind appears in the catalogue | **Partly** | First half: met for push bodies (checker plus source scan, mutation-tested per PR). "Every kind appears": not enforced; sender inventory shows at least five senders absent (F4); SMS/WhatsApp bypass entirely (F1). |
| 4b | Every kind has reason text and a mute; muting stops it within one run; ledger shows reason | **Partly** | Reason text: yes for 13 entries. Mute: only 3 of 6 live kinds are mutable, API-only (F5), heartbeat and router tests show it works. Ledger shows reason: no (names differ, F6). |
| 5b | No-change month sends "Nothing changed"; stale sweep sends "could not check"; push body has no figure | **Partly** | Push body generic: met. The no-change and could-not-check variants are the pre-existing ran/missed variants; this PR adds counts only, no "nothing changed in your lists" signal, and job wiring is not covered end to end (PR says so). |
| 6b | Copy lint: no fear/guilt/streak phrases from a banned list; product named LifeKeel everywhere | **Partly** | Lint exists and is red on the old wording (mutation reported). Narrow scope (F16). "LifeKeel everywhere" not met: vault email still says "Keel never opens…"; "Keel" is also the assistant name so this needs the owner's naming rule. |

Round 2c and 3b, 4c, 5a, 6a, 7, 8 are correctly marked blocked in the ledger; I agree with the blockers except where noted in section 4.

---

## 4. Proposed next rounds, in priority order

Each is one concern per PR.

| # | Round | Needs owner decision first? | Notes |
|---|---|---|---|
| 1 | **Truthful joiner screens** (F2 copy) + sticky column and corrected ledger (F3) | No | S each, ships today. |
| 2 | **Catalogue truthfulness**: complete sender inventory, add CI allow-list tripwire, make `channels` honest, unify kind ids (F1 test, F4, F6) | No | Prerequisite for every future message kind. |
| 3 | **SMS/WhatsApp/Slack/Teams bodies**: generic words + deep link, no approve/dismiss URLs (F1 fix) | **Yes**: does any family rely on detail in WhatsApp/SMS? | Trust-tier and lock-screen issue; default recommendation is generic. |
| 4 | **Settings list for kinds** with reason, switch and "critical still arrives"; audit PATCH (F5) | Small: per-adult mute or organizer-only? | Without this, 4b is not user-visible. |
| 5 | **Measured a11y gate in CI** (F9, round 10 pulled forward) | No | Stops claims drifting from code again. |
| 6 | **Domains page hardening** (F8, F12, F13, F19) | No | Delete-with-undo, focus, viewer explanation, error state. |
| 7 | **Join mailbox proof** (F7) + expiring requests | No (security fix) | Reuse member-invite token flow. |
| 8 | **Organizer notice of a join request** (3a part 2): email and in-app only, no requester name in subject or any push | **Yes**: safeguarding sign-off already flagged | Do not use `adult_action_needed` push. |
| 9 | **Digest cadence cap** (F10) and vocabulary pass (F11) | F11 yes (noun choice) | Small and cheap. |
| 10 | 2c fourth door; 4c time zone; 5a dated-obligation sweep; 6a shortened first value | Yes (as ledger) | For 5a I recommend a **separate consent grant for pack dates**: `policy_renewal_reminders` consent covers policy renewals, not MOT or other pack dates. Treat reuse as an owner call. |
| 11 | Decline notice to joiner | **Yes** | A "declined" email can be harmful in separation cases; silence may be the safer default. |

---

## 5. What must NOT be built, and why

- **Approve, confirm or dismiss links in any email, SMS, WhatsApp or push** (including the future organizer notice for join requests). Round-1 rejected idea; ARCHITECTURE section 9 treats signed links as weaker consent. Deep link to the authenticated screen only. F1 is the existing breach.
- **Automatic "second adult nudges"**: scheduled reminders to the adult who has not confirmed, or per-name "Sam hasn't confirmed" in an email. Waiting status stays inside the signed-in page for family adults. One notice per change, no repeat cadence (pressure and separation-safety risk).
- **"Private to me" records hidden from the other adult** in domain packs, until the owner and safeguarding decide. It changes what each adult can trust the shared view to contain, and the `result_version` confirmation depends on both seeing the same rows.
- **Any push body, email subject or preview text containing an event type, name or figure for a safeguarding kind** (bereavement, medical, disability, holder changed, join request). F4's checklist subject is the model of what to remove.
- **Inactivity counters in new messages** ("N days since you opened…"), and open-tracking pixels to power the digest offer. The current "responded" test uses a signed-in click; keep it. Do not extend the continuity-check pattern to other kinds.
- **A "better policy" or "compare these" step on date reminders** (MOT, renewal, car policy). Rule 2: dates and "compare quotes from several insurers or ask a licensed professional" only.
- **Letting a mute silence critical alerts**, or letting any adult change family-wide defaults without the owner's decision on shared control.
- **Model-written or model-timed notification copy from family content, or tuning send times on content**. Rule 3. Timing tuning stays on ledger counts only.
- **Extending the copy-pressure or advice tests into audit/compliance machinery** to justify wording closer to advice. Narrow the copy instead (CLAUDE.md rule 2).
- **A start-claim or contact-the-provider action on the "If someone dies" picker.** It is Tier 0 information; any prepared outreach belongs to the existing notify-your-provider draft pattern with `approvedBy`.

## Could not verify (explicit)

Contrast ratios and focus rings as rendered; real tap sizes on `/settings` and `/invite/*`; the PR 379 axe and bounding-box numbers; screen-reader behaviour; real email rendering and delivery time for the join-approved message; the real-API two-adult flow (owner-only item in the ledger); heartbeat wiring end to end.
