# Input capture inventory (how data gets into LifeKeel today)

Date: 2026-11-07. Read-only inventory. Evidence is the checked-out tree of `/Users/balu/Projects/AgentOak-e2e` on branch `feat/organizer-edit-access`, plus a search of every local and remote branch for audio and speech code. Paths are relative to the repo root. Nothing was run; nothing in a live system was touched.

Purpose: before anyone designs "easy capture" (say it, snap it, forward it), list what already exists, what it costs in trust, and what rules decide what may be added.

Trust tier shorthand (from ARCHITECTURE.md and CLAUDE.md rule 1): Tier 0 = read and inform; Tier 1 = prepare a draft or proposal that a person applies with their own click. Nothing here is above Tier 1. "Gateway" = the AI task gateway (`apps/api/src/ai/task-gateway.ts`, policies in `definitions/ai-tasks.yaml`, processors in `definitions/ai-processors.yaml`).

## 1. Summary table

| # | Path in | Entry point | Model involved | Tier | Gateway | Review before save |
|---|---|---|---|---|---|---|
| 1 | Manual forms (profile, domain records, onboarding chat) | web forms | none | 0/1 | not applicable | yes (the form is the review) |
| 2 | Document upload and camera | `/upload`, `/documents/upload` | local OCR text, optional hosted vision | 1 | yes (`document.extract.v1`) | yes (ExtractionReview, PolicyReviewForm) |
| 3 | Estate vault upload | `/vault`, `POST /vault/...` | none (encrypted storage only) | 0 | not applicable | n/a |
| 4 | Connected mailbox (Gmail, IMAP) | `/connect/email`, `jobs/email-scan.ts` | classifier, summary, attachment OCR | 1 | yes (`email.policy_*`, `document.extract.v1`) | yes (inbox item, then apply-policy review) |
| 5 | Inbound forward address | none | none | not built | not built | not built |
| 6 | Ask Keel and the Keel panel | `/assistant`, `/keel/turns` | text model | 0, plus 1 proposals (settings only) | yes (`assistant.answer.v1` etc.) | proposals need a human click |
| 7 | Voice and audio | none | none | not built | not built | not built |
| 8 | PWA, share target | manifest and service worker | none | not built | not built | not built |
| 9 | Cloud-drive connectors | `connectors/*.yaml` | none wired for LifeKeel's family flow | not established | not established | not established |

## 2. Manual forms

What: typed entry of facts.

- Financial profile form: `apps/web/src/app/financial-profile/page.tsx`, backed by `apps/api/src/routes/family-financial-profile.ts` (its `FinancialProfileSchema`). Detector YAMLs in `detectors/family/*.yaml` read this profile.
- Policy review/edit form (also used after extraction): `apps/web/src/components/PolicyReviewForm.tsx`. Fields: type, provider, coverage amount, monthly premium, renewal date, policy number, member id, claims phone and email.
- Domain packs: `apps/web/src/app/domains/AddRecordForm.tsx` and `RecordList.tsx`, driven by pack definitions in `apps/api/src/domains/packs/` (`car.ts`, `life-protection.ts`) and `apps/api/src/routes/family-domains.ts`. The car pack's store record is "Vehicle": registration, make and model, MOT due, recovery contact. The car policy record is read from the profile through an adapter, not stored again.
- Conversational onboarding: `apps/web/src/components/ConversationalOnboarding.tsx` with questions in `apps/web/src/lib/onboarding-data.ts`. It is a typed chat that collects answers and family members before signup; the draft survives a sign-in redirect in `sessionStorage`.
- Briefs ("one money question"): `apps/web/src/app/briefs/page.tsx`. Household facts are typed, one deterministic answer comes back, and the creator and one named adult each confirm.

Trust tier: 0 for reads, 1 for saving a profile (a person typing and pressing save).
Consent and gateway: no model call; ordinary tenant-scoped writes.
Friction: highest of any path. Many fields, UK date entry, jargon ("holder", "renewal"), and nothing prefilled. The usability kit (docs/research/usability-test-kit-2026-11-07.md) has an optional task to measure this.

## 3. Document upload and the extraction pipeline

### 3.1 Entry points

- Web: `apps/web/src/app/upload/page.tsx`. Two hidden file inputs: a general file picker and a camera input (`accept="image/*"` with `capture="environment"`, line 284). `capture` opens the phone's own camera app, not the page's camera, so it works despite the page's `Permissions-Policy` (see 8.3).
- API: `POST /documents/upload` (legacy multipart, still the web path) and the direct-upload pair in `apps/api/src/routes/documents-uploads.ts`. Both write to quarantine first and follow the same scan job.
- Types allowed (`apps/api/src/documents/formats.ts`): PDF, DOCX, JPEG, PNG, WebP, GIF, HEIC/HEIF. Extension, declared type and file signature must agree (`extraction/file-signature.ts`). No audio or video types are allowed.
- Limits: 50 MB per file plus aggregate limits and daily quotas (`documents/quota.ts`).

### 3.2 What the pipeline does (in order)

1. Quarantine and malware scan (`extraction/scan.ts`): ClamAV only if `CLAMD_HOST` is set; otherwise result is `not_performed`. `mayParse()` blocks parsing of unscanned files when a scanner is required (production default per the code comment). A scanner that errors leaves the file stored but not extracted.
2. Plan gate: AI extraction runs only if the tenant's plan has `document_ai_extraction` (`apps/api/src/entitlements.ts`: false on free, true on starter, growth, enterprise). Free-plan files are stored with status `stored` and never extracted.
3. Special-category pre-screen (`ocr/extract.ts`, around line 297): documents showing health or similar markers are held from any hosted model (`extraction_held_reason: special_category`) and can only be read by the local pipeline. A client-side on-device screen can flag but never downgrade the server's verdict.
4. Reading: images go through local Tesseract (`ocr/local-ocr.ts`, run as a subprocess; "the document image never leaves the process"); PDFs use the text layer (`ocr/pdf-text.ts` tests); the text is then read by a self-hosted model into a fixed set of keys. When no self-hosted model is configured, a governed hosted vision call is used (`taskVision('document.extract.v1', ...)` in `ai/task-gateway.ts`, line 436).
5. Candidates (`extraction/pipeline.ts`): each field becomes a candidate with a value, confidence, grounding kind, a span and snippet from the document text, `needs_review` if below the review threshold, and a status (`proposed`, `confirmed`, `edited`, `rejected`). Values that fail validation or belong to another category are dropped and counted.
6. Allow-listed fields (`extraction/schema.ts`, SCHEMA_VERSION `v1-2026-10`): only `policy_type`, `provider`, `policy_number`, `coverage_amount`, `premium`, `renewal_date`, `has_beneficiary`, `claims_phone`, `claims_email`, `balance`, `net_pay`, `gross_pay`, `document_date`. The schema deliberately has no free text, no summary, no quoted passages and no names of people; `has_beneficiary` is yes or no. Categories: insurance, pension, mortgage, income, investment, tax, will, other.
7. Review and gates (`routes/documents.ts`): `POST /documents/:id/confirm-type`, `POST /documents/:id/review` (a decision that fails validation rejects the whole review, so nothing is half-applied), `POST /documents/:id/apply-to-profile`, `POST /documents/:id/apply-policy`. The `gate()` helper (about line 188) returns 409 `confirm_type` until the document type is confirmed when confidence is low, and 409 `review_required` for unreviewed low-confidence fields. A rejected field is never used; an edited one uses the edited value.
8. Audit events carry counts and durations only: no values, snippets or document text (comment at top of `extraction/pipeline.ts`).

### 3.3 Web review UI

`apps/web/src/components/ExtractionReview.tsx` shows each value next to the quote it came from, with confirm, edit and reject, and marks values read from images or not found in the text as needing a check. `PolicyReviewForm.tsx` is the editable draft that becomes a profile entry. Both exist and have tests (`components/__tests__/ExtractionReview.test.tsx`).

### 3.4 Status for each

- Trust tier: 1. Extraction proposes; a person applies. Server-side gates enforce it.
- Consent and gateway: governed. Task `document.extract.v1` has `data_boundary: approved_hosted_provider`, retention class `limited_abuse_log`, `allowed_processors: [ollama, anthropic, openai, azure, vertex, groq, xai]`. See section 9 for which of these are usable.
- Friction: one photo or file, then a review screen. Plan-gated (free tier gets storage only). Reprocess exists (`POST /documents/:id/reprocess`).

### 3.5 Known inconsistencies worth knowing

- `apps/api/src/ocr/extract.ts` header comment still says GPT-4o is tried first via `OPENAI_API_KEY`, then Azure. The code in `resolveVisionClient()` does that: if `OPENAI_API_KEY` is set it builds an `openai` client, and only otherwise Azure. The processor registry lists `openai` as `unreviewed`, which is refused outside dev under the default `enforce`. So the vision path works in production only if Azure is configured and no OpenAI key is present, or if a documented exception is set. Which is true in production could not be verified (see section 12).
- `apps/api/src/routes/documents.ts` header says "GPT-4o vision" as well; the gateway path is the real one.

## 4. Estate vault

`apps/web/src/app/vault/page.tsx`, `apps/api/src/routes/vault.ts`. Adult-only, envelope-encrypted storage of wills, power of attorney and similar; the same camera input pattern as upload (`capture="environment"`, vault page line 346). The vault never uses presigned upload or download. No extraction, no model, and the route comments say crisis release or any "dead man's switch" is deliberately not built because autonomous release would be a Tier 3 action. Tier 0. Friction: moderate (a sealed upload). Not a capture path for structured data.

## 5. Inbound email

### 5.1 Connected mailbox

- Connect: `apps/web/src/app/connect/email/page.tsx` (Google OAuth, with a manual IMAP path; `EMAIL_PROVIDER_OPTIONS` in `lib/api.ts`), credentials in `apps/api/src/routes/connector-credentials.ts`. Refresh and address lookup: `email/gmail-oauth.ts`.
- Read: `email/gmail-api.ts` (Gmail REST under `gmail.readonly`, a deliberate change from IMAP's full-mailbox scope), `email/imap-client.ts` for IMAP providers. Grants issued under the older broader scope keep working until reconnect.
- Pipeline: `apps/api/src/jobs/email-scan.ts`. For each new message: free keyword prefilter (`email/prefilter.ts`, a recall filter that avoids model calls on mail with no policy terms), classify (`email/classify.ts`; the prompt treats the email body as untrusted data), optional encoder classifier (`email/encoder-classifier.ts`), summarise, create an inbox item; if the email carries a PDF or image attachment it is stored through the same documents and OCR pipeline as an upload (the file's own header comment says so).
- Surface: `GET /inbox`, `POST /inbox/:id/dismiss`, `POST /inbox/:id/read`, and `POST /inbox/:id/apply-policy` in `apps/api/src/routes/family-inbox.ts`; UI in `apps/web/src/app/inbox/page.tsx`. The inbox is "NOT a mail reader": it shows what Keel noticed and policy details found.
- Trust tier: 1. Read-only mailbox access; every item is a suggestion; applying uses the same review gates (`confirmedFields`, `loadCandidates` imported in `family-inbox.ts`).
- Gateway: tasks `email.policy_relevance.v1` and `email.policy_summary.v1` (`approved_hosted_provider`, `limited_abuse_log`), plus `document.extract.v1` for attachments. Plan gate: `document_ai_extraction` also controls attachment parsing and the summary (comment around line 180 of the job).
- Friction: the one-time OAuth connect is large, and a family may be wary of "connecting my whole inbox". Policy mail only is surfaced. Gmail needs Google verification for the restricted `gmail.readonly` scope (not verified here, see section 12). CLAUDE.md rule 3 note: Gmail Limited Use terms exclude that mail from cross-tenant scorers (procedural, not code-enforced).

### 5.2 Gmail connector YAML disagrees with the code

`connectors/gmail.yaml` says `status: planned` and "live ingestion is not wired". The code in `apps/api/src/email/*` and `jobs/email-scan.ts` clearly does read and scan Gmail. Treat the YAML status as stale; whether the live deployment has Google approval and a running scan schedule was not verified.

### 5.3 Inbound forward address: not built

No route, service or setting offers a LifeKeel address that a family forwards mail to. Search found only two docs that mention it as a design option: `docs/prd/232-employer-cover-blind-spot.md` (line 40: "opt-in or a household-managed forwarding address (open decision 4 ...)") and `docs/intents/84-employer-cover-blind-spot.md` (line 29: "Work mail is connected only through a forwarding address or a confirmed opt-in"). The only `/inbound/` code is the public-route prefix `{ prefix: '/inbound/', group: 'I' }` in `apps/api/src/security/public-routes.ts` (line 62), listed alongside a billing-webhook-signature test (`routes/__tests__/billing-webhook-signature.test.ts`). That relates to inbound webhooks (e.g. billing), not a mail ingest address. No MX or mail-receiving provider integration was found. Verified by `git grep` over apps, docs/prd and docs/intents on the checked-out tree only.

## 6. Connectors (`connectors/*.yaml`)

| File | Status in YAML | What it says | Wired for the family product? |
|---|---|---|---|
| `connectors/gmail.yaml` | `planned` | read-only Gmail | The code exists (see 5.2); YAML is out of date |
| `connectors/open-banking.yaml` | `planned` | mortgage accounts, balances, rates via a regulated aggregator | Not found wired; a bank feed would touch regulated activity (rule 2) and needs a separate decision |
| `connectors/google-drive.yaml`, `dropbox.yaml`, `onedrive.yaml` | no status field found | "Sync CSV, Excel, and JSON files ... directly into the LifeKeel engine" | These describe the older workflows engine (`packages/workflows/src/connectors/ConnectorRegistry.ts`), not a path for a family's policy paperwork. The upload pipeline allows no CSV or Excel type. Not verified as live |

Also: `packages/workflows/src/connectors/ConnectorRegistry.ts` defines generic connectors including an "Inbound SMS received" webhook event (line ~800) and "Any inbound webhook payload" (line ~1985). These belong to the workflows package; whether any is reachable by the family product was not established. Treat as not part of the family capture path.

## 7. Assistant and the Keel agent

- Ask Keel: `apps/api/src/routes/assistant.ts` (`/assistant/ask`), web `apps/web/src/app/assistant/page.tsx`. Typed text only. Tasks: `assistant.answer.v1` (hosted, retention `limited_abuse_log`), `assistant.answer_verified.v1` (deterministic, no model, `ollama` only), `assistant.answer.sensitive.v1` and `assistant.youth_answer.v1` (`lifekeel_infra_required`, self-hosted only, `local_cpu`), `assistant.scenario_narration.v1`.
- Keel panel: `apps/api/src/keel-agent/` (`routes.ts`, `orchestrator.ts`, `tools.ts`, `proposals.ts`), web `apps/web/src/components/keel/` (`KeelDock.tsx`, `KeelComposer.tsx`, `KeelThread.tsx`). `/keel/turns` takes typed text. The tool registry is read-only ("There are no write tools", `tools.ts` header); the orchestrator picks tools deterministically from a classified intent; model-chosen tool calls are not enabled. The only write is Tier 1 proposals (`proposals.ts`): Keel prepares a settings change and the signed-in organizer applies it with their own click via `/keel/proposals/:id/confirm`, restricted to `PROPOSABLE_SETTINGS` keys; it never calls `ActionExecutor`. Panel is off in production until `NEXT_PUBLIC_KEEL_PANEL=on` (`lib/keel/client.ts`; the deploy workflow compiles it on, per recent commit history).
- Does Keel capture data? No. `docs/prd/212-verified-answer-resolver.md` (Out of scope) says natural-language writes to the profile and voice input are out of scope. Reusable pieces if that decision changes: the proposal-and-confirm pattern (`keel_proposals`, 15-minute expiry, re-check of identity, role and current values at confirm) is the best template for "Keel prepared a record, you press save".
- Tier: 0 for answers, 1 for settings proposals. Consent and gateway: all model calls go through the gateway; sensitive and youth classes are self-hosted only.
- Friction: typed only. Typing a question is easy; typing a record into a chat does not exist.

## 8. Voice, audio, PWA and share target

### 8.1 Voice and audio: no code exists

Searched for `whisper`, `SpeechRecognition`, `webkitSpeechRecognition`, `getUserMedia`, `MediaRecorder`, `speech-to-text`, `speech_to_text`, `stt_`, `transcribe` across `apps`, `packages` and `definitions`, on the checked-out tree and on every local and remote branch (221 refs). Result: no matches anywhere. Looser matches were unrelated ("transcript" for chat transcripts in `keel-agent` and `support.ts`; "audio/" nowhere in code).

Related leftovers:
- `apps/web/src/lib/modes.ts` has a `voiceNavigation` flag, true only for the `elderly` mode (line 66). A search of `apps` and `packages` found no consumer of the flag beyond its own definition. It does nothing today.
- `docs/reviews/synthetic-flow-validation-2026-10.md` line 452 lists a "Voice Nav" column; it is a test matrix label, not code.
- `docs/prd/212-verified-answer-resolver.md` lists voice input as out of scope; `docs/reviews/market-positioning-october-2026.md` records competitors (LifeOS, Meet Warren, Starling Assistant) that offer voice-first input. This is market context only.
- `apps/api/src/documents/formats.ts` allows no audio MIME type, so even an upload could not carry a recording.
- No `definitions/ai-tasks.yaml` task for transcription exists.

### 8.2 PWA and share target

- `apps/web/public/manifest.json`: name, `display: standalone`, icons (any and maskable, 192 and 512), screenshots, shortcuts (Dashboard, AI Assistant, What If Scenarios), `launch_handler`. It has no `share_target`. A search for `share_target` across all branches found none in code. Consequence: LifeKeel does not appear in a phone's share sheet, so a person cannot share a PDF, photo or text from another app into LifeKeel.
- `apps/web/public/sw.js` (179 lines): public shell cache; authenticated routes cached only on first visit; API responses network-only and never cached, "so a shared phone or iPad" cannot leak data; navigation is network-first. It has no `POST` handler, which a share target would need.
- PRD-147 (`docs/prd/147-pwa-install-and-polish.md`) covers install polish only; share target is not in it. Web push works only for installed PWAs (per PRD-147).
- A Capacitor shell is mentioned in PRD-147; its plugins were not examined (not verified).
- iOS Safari does not support the web share-target API for installed web apps at the time of writing (browser capability, not checked against the code; verify before relying on it). A native shell would be the path on iOS.

### 8.3 Browser permission policy blocks microphone and camera by default

`apps/web/firebase.json` sets `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()` on three header blocks (lines 37, 84, 127). That blocks `getUserMedia` (microphone or in-page camera) and the browser's `SpeechRecognition` for the app's origin. Anything that records inside the page would first need a deliberate header change plus a privacy review. The `capture` attribute on a file input is unaffected because the operating system's own camera or recorder app does the capture. The CSP in the same file also constrains where scripts and connections may go (`script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com`; `worker-src 'self' blob:`). `wasm-unsafe-eval` is allowed, which would permit a WebAssembly on-device model, if one were ever shipped (not verified as used).

## 9. AI task gateway: what is approved for reading documents or speech

### 9.1 Registered tasks relevant to capture

Tasks in `definitions/ai-tasks.yaml` (the full list was not read; these were found by search):

| Task | Purpose | Boundary | Retention class | Allowed processors |
|---|---|---|---|---|
| `document.classify.v1` | classify an upload | `approved_hosted_provider` | `limited_abuse_log` | ollama, anthropic, openai, azure, vertex, groq, xai |
| `document.extract.v1` | extract structured fields | same | same | same |
| `document.profile_candidate.v1` | suggest profile fields | same | same | same |
| `email.policy_relevance.v1` | is this email about protection | same | same | same |
| `email.policy_summary.v1` | summarise for inbox card | same | same | same |
| `assistant.answer.v1` | Ask Keel | same | same | same |
| `assistant.answer.sensitive.v1`, `assistant.youth_answer.v1` | special-category and youth | `lifekeel_infra_required` | `none` | ollama only |

There is no task for speech-to-text, audio, or transcript cleanup. A new task would have to be registered; the gateway fails closed on an unknown `task_id` outside dev, and `apps/api/src/__tests__/ai-task-gateway.test.ts` fails CI if code names an unregistered task or constructs a raw model client outside the allow-listed factories.

### 9.2 Processor registry (`definitions/ai-processors.yaml`)

| Processor | Status | Retention recorded | Notes |
|---|---|---|---|
| `ollama` (self-hosted) | `self_hosted` | none | No third party. CLAUDE.md says the GCP Ollama service was decommissioned on 2026-10-24 for cost, and CPU-local interactive generation is closed (50 s p50 against a 30 s deadline). Whether any self-hosted model is running in production is not verified. |
| `azure` (Azure OpenAI) | `approved` 2026-10-22, review due 2027-10-22 | `limited_abuse_log` (up to 30 days for abuse monitoring until modified abuse monitoring is approved) | Region "deployment-selected ... not yet deployed" at time of approval. No training on prompts per product terms. |
| `vertex` (Vertex AI, Gemini) | `approved` 2026-10-22, review due 2027-10-22 | `limited_abuse_log` recorded conservatively | Enterprise path, not the free Gemini API. Auth is OAuth only. |
| `groq` | approved 2026-10-23 per CLAUDE.md | `limited_abuse_log` until ZDR toggled on | Not read in full here. |
| `xai` | approved conditional on ZDR per CLAUDE.md | not read | Conditional; the Console toggle must be on first. Not read in full here. |
| `anthropic`, `openai` | `unreviewed` | `limited_abuse_log` assumed | Refused in a non-dev deployment under `enforce`. |

Policy that follows (CLAUDE.md "AI data use" and gateway code): outside dev the default is `enforce`; a downgrade needs a recorded `AI_POLICY_EXCEPTION`; the hosted fallback for `lifekeel_infra` tasks is denied.

Speech-to-text and approval: none of the registry entries lists audio models, speech endpoints or a transcription retention class. A processor's approval for text chat does not automatically cover audio; audio is a different data type (voiceprint, background speech, third-party voices) and the approval record would need an explicit statement and a retention figure for audio. Which of the approved processors offers a speech-to-text endpoint under the same terms was not checked.

## 10. What the review-before-save UI already gives a new capture method

Reusable, already built:
- Candidate model with grounding, confidence, `needs_review`, status and edit values (`extraction/pipeline.ts`).
- Review screens: `ExtractionReview.tsx`, `PolicyReviewForm.tsx`; type confirmation step (`confirm-type`).
- Server gates `confirm_type` and `review_required` and the "all-or-nothing review" rule.
- An allow-listed field schema with no free text (`extraction/schema.ts`), pinned by a test.
- Inbox item to apply-policy flow for email (`routes/family-inbox.ts`).
- Proposal-and-confirm pattern with expiry and re-checks (`keel-agent/proposals.ts`).
- Special-category pre-screen before any hosted model (`ocr/extract.ts`), including a client-side on-device screen helper (`apps/web/src/lib/on-device-doc-screen.ts` is referenced in the code comment; not read).
- Audit logging that records counts and durations, never content.
- Quarantine, signature checks, malware scan, quotas for files.

Not reusable as is:
- The field schema is policy-shaped (insurance, pension, mortgage, income). Vehicles, contacts and "where things are kept" fit the domain-pack record model (`apps/api/src/domains/records.ts`, `types.ts`) rather than `extraction/schema.ts`. A new capture method for those would need its own allow-list and review step.
- Review gating depends on a document record and grounded spans in document text; transcribed speech has no document span to point to, so "quote it came from" would be a transcript snippet.

## 11. Gaps a new capture method must fill

1. No route for anything but typed text, files and a connected mailbox. There is no audio path, no share-sheet entry, and no forward address.
2. No transcription task or processor approval for audio (task registry, processor registry, retention figure, DPA statement for audio).
3. No permission to use the microphone or in-page camera (`Permissions-Policy` blocks both).
4. No allow-list and review step for non-policy records (vehicles, contacts, handover facts) coming from unstructured input; only policy-shaped fields have candidates and grounding.
5. No consent flow in the product for "this recording is sent to a processor"; CLAUDE.md lists a consent flow for third-party AI as procedural and not built.
6. No way for the second adult or a trusted person to add by a light method (joined accounts are `viewer` role and cannot add records; see `docs/reviews/ship-loop-ledger.md`, critic pass 3, where organizer-granted edit rights is an open owner decision).
7. No deletion path stated for transcripts or audio; data-retention and deletion documents (`docs/data-retention.md`) would need entries.
8. Extraction needs a paid plan and a clean scan; a free-plan family gets storage only. Any "easy capture" promise on the free tier has to be a stored-only or review-only experience, or a plan decision.
9. A usable on-device or self-hosted speech model is not present; the CPU-local path for interactive generation is closed for latency, and the self-hosted service was shut down for cost.
10. No measurement of whether people prefer typing, photo or speaking; the optional task 11 in the usability kit would give first evidence.

## 12. Constraints that decide what is allowed

1. Rule 1 (trust tiers): capture may only discover and prepare. The person presses save. Nothing may write to the profile, send mail, or contact a provider unprompted. The pattern to copy is `keel_proposals` and `confirm`.
2. Rule 2 (no regulated advice or arranging): what is captured and shown stays factual (on file, dates, steps). Capture must not become a way to read an insurance policy and produce "switch to X" or "you need more cover". No bank-feed or payment-initiation work (the `open-banking.yaml` connector stays planned and needs an explicit decision).
3. Rule 3 (no training on family content): any speech or vision provider must be processing only, through the gateway, with an approved processor, a recorded retention class and no provider-side memory, file stores or vector stores. No consumer or free endpoints, no personal API keys.
4. The browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) streams audio to a third party chosen by the browser vendor (typically the vendor's cloud). It is not a registered processor, has no DPA or retention figure in the registry, bypasses the gateway and so also the gateway CI tripwire's intent, and would send family speech to a processor nobody approved. It is not allowed. The same applies to the operating-system keyboard dictation if LifeKeel were to market it as a LifeKeel feature: if a person dictates using their phone's keyboard microphone, that is the person's own device feature (the text reaches LifeKeel as typed text), not LifeKeel recording audio, but LifeKeel must not call this a private or approved path.
5. Hosted STT is allowed only if: a processor already approved (azure or vertex, or groq/xai once their conditions are met) is confirmed in writing to offer speech-to-text under the same terms with an audio retention figure; a new gateway task id is registered in `definitions/ai-tasks.yaml` with `allowed_processors` limited to those; audio is dropped after transcription; the transcript is treated as family content with a retention rule and deletion coverage; and the consent copy says audio goes to the named processor. Anthropic and OpenAI remain unreviewed and are refused outside dev.
6. Local or on-device is preferred for high-sensitivity content. Special-category content (health) must not reach a hosted model; the existing pre-screen shows the intended behaviour. Spoken content is more likely to include health and third-party details than a form; an on-device model, or capture-as-voice-note stored unprocessed, are the safest paths.
7. The extraction schema rule: no free text, no names of people, no medical text. A transcript may not be stored as a free-text field on the profile. Whatever is captured must reduce to allow-listed fields and be shown for review.
8. The `Permissions-Policy` header currently denies microphone and camera. Changing it is a security-setting change to be reviewed and kept to the specific route that needs it.
9. A file picker with `capture` is the lowest-risk "snap it" path because it reuses the full upload pipeline, scan, gates and gateway.
10. A new inbound address (forwarding) means a mail-receiving provider as a new processor of family content, spam and abuse handling, tenant binding (per-tenant address secrets), and the same prefilter, classify and review chain. It also needs Gmail-style limits: the forwarded content is family-supplied, so consent is simpler than a full mailbox connect, but a processor review for the mail receiver is still needed.
11. Safeguarding: the ship loop ledger shows owner decisions pending on notification subjects, SMS detail and join flows for separation and bereavement cases. New capture methods that notify the other adult ("Sam added a policy by voice") inherit those decisions and must not ship ahead of them.

## 13. Options in one line each (for the owner's choice, not a recommendation to build)

| Idea | Reuses | New work | Blocked by |
|---|---|---|---|
| Snap a letter (camera capture) | whole upload and review pipeline, `capture` input | better copy and a shortcut; maybe a manifest shortcut | none; plan gate for free tier |
| Share to LifeKeel from the phone | upload pipeline | manifest `share_target`, service worker POST handler, sign-in handoff; iOS support unclear | decision; native shell on iOS |
| Forward an email to a LifeKeel address | email classify and extraction chain | receiving provider, per-tenant address, abuse handling, processor review | owner decision, processor approval |
| Say it (voice note) | review UI, proposal pattern | transcription task, approved speech processor or on-device model, audio retention and deletion, Permissions-Policy change, consent copy, a record-shaped allow-list | processor approval for audio; privacy review |
| Type or paste a sentence ("MOT due 9 May") | proposal pattern, `assistant` task | parse to allow-listed fields, review step | rule 1 and PRD-212 out-of-scope item for natural-language writes need a decision |

## 14. What could not be verified

- Production configuration: which AI provider keys are set, whether Azure or Vertex is deployed (the registry says "not yet deployed" at approval time), whether any self-hosted model runs, and whether `OPENAI_API_KEY` is set (which would make the vision path pick the unreviewed `openai` processor). I did not read any `.env` or deployment setting, by instruction.
- Whether hosted vision is actually reachable in production today, so what a real photo upload returns. No live call was made.
- Whether `CLAMD_HOST` is set in production, and so whether extraction runs on real uploads.
- Whether the Gmail connector has passed Google's verification for the restricted scope, and whether the email-scan job is scheduled in production.
- The full `definitions/ai-tasks.yaml` and the `groq` and `xai` registry entries were only partly read; other tasks (for example classification or encoder tasks) may exist. A search for speech-related tasks by keyword found none.
- Whether any approved processor offers speech-to-text under terms equal to the text model terms, and its audio retention.
- iOS and Android behaviour for web share target and `capture` inputs, and the Capacitor shell's plugins; browser-capability statements here are from general knowledge and were not tested.
- The domain packs, joiner approval, notification catalogue and confirm flows are partly in open PRs (378 to 387 per `docs/reviews/ship-loop-ledger.md`); this inventory read the checked-out branch only. Other branches may differ.
- I did not read `docs/data-retention.md` in full, nor `ARCHITECTURE.md` §8; I used CLAUDE.md for the rules.
- No code was run, no tests were run.

## 15. Sources checked

`CLAUDE.md`; `apps/api/src/extraction/{pipeline,schema,scan}.ts`; `apps/api/src/ocr/{extract,local-ocr}.ts`; `apps/api/src/routes/{documents,documents-uploads,family-inbox,vault,family-domains}.ts`; `apps/api/src/email/{gmail-api,gmail-oauth,prefilter,classify}.ts`; `apps/api/src/jobs/email-scan.ts`; `apps/api/src/keel-agent/{routes,tools,proposals}.ts`; `apps/api/src/ai/task-gateway.ts`; `apps/api/src/security/public-routes.ts`; `apps/api/src/domains/packs/car.ts`; `definitions/{ai-tasks,ai-processors}.yaml`; `connectors/*.yaml`; `apps/web/public/{manifest.json,sw.js}`; `apps/web/firebase.json`; `apps/web/src/app/{upload,vault,domains,connect/email}`; `apps/web/src/components/{ExtractionReview,PolicyReviewForm,ConversationalOnboarding}.tsx`; `apps/web/src/lib/modes.ts`; `docs/prd/{147,212,232}`; `docs/intents/84`; `docs/reviews/ship-loop-ledger.md` (from branch `feat/digest-domain-summary`).
