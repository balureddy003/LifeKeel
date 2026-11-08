# End-to-end validation brief: what changed and how to check it

Date: 2026-11-07. Main at the time of writing: `5133cd63`, CI green. For a test agent
(or a human tester) validating the build end to end. Companion docs:
`tester-guide-2026-11-07.md` (people on real phones) and
`usability-test-kit-2026-11-07.md` (how to recruit and run sessions).

## Ground rules for the tester

- **Fictional data only.** Make-believe families, names, policies and dates. Never real
  family content, real documents or real inboxes. The xAI/Grok key is approved only under
  a testing-phase exception (no zero data retention), so real data must not reach it.
- Do not deploy, merge or change production settings. Report; do not fix.
- Nothing below has been run against the real production API, a real mailbox, a real
  microphone or the real voice model unless a section says so. Treat every "expected" as
  a claim to check, not a fact.
- Staging address, two tester inboxes and two accounts (organizer + second adult) are
  needed. They are placeholders in the tester guide: `[staging address]`,
  `[tester-1 inbox]`, `[tester-2 inbox]`.

## Flags and environment that change behaviour

| Setting | Effect | Default |
|---|---|---|
| `NEXT_PUBLIC_ON_DEVICE_VOICE=on` | Shows the on-device voice button on the domains pages | off |
| `?voice=on` (or `?voice=off`) in the URL | Per-device preview of voice; remembered in localStorage key `lk_voice_preview`; consent is still asked | off |
| `EMAIL_VERIFICATION_ENABLED` | When on, a joiner's account needs a confirm link; when off, it does not | deployment's choice (unknown) |
| `MAX_TENANT_UPLOADS_PER_DAY` | Daily upload cap per household | 200 |
| `MAX_TENANT_STORAGE_BYTES` | Storage cap per household | see code |

## What changed, and how to validate it

### 1. Domain packs: the family list (core, plus domains hardening)
Two domains exist: **Life and income protection** (`life_protection`) and **Car and
transport** (`car`). Pages: `/domains` (hub) and one generic page per domain.

API: `GET /family/domains`, `GET /family/domains/:id`,
`GET /family/domains/:id/playbook?member=`,
`POST /family/domains/:id/records/:record`, `DELETE /family/domains/:id/records/:rowId`,
`POST /family/domains/:id/confirm`.

Check:
- Add a policy (life) and a vehicle (car). Rows appear. Note how any field the pack marks
  sensitive is shown and stored (I did not verify this end to end).
- The cover matrix shows member x policy and is read-only, derived data.
- Confirm as adult A, then adult B: status moves to "seen by every adult". Edit any record:
  both adults must confirm again (the version hash changes).
- Remove a record: there is a confirmation step first (no undo exists; do not expect one).
- Dates must be real days (`2027-02-30` and `28/02/2027` are refused). A person that is not
  on the family list is refused. A choice outside the options is refused. Money must be an
  amount with at most two decimals.
- Child and viewer accounts cannot add or remove records and see an explanation, not a
  silent empty state.
- Bereavement playbook shows only steps relevant to records on file.
- Home has three doors (money question / what the other adult should know / first steps if
  something happens). All three are reachable and equally prominent.

### 2. Edit access for a second adult (#389)
Organizer can give a second adult edit rights: `PUT /family/members/:id/edit-access`.
Check: switch on in Settings; the second adult can now add records without signing out and
back in; switch off removes it; setting a member to child removes the grant. Roster-stored,
so it takes effect without re-login.

### 3. Joining a family and approval (#380, #386)
Flow: `POST /family/join` (request), organizer approves at
`/family/access-requests/:id/approve` (Settings: Approve / Decline, 48px targets).
Check:
- Joiner's waiting screen says the family will be told, says the request lasts **14
  days**, and does not promise a working sign-in before approval.
- After approval the joiner receives an approval email with a sign-in link (and a confirm
  link only if email verification is on).
- Requests older than 14 days are removed when the organizer opens the list.
- **Known unfixed weakness (do not report as new):** joining does not prove the mailbox
  belongs to the joiner; it needs an account-model decision from the owner.

### 4. Notification catalogue and mute per kind (#381, #385, #398)
Push text is a closed set of strings (lock-screen safe: no names, no amounts). Each alert
has a plain "why you got this" reason. `GET/PATCH /family/notifications` carries
`kinds_muted`; muting a non-critical kind stops it; critical kinds cannot be muted.
Check: reasons read plainly; muted kinds do not arrive; critical alerts still do; SMS and
WhatsApp alerts keep detail and the signed approve link (owner decision: yes, with links).
Not built: a settings screen for muting kinds (API only). Continuity emails still bypass
the catalogue (stated in a test).

### 5. Monthly digest (#382, #401)
The digest has an "On your family list" section: record count, whether every adult has
seen the current version, soonest date. No names or amounts.
Check: the line says "not yet seen by every adult" in at most **two** digests per version of
a list, then keeps the count and date without the reminder; editing the list starts it
fresh; a fully seen list never carries it. A missed month never shows these lines.
Not covered end to end: the job's recording step after sending.

### 6. Easier capture (#391, #393, #394)
- **Type or dictate a sentence (C1):** a sentence such as "car MOT due 28 February 2027"
  becomes a draft that the person reviews and saves. Deterministic, no model, no network.
  Nothing saves without review.
- **Photograph a letter or policy (C0):** a card that uses the existing document upload.
- **On-device voice (C4):** off unless the flag or `?voice=on` is set. Downloads about 40
  MB (Whisper tiny, English, from huggingface.co) after consent, runs on the phone, can be
  removed in the UI. Microphone is allowed on `/domains` pages only.
  Check with the network in airplane mode after the first download: dictation still works
  and nothing leaves the device. **Never exercised against the real model or microphone;
  this is the highest-value thing to test.**
- Each record shows a source line when it comes from the financial profile.

### 7. Uploads (#400)
A burst of files picked at once on a tenant's first upload of the day used to refuse one
with a false "Daily upload limit reached". Check: pick 5-8 files on a new household. The web page sends them one after another, so all
are accepted. A client that sends them in parallel gets at most 3 in flight (by design) and
"Too many uploads at once" for the rest, never a daily-limit message. The real limit still refuses once reached and releases reserved bytes.

### 8. Copy, readability and accessibility (#379, #383, #384, #392, #395)
- Family-facing copy is at grade 9 or below with no jargon; the noun is **family list** and
  the roster is "the family". Look for leftover "on file" or jargon.
- 48px minimum targets and 16px text at 375px width; axe clean on the domains pages;
  reduced-motion respected; footer text meets AA contrast in light and dark.
- jsdom checks cannot measure real contrast or tap size: measure in a real browser.

### 9. Hosting (#396)
Landing sites redirect `/domains` to the app. Check on each landing host, and that the
microphone is allowed on the app's `/domains` pages only (Permissions-Policy). Firebase
header precedence was never checked live.

## Cross-cutting checks
- Two-adult run against the real API: nothing so far has done this. Do it first.
- Dark mode, large text, screen reader (VoiceOver/TalkBack) on the domains pages.
- Rules: no copy that recommends a product or names a provider; nothing acts on the family's
  behalf without a human approval; family content is not used to train a model.

## Known gaps (not defects to report)
Join mailbox weakness; no undo on delete; mute screen not built; continuity emails not in
the catalogue; 375px browser gate not automated; owner decisions still open (set-password
link, whether production has email verification, safeguarding defaults, per-adult mute,
fourth-door name, notification wording sign-off, time zone, consent for pack dates, welcome
carousel, privacy and safeguarding reviews, outside-person view, production vision key).

## Report format
For each finding: area, steps, expected, actual, severity (blocks a family / confuses /
cosmetic), device and browser, screenshot. Stop and report immediately if real personal
data appears anywhere, a push shows a name or amount, or anything acts without approval.
