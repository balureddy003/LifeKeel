# UX journey, ease of access and notifications: critic review, round 1

Date: 2026-11-07. Branch reviewed: `feat/domain-pack-contract` (PR 378). Review only: no app code changed, nothing committed, no database or `.env` touched.

Method and honesty note: this round is a static read of the code (web routes, components, tailwind/css tokens, the API delivery, reminder and heartbeat modules) against CLAUDE.md and ARCHITECTURE.md section 9. I did NOT run the web app or a mock API this round, so contrast ratios, real tap counts and screen-reader output are inferred from classes and markup, not measured. Round 2 should start with a measured pass (Playwright + axe at 375px) to confirm the findings marked "inferred". Line numbers are against the working tree at review time.

Binding constraints used throughout: (1) trust tiers, "autonomous" means discover, prepare and surface for approval, never act; (2) facts, dates and steps only, no advice; (3) no model training on family content, AI only through the task gateway; (4) notifications engaging without dark patterns.

---

## 1. Verdict and the five highest-impact changes

**Verdict.** The foundations are better than most family products: a generic, lock-screen-safe push payload, a real notification budget with a ledger, a consent-and-suspend scope contract, a both-adults confirm that is versioned (409 on stale), and plain, non-advisory copy. What is missing is the connective tissue. The product is built as a set of correct pages, but nothing carries the second adult from "invited" to "confirmed", nothing tells a family that a date is coming up in the new domain packs, and the settings and domains screens still use sub-48px, small-type controls that a stressed adult on a phone will miss. The loop "something changed, tell the right person, one tap to review" does not yet exist for domain packs.

**Top five changes (ordered by impact over effort).**

1. **Tell the other adult, and tell the joiner.** Approving a join request sends no message to the person who asked (no send in `apps/api/src/routes/family-join.ts` approve handler, lines 233-345; the joiner is told on `InviteJoinClient.tsx:213-219` to "sign in" later, with no signal when it is time). Likewise a both-adults confirm on a domain never prompts the second adult. This is the stall point the earlier join/approve finding named. Fix: a generic "waiting on you" notification (kind `adult_action_needed`) plus a joiner-approved email. Effort M.
2. **Make the domains pack reachable and alive.** `/domains` is linked only by a footnote under the three doors (`ThreeDoors.tsx:67-71`), is absent from the nav, and its "Coming up" dates (MOT, renewals) are computed only when someone opens the page (`domains/page.tsx:195-207`); no job or delivery path reads them. Fix: nav entry plus a daily dated-obligation sweep feeding the existing delivery router. Effort M.
3. **Raise every control to 48px and kill 11-12px control text on settings and domains.** Seven separate controls are 24-40px high (see Lens B). Effort S.
4. **Shorten the path to first value and to the second adult.** Welcome carousel is 5 slides before signup (`welcome/page.tsx:12-38`); the invite prompt sends the organizer to `/settings?add=1`, a 1,580-line page. Fix: skip-by-default welcome, a one-screen "invite the other adult" with a share link, and a post-signup landing on the first question. Effort M.
5. **One preference model with plain "why you got this" and per-kind mute.** Today there are three overlapping mute mechanisms (digest mode, domain mutes list that does not include the new packs, and the scope contract) and the "why" is only in the email footer. Fix: a single catalogue of notification kinds, each with a one-line reason, a mute and a quiet-hours rule that honours a time zone. Effort L, but the catalogue is what lets every later round stay small.

---

## 2. Findings per lens

Severity: High = blocks or misleads a stressed user, or breaks a stated principle. Med = real friction. Low = polish. Effort: S under half a day, M a day or two, L multi-PR.

### Lens A: first-time adult, stressed, phone (375px)

Walk: landing -> `/welcome` (5 slides) or `/signup` -> verify (OTP possible) -> home -> pick one of three doors -> first value -> invite other adult -> they join -> organizer approves -> they sign in -> both confirm.

Rough count to first value, inferred from markup: 5 Continue taps (or 1 "Skip", which exists but is a small muted text link at `welcome/page.tsx:130-134`), 3 fields + captcha + submit on signup (`signup/page.tsx:148-224`), possibly an OTP step (`signup/page.tsx:85`), then a door tap, then the question form. Roughly 11 to 16 taps and 3 to 4 decisions, plus two waits (email OTP, captcha). To the **second adult being able to see anything**: organizer opens settings, finds the invite, shares a code or sends an email; joiner fills 3 fields + captcha; waits for organizer approval; organizer must notice the request; joiner must remember to sign in; then a confirm. That is 4 handoffs with no push between them.

| # | Sev | Evidence | Friction | Smallest fix | Effort |
|---|---|---|---|---|---|
| A1 | High | `InviteJoinClient.tsx:213-219`, `family-join.ts:233-345` | After approval the joiner receives nothing; they were told to "sign in" at some later time. The organizer sees the request only if they open home (`InvitePartnerPrompt.tsx:94-109`). | Email the joiner on approve ("You can now sign in", deep link to `/login`); push/email the organizer when a request arrives (generic text). | M |
| A2 | High | `domains/page.tsx:239-262` | The second adult is never prompted to confirm. The confirm card says "Waiting for X to confirm" to the first adult, and the second only finds it by guessing `/domains`. | `adult_action_needed` notification and a home card "Review what is on file" for a pending confirm. | M |
| A3 | High | `ThreeDoors.tsx:67-71`, no nav entry (grep of NavRail/AppShell finds none) | The domains page (the new "who is covered by which policy" value) is a 12px footnote link, easy to miss; nothing leads to the car pack at all. | Make "What is on file" a fourth, equal tile and add it to the nav. | S |
| A4 | Med | `welcome/page.tsx:12-38,100-118` | Five marketing slides before the first field; "Skip to sign up" is quiet text. Stressed users read this as delay. | Default to 1 slide or none for returning-intent traffic; make skip a real 48px button. | S |
| A5 | Med | `signup/page.tsx:148-224` + `result.otp` route | Account creation can add an OTP wait before any value. Unclear message about what happens next on `/verify-otp`. | Show "We emailed a 6-digit code to a***@..." with a resend and a wrong-email link; carry the user's destination across (already done via `next`). | S |
| A6 | Med | `InvitePartnerPrompt.tsx:48-53` copy: "If something happens, the chart only helps if someone else can find it." | Mild fear framing (see Lens C) and it sends to `/settings?add=1` rather than a focused invite step. | Neutral copy ("Add the other adult so they can see this too") and a dedicated one-screen invite with a copyable link. | M |
| A7 | Med | `domains/page.tsx:108-127` | Pack list cards use `<a href>` with a plain page reload (not `Link`) and show only title+summary: no counts, no "2 of 3 confirmed". | Add "n records, waiting for [name]" status per pack, use `Link`. | S |
| A8 | Med | `domains/page.tsx:141-155` empty state | "Nothing on file yet." then a financial-profile link only for adapter packs. For the car pack the next step is only the small ghost "Add a vehicle" button below. | Empty state names the one next action as a primary button. | S |
| A9 | Med | `AddRecordForm.tsx:62-65,90` | Every field is "(optional)" and Save is disabled until at least one has text, with no message why. The first field (e.g. registration) is not marked as the useful one. | Mark nothing "optional"; start with one required identifying field and show helper text for why Save is off. | S |
| A10 | Low | `domains/page.tsx:171-174` | Matrix cell words "Holds it and is covered" are long and nowrap, forcing sideways scroll (see B1). | Short labels with a legend, or stack rows on narrow screens. | M |
| A11 | Low | `InviteJoinClient.tsx:127,223` | "Join your family on Keel" vs "LifeKeel" elsewhere; "Keel account" vs "LifeKeel account" in copy at line ~130. Product naming drifts. | One name in copy. | S |
| A12 | Low | `domains/page.tsx:235-262` | "I have seen this" is the confirm label. It is honest, but a stressed user may not know what they are confirming (a version of a list). | Add the date and record count beside the button ("List updated 3 Nov, 4 records"). | S |

**Three-door home (`ThreeDoors.tsx`).** Works: equal weight, plain verbs, copy states what you get (lines 20-39). Issues: door 1 and door 2 both go to `/briefs` (second with `?start=handover_gap`), so two of three doors land on the same 1,786-line page and the user cannot tell which one they are in; descriptions are `text-xs` (15px after the global override at `globals.css:370`) in `ink-tertiary`, the lowest-contrast text token; the cards are links wrapping a `GlassCard` with no accessible description beyond the visible text (fine), but there is no fourth door for "what is on file". Fix A3 covers it.

### Lens B: accessibility and UI craft

Good, keep: `:focus-visible` outlines exist globally (`globals.css:146-150`, `:360`); `prefers-reduced-motion` is handled in two places (`:137`, `:443`); a table with `<caption class="sr-only">`, `scope="col"` and `scope="row"` on the matrix (`domains/page.tsx:151-181`) is the right structure; `role="status"` on the confirm summary and the loading skeleton; `aria-pressed` on the playbook chips; labels use `htmlFor`; ink tokens were tuned for 4.5:1 (`tailwind.config`: comment at the `ink-tertiary` entry); text-xs is lifted to 15px and labels to 16px on screen (`globals.css:367-371`).

| # | Sev | Evidence | Friction | Smallest fix | Effort |
|---|---|---|---|---|---|
| B1 | High | `domains/page.tsx:150-181` | Matrix is `overflow-x-auto` with `min-w-[520px]`. The scroll container is not focusable, has no label and no sticky first column: a keyboard-only user cannot scroll it, and a sighted phone user loses the row header while scrolling. Screen readers do read table semantics correctly, so the structure is fine; the container is the problem. | Add `tabIndex={0}`, `role="region"`, `aria-label={matrix.label}` to the wrapper, sticky first column (`sticky left-0 bg-surface-1`). Longer term, below ~640px render each row as a labelled list ("Policy X: Alex holds it, Sam covered"). | S then M |
| B2 | High | `domains/page.tsx:275`, `RecordList.tsx:51`, `AddRecordForm.tsx:13` | Playbook chips, remove button and "Add a ..." ghost are `min-h-[40px]`, below the 48px target the rest of the page uses. Remove (trash icon, 40px, destructive) sits next to content with no confirm. | `min-h-[48px]` everywhere; confirm before delete via the existing `ConfirmSheetProvider`. | S |
| B3 | High | `ChannelsCard.tsx:77`; `NotificationsCard.tsx:80,88,139,157,190,209,252,274`; arrow buttons `:107-122` | Notification and channel controls are `py-1`/`py-1.5` with `text-xs`: roughly 28-36px tall. The channel reorder arrows have no padding at all (glyph-sized, about 16px). These are the mute and quiet-hours controls, which is exactly where a stressed or older user needs big targets. | One shared `Chip`/`SelectField` component at 48px; arrows replaced by a "Make first" button or drag-free list. | M |
| B4 | Med | `domains/page.tsx:249` | `role="status"` is on the confirm sentence, so a change from "Waiting for Sam" to "All 2 adults have seen this" is announced, which is good. But the toast "Confirmed" is a second announcement of the same event, and error toasts for add/remove rely on `Toast` live-region behaviour not verified this round. | Verify in the measured pass; announce once. | S |
| B5 | Med | `ThreeDoors.tsx:56`, `domains/page.tsx:117`, many `text-xs text-ink-tertiary` | Secondary text uses the lowest-contrast token at 15px. The dark theme token `184 202 189` on dark surfaces is probably fine; the light theme `82 97 91` on `surface-0` needs a measured check (inferred, not measured). Cards use translucent glass that can reduce contrast over images. | Run axe/contrast in the measured pass; move descriptive text to `ink-secondary`. | S |
| B6 | Med | `domains/page.tsx:239-261`, `ChannelsCard.tsx`, others | Colour-only cues: success tick is beside text (fine), but the playbook chip selected state is colour plus `aria-pressed` (fine for AT, weak for low vision: only fill colour changes). Danger text for errors in `ChannelsCard.tsx:84` has no icon. | Add a check icon on selected chips and a leading icon on errors. | S |
| B7 | Med | `InviteJoinClient.tsx` vs `domains/*` vs `welcome` vs `signup` | Four component dialects on the critical path: `lk-btn` (signup/welcome), `glass-input rounded-2xl` + framer-motion button (invite), `inputCls`/`primaryBtn` strings (domains), `rounded-lg py-1.5` chips (settings). Focus ring differs between them (`ring-2 ring-family-500/40` vs global outline). Inconsistent buttons also means inconsistent hit areas. | Extract `Button`, `Field`, `Chip` primitives; migrate the three journey pages first. | L |
| B8 | Med | `InviteJoinClient.tsx:111-112,271-276` | Password hint `role="status" aria-live="polite"` announces on every keystroke ("7 more characters needed") which is noisy for screen readers. | Debounce, or announce only on blur/submit. | S |
| B9 | Low | `domains/page.tsx:131-138,102` | Loading `role="status" aria-label="Loading"` is good; the initial `id===undefined` state renders an empty `<main>` with no heading, so a screen-reader user lands on an empty page momentarily. | Render the `PageHeader` first. | S |
| B10 | Low | `AddRecordForm.tsx:55-58` | The add form opens in place; focus is not moved to its first field or heading, and on Save it closes without moving focus anywhere (focus is lost to `body`). | Focus management on open/close. | S |
| B11 | Low | Text scaling | The `@media screen` overrides set absolute pixel sizes (`15px`, `16px`, `globals.css:367-371`) and `font-size: 17px` on the root (`:36`). Absolute px resists browser text-size settings. Inferred; verify at 200%. | Use rem. | S |
| B12 | Low | `welcome/page.tsx:100-118` | Slide dots are buttons with good labels but tiny hit areas (`lk-dot`); the carousel announcement uses a `role=status` hidden line (good). | 48px targets or drop dots. | S |

### Lens C: notifications and "it works for me"

See section 3 for the full inventory and design. Headline findings:

| # | Sev | Evidence | Friction | Smallest fix | Effort |
|---|---|---|---|---|---|
| C1 | High | `jobs/member-agent-loop.ts:19-20`, `member-nudges.ts` | Nudges are computed, persisted and deduped daily, but the loop explicitly delivers nothing ("No delivery"). Valuable discovery output goes nowhere unless the user opens a page. | A separate, Tier 0 delivery step that turns a new open nudge into at most one generic "something to review" notification through `decideSend`. | M |
| C2 | High | `family-domains.ts` (no notify/emit hits), no job reads domain `planning` | Domain-pack dates ("Coming up") and the both-adults confirm produce no notification at all. MOT, renewals in the car pack, a changed record needing re-confirm: silent. | Dated-obligation sweep (exempt class `dated_obligation`, which the budget already supports) plus `adult_action_needed`. | M |
| C3 | High | `delivery-router.ts:84-103`, comment "quiet_hours ... evaluated in UTC" | Quiet hours are UTC, so a UK summer user's "21:00 to 08:00" is actually 22:00 to 09:00, and a user anywhere else is off by hours. Quiet hours also do not apply to escalations (`:776-780`) by design. | Add a family time zone (IANA) with a UTC fallback, as the code comment already proposes. | M |
| C4 | Med | `NotificationsCard.tsx:25` `DOMAINS` list = emergency_fund, protection, retirement, education, estate | Per-domain mute does not include the new packs (life protection, car) or "family confirmations", so those cannot be muted separately once they notify. | Drive the mute list from the notification catalogue, not a constant. | M |
| C5 | Med | `notification-budget.ts:BUDGET` | The caps are tenant-level and, by the file's own header, "a hypothesis with no supporting evidence". Two non-digest messages per month is very tight if three kinds are added; exempt kinds bypass it. Tenant-level means one adult's inbox can starve the other's. | Keep caps, add a per-member ledger key and measure drops (the ledger exists); decide numbers in Round 5. | M |
| C6 | Med | `InvitePartnerPrompt.tsx:48-53` | "If something happens, the chart only helps if someone else can find it." is a mild fear appeal. Not false urgency, but it is guilt-adjacent. Weekly cap and a two-dismissal limit are good. | Neutral copy (see 3.3). | S |
| C7 | Med | `NotificationsCard.tsx:~60-100` digest offer: "You haven't opened the last two alerts." | Keyed on clicks not opens (good, per budget file), but the copy says "opened" and reads as a scold. | "Two recent alerts had no response. Want one monthly summary instead?" | S |
| C8 | Med | `push-payload.ts:26-33` | Payload is correctly generic, but it is only two strings ("important update" vs "new update"). Because "important" is the only differentiator, a push cannot tell the user which area it is without opening, and a shared-device lock screen is protected. Good tradeoff, but one more safe bit (area word such as "Family list") would raise tap-through without leaking. | Allow a closed set of non-sensitive area labels (see 3.3). Needs the privacy review. | S |
| C9 | Low | `family-heartbeat.ts` header | Monthly digest: sends "always, even when nothing changed" and only claims a check when the daily sweep ran in the last 48h; otherwise sends the honest "could not check" variant. This is the best-designed message in the product and is the template for the "nothing changed" note. | Reuse as the model. | - |
| C10 | Low | `checklist-reminder.ts` | Reminds only the reporting user after 3 days of an unfinished life-event checklist. Email only, no push, and appropriate for sensitive events. | Keep email-only. | - |

---

## 3. Notification system design

### 3.1 Inventory of what exists today

| # | Notification | Trigger | Channel | Copy style | Frequency control | Mute / opt-in | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Insight alert (Tier A) | Detector insight at or above `min_urgency` | Router order: configurable among push, email, SMS, WhatsApp (`delivery-router.ts`) | Push body generic (`push-payload.ts:25-33`); email carries more behind sign-in | `notification-budget.ts`: 1 per 14 days, 2 per month shared with C and D; critical/dated/safety/released exempt; dropped alerts queue to the digest | Urgency floor, quiet hours (UTC), digest mode, per-domain mute list, "digest only" offer | Useful. Good safeguards; quiet hours need a time zone; "important" push is the only urgency signal. |
| 2 | Policy renewal reminder (Tier 3) | `jobs/policy-renewal-reminders.ts`, hourly; 30 and 7 days before a renewal date on the profile | Push to registered devices | Fixed template, deterministic, no LLM | Deduped per policy+date+lead; self-cancels if policy changes; consent re-read at send | Scope contract `policy_renewal_reminders` (`scope-contracts.ts:~75-85`): explicit grant, one-action collapse, auto-suspend after 3 failures; `/reminders` list and cancel | The reference design. Dated obligation, opt-in, visible, cancellable. Check that the push body stays generic. |
| 3 | Quiet Care digest / weekly heartbeat | Monthly cron (1st, 08:00 UTC) and weekly opt-in (`jobs/family-heartbeat.ts`) | Email only; push builders exist (`push-payload.ts:36-45`) | Monthly always sends; honest "could not check" variant | One per member per window (`heartbeat_sends`) | `heartbeat_cadence` weekly / monthly / off; unsubscribe link; quiet-weeks flag | Best in class for honesty. Candidate base for "what changed / nothing changed". |
| 4 | Life-event vault reminder | A bereavement/disability/medical event reported (`life-events/vault-reminder.ts`) | Email + in-app insight | Informational; no access granted | One per event, dedupe via insight | None specific | Appropriate; safeguarding-sensitive (a partner learns of an event). Keep email-only. |
| 5 | Life-event checklist reminder | 3 days after an event with unchecked steps (`checklist-reminder.ts`) | Email to reporter only | Informational | Once per event (`checklist_reminder_sent`) | None specific | Appropriate. |
| 6 | Member nudges (PRD-127) | Daily loop (`member-agent-loop.ts`, `member-nudges.ts`) | In-app only; "No delivery" by design | Per-nudge title/detail | Deduped per member/kind/subject; dismissed stays dismissed; self-resolves | Dismiss | Good state machine, no outbound. Opportunity (C1). |
| 7 | Escalation | Insight unacknowledged (`insight-sla-worker`, `escalation-worker`, `drainDeliveryQueue`) | Router queue | Escalation copy | Bypasses floor, quiet hours and per-channel dedup by design (`delivery-router.ts:776-780`) | None | Needs a hard ceiling (see 3.5): a bypass of quiet hours must be limited to safety. |
| 8 | Digest-only offer | Two unanswered A/C alerts (`maybeOfferDigestOnly`) | In settings and next digest | "You haven't opened ..." | 90-day cooldown after a no | Accept or decline | Good mechanism, scolding copy (C7). |
| 9 | In-app invite prompt | Organizer with fewer than 2 joined (`InvitePartnerPrompt.tsx`) | In-app card | Fear-adjacent copy | At most weekly; stops after 2 dismissals; local only | "Not now" | Fine cadence, change copy. |
| 10 | Join request card | Pending access request (`PartnerCard`) | In-app card on home only | "X asked to join your family" | None needed | n/a | Needs an outbound tell (A1). |
| 11 | Connector health, AI health, billing, continuity | Jobs: `connector-health-alert`, `ai-health-alert`, `billing-cron`, `continuity-check` | Email/operator | Not reviewed in depth this round | Not reviewed | Not reviewed | Out of scope of the family journey; list for Round 5 audit. |
| 12 | Domain packs: upcoming dates, confirm waiting | None | None | n/a | n/a | n/a | **Gap** (C2). |

### 3.2 Gaps

1. No outbound for domain packs (dates, confirm waiting, record changed).
2. No outbound to the joiner on approval, none to the organizer on a request.
3. Quiet hours in UTC only; no family time zone.
4. Mute is split across digest mode, a hard-coded domain list and a scope contract; "why you got this" lives only in email footers.
5. Nudges and discovery run but never reach the family.
6. No per-member preferences; budget and prefs are tenant-level (by the code's own note).
7. No "nothing changed" signal for packs, though the family digest has the pattern.
8. Escalation can bypass quiet hours with no stated ceiling.

### 3.3 Proposed catalogue

Rules that apply to every item: title is always "LifeKeel"; the push body is chosen from a closed list of strings (below), never composed from record data; the detail is behind sign-in after the deep link; no approve or dismiss link in any message (matches `push-payload.ts` header and ARCHITECTURE.md section 9 on signed links being weaker consent); every message carries a footer line "Why you got this: [reason]. Mute this kind: [link to in-app mute]". "Prepared for you" means a draft or summary exists and **nothing has been sent or changed**.

Columns: Tier-fit = fits trust tiers; Advice = fits the advice rule; Review = needs a privacy or safeguarding review before build.

| ID | Kind | Trigger (data used) | Lock-screen copy (push) | In-app / email detail (after sign-in) | Cadence cap | Tier-fit | Advice | Review |
|---|---|---|---|---|---|---|---|---|
| N1 | `date_upcoming` | Renewal date or MOT due on a pack record, or a profile policy renewal, at 30 and 7 days (existing lead_days). Data: `domain_records` dates, profile policy dates. | "A date on your family list is coming up." | "Car policy renewal on 14 Dec, 30 days away. Records on file: provider, held by Alex. Compare quotes from several insurers if you want to; LifeKeel does not arrange it." (facts + existing "licensed professional" pattern) | At most 2 per item (30d, 7d); exempt class `dated_obligation` but still ledgered; max 1 date push per family per day (batched) | Yes (Tier 0/3 notify only; existing scope contract extended with a catalogue entry, not a new flag-less behaviour) | Yes, facts and dates only | Yes (light): confirm the area wording list |
| N2 | `adult_action_needed` | A pack version changed or first filled and the other required adult has not confirmed. Data: `confirmation.required` vs `confirmed`. | "Something on the family list is waiting for you." | "Alex updated Life and income protection (3 records). Review and tap 'I have seen this'." | 1 on change, 1 reminder after 3 days, then stop; never again for the same version | Yes (asks the human; no action) | Yes | Yes, safeguarding: name only the family member, never the content; do not send if the changer chose "private to me" (not built, see 5) |
| N3 | `join_request` | New access request (`family-join.ts`). | "Someone asked to join your family list." | "Sam asked to join. They see nothing until you approve." with link to review. | 1 per request, 1 reminder after 2 days | Yes (the approval is the human gate; do not auto-approve) | Yes | Yes: do not put the requester's name in a push |
| N4 | `join_approved` | Organizer approved a request. | Email only (joiner has no push yet): subject "You can now sign in to LifeKeel" | "Alex approved your request. Sign in with the email you used." | 1 | Yes | Yes | No |
| N5 | `document_ready_to_file` | New upload or newly connected-and-allowed document (existing OCR/extraction path) produced a draft record, e.g. a policy summary. Data: extraction output, **already user-allowed source**. | "A document is ready to review." | "We read the document you added and prepared a draft record: provider, policy type, renewal date. Nothing is saved until you check and confirm." (Tier 1 prepare, `ExtractionReview.tsx` already exists) | 1 per document, batch same-day uploads into one | Yes (prepare, human saves) | Yes | Yes: gateway task must exist and be allow-listed (`definitions/ai-tasks.yaml`), content-minimised, no raw text in the message |
| N6 | `holder_changed` | A policy's holder is no longer on the roster, or a roster member was removed while still named on records (data: roster vs record holder). | "A detail on your family list may need a look." | "Two records name someone who is no longer on the family list. Check who each should belong to." (facts only) | 1 per change; at most 1 reminder at 7 days | Yes | Yes (no judgement) | Yes, safeguarding: separation, bereavement and removed-adult cases; default to email-only and in-app, never push |
| N7 | `monthly_note` | Monthly, extends the Quiet Care digest. Data: counts of records added, edited, confirmed, dates in the next 60 days, and "nothing changed" when true (`job_runs` sweep freshness, as `family-heartbeat.ts` already does). | "Your monthly family list note is ready." | "This month: 1 record added, 1 date in the next 60 days (car policy renewal, 14 Dec). Nothing else changed." or "Nothing changed this month. Next date: 14 Dec." | 1 per month; always sent (honest "could not check" variant exists) | Yes | Yes, no figures in the push | Light: one more field in an existing email |
| N8 | `waiting_nudge_digest` | Open member nudges accumulated (from `member_nudges`). Data: counts per kind. | (no push) | Appears only inside the monthly note as "3 items open". | Folded into N7, never separate | Yes | Yes | No |
| N9 | `connector_needs_attention` | Existing connector-health alert, reused. | "A connected account needs your attention." | Existing. | Existing | Yes | Yes | No (already exists) |

Why this stays engaging without dark patterns: each message is (a) triggered by a real date or a real change, (b) capped and de-duplicated, (c) one tap to a screen that finishes the job, (d) mutable per kind, (e) never counts "streaks", "days since you last visited", "your family is waiting", or percentage-complete pressure.

### 3.4 Closed set of lock-screen strings

Only these push bodies may exist, with title always "LifeKeel": the two existing generic ones, plus "A date on your family list is coming up.", "Something on the family list is waiting for you.", "Someone asked to join your family list.", "A document is ready to review.", "A detail on your family list may need a look.", "Your monthly family list note is ready.", "A connected account needs your attention." A unit test should assert that every push body is in this set and contains no digit, currency symbol, or capitalised name (this is the acceptance check for Round 2).

### 3.5 Cadence, quiet hours and mute model

- **Caps (proposal, to measure via the ledger):** keep Tier A 1 per 14 days; dated obligations are exempt from the monthly budget but get their own cap of 1 push per family per day and 4 per month; `adult_action_needed` at most 2 per week per family across all packs; everything else folds into the monthly note. Any drop goes to the monthly note (existing behaviour: dropped alerts queue to the digest).
- **Quiet hours:** per family, with an IANA time zone, default 21:00 to 08:00 local; everything except `safety` waits until morning. Escalation (`delivery-router.ts:776`) may bypass quiet hours only for a declared safety class, never for a date reminder.
- **Mute model:** three layers, all visible in one screen. (1) Per kind on/off, driven by the catalogue, each with its one-line "why you get this". (2) Per channel (push, email) per kind. (3) Per pack ("mute car dates"). A global "pause everything except safety for 7, 30 or 90 days". Everyone can mute their own device; only the organizer changes family-wide defaults (as today). Muting a kind is never answered by a re-ask for at least 90 days (matches `offer_cooldown_days`).
- **"Why you got this":** one sentence in every message and in a "Recent messages" list in settings that shows, for the last 30 days, kind, time and reason, counts only (the ledger already holds this: tier, kind, outcome, reason).
- **Approval-first pattern ("prepared for you, tap to review"):** for N5 and any future auto-discovered fact: the system writes a draft in a `pending_review` state; the message says only that a draft is ready; the screen shows the source ("from the document you uploaded on 3 Nov"), the fields it read, and two buttons "Save to the list" and "Not right"; nothing is stored in the family record or shared with the other adult until a human taps Save; the audit log records `approvedBy`. This stays Tier 1.
- **Safeguarding defaults:** push is off by default for N2, N3, N6; email is the default for those; N6 and anything touching a bereavement, separation or health context is in-app and email only, never named.

---

## 4. Proposed iteration plan (Rounds 2 to N)

One concern per PR, draft until ready, small enough for `/review-pr`. Acceptance checks are written so a critic can re-run them. "Owner decision" means a human must decide before work starts.

| Round | PR (one concern) | Acceptance check a critic can re-run | Owner decision first? |
|---|---|---|---|
| 2a | **Touch targets and type**: shared `Chip`/`Button` at 48px; fix B2, B3 on domains and settings | Playwright + axe at 375px: every interactive element on `/domains`, `/settings#notifications`, `/invite/*` has a bounding box at least 48x48; no control text under 16px | No |
| 2b | **Matrix region**: focusable, labelled scroll region + sticky first column (B1); empty states with one primary action (A8) | Keyboard-only: Tab reaches the table, arrow keys scroll; screen reader reads "region, [label]"; row header stays visible at 375px | No |
| 2c | **Domains reachable**: fourth door and nav entry (A3), pack list shows record count and confirm state (A7) | From home, "What is on file" is reachable in 1 tap; pack list shows who is awaited | Small: name for the fourth door |
| 3a | **Joiner and request messages** (A1, N3, N4): email on approve; generic notification to organizer on request | Approve in a test tenant: joiner receives one email with a sign-in link in under 1 min; organizer push body is in the closed set and has no name | No (uses existing email path) |
| 3b | **`adult_action_needed`** (A2, N2) with reminder cap | Change a pack: second adult receives 1 message; no second reminder for the same version; message contains no record content | **Yes**: safeguarding sign-off on N2 wording and on whether an adult may mark a record "private" |
| 4a | **Closed set of push strings + unit test** (3.4) | Test fails if any body contains a digit, currency symbol or name; every kind appears in the catalogue | No |
| 4b | **Notification catalogue and "why you got this"** (one source of truth, replaces the `DOMAINS` const, adds footer line and settings list) | Every message kind has reason text and a mute; muting a kind stops it within one run; ledger shows reason | No |
| 4c | **Family time zone for quiet hours** (C3) | A family in Europe/London with 21:00-08:00 receives nothing at 21:30 local in both GMT and BST; UTC fallback when unset | **Yes**: where the time zone is collected (profile at signup vs settings) |
| 5a | **Dated-obligation sweep for packs** (N1): daily job reading pack `planning` triggers and profile renewals, through `decideSend` as exempt `dated_obligation` | A record with MOT due in 30 days causes exactly 1 push at 30d and 1 at 7d, none after the date, none if muted; ledger rows present | **Yes**: confirm that pack dates reuse the `policy_renewal_reminders` scope grant or need a new catalogue entry |
| 5b | **Monthly note extension** (N7, N8): add pack counts and "nothing changed" to the existing digest | Month with no changes sends "Nothing changed this month"; a month with a stale sweep sends the "could not check" variant; push body has no figure | No |
| 6a | **Shortened first value**: welcome defaults to skip, one-screen invite with copyable link, post-signup lands on first question (A4, A6) | New-user script: first value reached in at most 8 taps and 3 fields (from landing, excluding OTP); invite link created in at most 2 taps | **Yes**: whether to drop the carousel for all traffic |
| 6b | **Neutral copy pass** (C6, C7, A11): invite prompt, digest offer, naming | Copy lint: no fear, guilt or streak phrases from a banned list; product named "LifeKeel" everywhere | No |
| 7 | **Document-ready draft** (N5): approval-first extraction notification | Upload a sample document: draft appears, message says "ready to review", record is not saved until tap, audit shows `approvedBy` | **Yes**: privacy review and registered gateway task (`definitions/ai-tasks.yaml`) |
| 8 | **Holder changed** (N6) | Remove a roster member who is named on a record: in-app item and email, no push, no name in subject | **Yes**: safeguarding review |
| 9 | **Primitives migration** (B7): migrate invite, signup and welcome to shared `Button`/`Field` | Visual diff: same tokens; focus ring identical on all three | No |
| 10 | **Measured a11y gate in CI** (axe on 6 journey pages, text scaling 200%, reduced motion) | CI fails on new violations; 200% text has no clipped content | No |

Ordering logic: 2a to 2c are cheap and fix the most visible friction; 3a, 3b close the second-adult stall; 4a to 4c make every later message safe and mutable before more are added; 5a and 5b deliver the "it works for me" loop; 6 and later are growth and polish, and 7 and 8 wait on reviews.

---

## 5. Rejected ideas (they would break a constraint)

| Idea | Why rejected |
|---|---|
| Auto-approve the second adult when their email matches, or confirm on their behalf when they open a link | Approval is the human gate (trust tiers); the invite page itself states nothing is created until the organizer approves. Make the human step easier instead. |
| Approve/confirm/dismiss links inside emails or pushes | ARCHITECTURE.md section 9 treats signed notification links as weaker consent; push payload header forbids approve links. Deep link to the authenticated screen only. |
| "Your cover may not be enough", "you are under-insured", coverage-gap scores in a push | Adequacy judgement; advice rule. Facts and dates only. |
| "Renewal due: here are better quotes", provider names, "switch and save" | Regulated arranging and named providers; rule 2. Copy points to a licensed professional or comparing quotes from several insurers, nothing more. |
| Pre-filling a renewal or claims email to the insurer and sending it automatically | Autonomous execution of an external action. A prepared draft the human reads and sends is allowed (Tier 1/2 with `approvedBy`), auto-send is not. |
| Streaks, "5 days in a row", "your family is waiting on you", percentage-complete nags, countdown timers | Dark patterns (constraint 4). |
| Amounts, policy names, conditions or provider names in push or lock-screen text | Content leakage on shared devices; `push-payload.ts` forbids it. |
| Showing "Sam hasn't confirmed yet" to third parties, or a shared leaderboard of who responded | Pressure and privacy. Waiting status is visible only to the family's adults. |
| Training or fine-tuning a model on family notifications, documents or click behaviour to optimise open rates | Rule 3. Timing tuning uses the budget ledger's counts only, no content. |
| Reading connected email to auto-add records without a review step | Autonomous change to the family record. Allowed: discover and prepare a draft (N5), the human saves. |
| Sending SMS/WhatsApp for domain pack events by default | Higher interruption, shared-device risk and cost; keep push/email, with SMS only where the family chooses it today. |
| Raising the monthly budget to "make sure" users hear more | Numbers are untested hypotheses (budget file header). Measure drops via the ledger first (Round 5). |
| Building audit/compliance machinery to support giving advice-like recommendations in notifications | CLAUDE.md rule 2: narrow back to informational instead. |
| Letting any adult change family-wide notification defaults | Today only the organizer can; changing it needs a decision about shared control and is not a quick win. |

---

## Appendix: key files read

`CLAUDE.md`, `ARCHITECTURE.md` section 9 and 10; `apps/api/src/delivery/{push-payload,notification-budget,delivery-router,channels}.ts`; `apps/api/src/{member-nudges.ts,jobs/family-heartbeat.ts,jobs/member-agent-loop.ts,jobs/policy-renewal-reminders.ts,life-events/{checklist,vault}-reminder.ts,family/scope-contracts.ts,routes/{family-join,family-domains,reminders}.ts,domains/{types.ts,packs/car.ts}}`; `apps/web/src/components/{ThreeDoors,InvitePartnerPrompt,ChannelsCard,NotificationsCard}.tsx`; `apps/web/src/app/{domains/*,welcome/page.tsx,signup/page.tsx,invite/[code]/InviteJoinClient.tsx,globals.css}`; `apps/web/src/lib/channel-explain.ts`; `apps/web/tailwind.config.*`.

Not covered this round (list for Round 2): measured contrast, real screen-reader output, `briefs/page.tsx` (1,786 lines) first-value walk, `/settings` invite step, `/verify-otp`, `Toast` live-region behaviour, connector/billing/AI health emails.
