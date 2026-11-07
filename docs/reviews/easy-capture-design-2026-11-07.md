# Easy capture: voice and other low-friction ways to get information in

Status: design for the owner's decision. Nothing here is built. Facts about today's code come from `docs/reviews/input-capture-inventory-2026-11-07.md` (read-only agent; the three claims that shape this design were re-checked: microphone is blocked by `Permissions-Policy`, there is no share target or forward address, and no voice code exists).

## The idea in one sentence

Many doors, one safe pipeline: **a person gives LifeKeel something in the easiest way they have, LifeKeel prepares a draft, a human reviews it, and only then does it reach the family list.** Rule 1 (no action without a human gate) is the pipeline, not a bolt-on.

## What makes this cheap to extend: the pack manifest is the schema

Each domain pack already declares its record types, fields, kinds (text, date, choice, member) and which fields are sensitive (`apps/api/src/domains/types.ts`). That same declaration can drive capture:

- the **allow-list** of fields a parser may fill (nothing outside it can be saved);
- the **review form** (the generic domains page already draws forms from the pack);
- the **validation** (dates must be real, choices must be options, people must be in the family: `checkRecordValues`).

So a new domain, say Pets, gets "say it", "snap it" and "forward it" without new capture code. That is the compounding part.

## The pipeline (all doors share it)

```
door (type / dictate / photo / share / forward)
  -> capture_draft  { source, proposed records (pack, record, values), per-field source text when known }
  -> review screen  ("We read this. Check it.")  -> Save to the family list  |  Not right
  -> existing write path (domain_records, or the profile apply routes), approvedBy = the person who tapped Save
```

- Drafts are `pending_review`, expire after 30 days, and are visible only to adults in the family (and, per the owner's decision, the editor who may save them).
- The raw input (sentence, audio, email body) is **not kept** after parsing, except documents the family chose to upload (already stored by the upload pipeline).
- Review always shows the source ("from the photo you added on 3 Nov") and per-field "we read this from..." so errors are visible. Never saved silently, never shared with the other adult before Save.
- Audit: who captured, who approved, which door. No content in the audit row.
- Notification: "A draft is ready to review" is the already-reviewed catalogue kind `document_ready_to_file` (lock-screen safe, mutable). It does not tell the other adult what was captured.

## The doors, from least to most risk

### C0. Make what exists voice- and camera-friendly (no new processing, ship first)
- **Dictation via the phone keyboard.** The text reaches LifeKeel as typed text; LifeKeel records no audio. Design the forms for it: one question per screen, large single text field, `autocomplete` and `inputmode` set, short labels, no placeholder-only labels. Copy must be truthful: "Your phone's keyboard can type what you say. That is a feature of your phone." It must **not** claim the dictation is private or approved (the operating system, not LifeKeel, decides where that audio goes).
- **"Snap it" as the front door for documents.** One big button, "Photograph a letter or policy", using the existing `capture="environment"` file input into the full upload pipeline (scan, gates, extraction, review). Free plan: stored only, with a plain statement that reading it needs a paid plan, or a plan decision (see decisions).
- **Prefill from what we already know.** The profile's policies already appear in the cover matrix. Offer "These came from your financial profile" instead of asking again.

### C1. Say or type one sentence -> draft (the main new feature)
"MOT is due 9 May on the Corsa." / "Alex's life policy renews in March."
- A new gateway task (e.g. `capture_parse_text`) maps the sentence onto the pack's allow-listed fields and offers one or more draft records. People are matched to the family roster by a pick, never saved as free text. Anything that does not fit the allow-list is dropped and shown as "we did not use this".
- Registered in `definitions/ai-tasks.yaml` with `allowed_processors` limited to approved ones; special-category pre-screen applies (health content is not sent to a hosted model; it falls back to the typed form); `rejectSecrets` runs first (no passwords or codes).
- Works for dictated text for free (C0), so "voice" arrives without audio handling.
- Needs the owner's call: the intent docs list natural-language writes as out of scope (PRD-212). The review step is what makes it compatible with Rule 1; that is the proposal.

### C2. Share to LifeKeel from the phone
- Add a PWA `share_target` and a service-worker handler that hands the shared file or text to the same upload or C1 path after sign-in. Android/Chrome supports it; iOS web support is limited (a native shell would be needed). Low risk because it reuses the upload pipeline.

### C3. Forward an email to your family's LifeKeel address
- A per-family address (secret per tenant) that feeds the existing mail prefilter, classifier and extraction chain, producing drafts. Friendlier than connecting a whole mailbox.
- New processor of family content: a mail-receiving provider needs a processor review, spam and abuse handling, and tenant binding. Do not start before that review.

### C4. True voice: record a message, get a draft
- Blocked, honestly: today there is no speech task, no approved speech processor, the microphone is blocked by the site's own security header, and the browser's built-in speech recognition streams audio to a third party that is not an approved processor, so it must not be used.
- Two compliant routes, either of which needs your approval: (a) a hosted speech-to-text from an already approved processor (Azure or Vertex), confirmed in writing for audio with a retention figure, a new gateway task, audio dropped after transcription, consent copy naming the processor, deletion coverage, and a `Permissions-Policy` change limited to the one route; or (b) an on-device model (a small Whisper-class model in the browser or the Capacitor shell). (b) keeps audio on the phone but costs a large first download and is slow on older phones; treat it as a research spike, not a promise.
- Whichever route, voice output feeds C1's parser and review. Audio is never stored as a family record.

### Not building
- **Reading a whole mailbox to "discover" everything automatically** beyond what the existing, consented connector does, and anything that acts (replies, sends, cancels) on the family's behalf (Rule 1).
- **Bank feeds / payment initiation** (Rule 2; the open-banking connector stays planned).
- **Anything that turns captured policy text into "you need more cover" or "switch to X"** (Rule 2). Review screens state what was read, in facts.
- **A link that lets someone outside the family add data without an account** (blocked on the safeguarding review, PRD-229). The safe version inside the family is "ask Alex to add this" between two adult accounts, which needs the notification-wording sign-off already open.
- **Free provider endpoints or personal API keys** for speech or vision (Rule 3).

## Things to check in production now (not design, a possible compliance gap)
`resolveVisionClient()` in `apps/api/src/ocr/extract.ts` chooses an OpenAI key first if `OPENAI_API_KEY` is set, and the processor registry marks OpenAI `unreviewed` (refused outside dev). The agent could not see production configuration. If that key is set in production, photo reading may route family documents to an unapproved processor. Please confirm the production settings, or ask me to check that the vision task goes through the gateway's processor check before this design adds more hosted calls.

## How we would know it lowers friction
- Time from sign-in to the first record on the family list: target under 60 seconds with C1 or snap-it.
- Share of drafts saved without edits, and per-field correction rate (tells us where the parser is weak).
- Abandonment at the review screen.
- Use of each door by group (older adults, screen-reader users, non-native speakers) from the usability kit, task 11 (the capture task).
- Content-free counts only; no sentence, transcript or document ever goes into analytics.

## Proposed order
1. **C0** (copy, forms, big camera button, profile prefill): no new processor, ship now.
2. **C1** typed/dictated sentence to draft, once the owner decides on natural-language writes and the task and processors are registered.
3. **C2** share target (small).
4. **C3** forwarding, after the mail-receiver processor review.
5. **C4** voice, after a speech processor is approved in writing or an on-device spike proves usable.

## Owner decisions needed
1. May natural-language input create **drafts** (never saved without a human tap)? (PRD-212)
2. Free plan: is "snap it" stored-only, or do we offer a limited reading allowance?
3. Which approved processor, if any, may do speech-to-text, and who obtains the audio retention terms in writing? Or choose the on-device spike.
4. Mail-receiving provider for forwarding, and its processor review.
5. A `Permissions-Policy` change for one capture route only.
6. Confirm production vision configuration (above).
7. The safeguarding default for telling the other adult that a draft exists (already open as 3b).
