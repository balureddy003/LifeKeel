# Intent 16: Minimal Content Studio (three formats, in YAML)

**Problem** — Every post is written by one generic prompt from one of 12 hard-coded briefs, so the
week looks the same as last week, the learner has nothing distinct to compare, and Instagram and
Facebook drafts have no image (Instagram cannot post without one). The earlier plan for a large
Studio (seven formats, AI-proposed briefs, a Briefs panel, a bandit) is too heavy for ~100 visits a
month. This intent is the smallest version that makes content visibly more varied and attractive.

**Done looks like**
1. **Three formats defined in YAML**, `definitions/marketing-formats.yaml`, loaded and validated
   with Zod at boot (invalid file fails the API start, like other definitions):
   - `myth_vs_file` — "a common assumption" versus "what a family can check on file".
   - `one_thing_to_check` — one small habit (a renewal date, a named beneficiary, where the papers
     are). Information, never advice.
   - `hard_day_steps` — a calm numbered list of what a partner would need to find; thread on
     X/Bluesky/Threads where the publisher supports it, single post elsewhere.
   Each format has: `id`, `label`, `channels` it suits, `min_facts`, `draft_prompt`, `fallback`
   (a deterministic template used when no model is available), optional `card` layout name.
2. **A hook allow-list** in the same file: `question`, `concrete_scene`, `myth_bust`, `checklist`,
   `plain_statement`, `claim`. Fear, urgency, scarcity, guarantees and "act now" are excluded by
   construction (a test asserts no hook text or example contains them).
3. **Selection**: `chooseFormat(slot, channel, usage)` picks the least-used suitable format, a
   different one per slot in a week, never a thread format on a channel without thread support.
   Format and hook are written to `features.format` and `features.hook` (intent 15).
4. **Drafting by format**: `draftPostText` takes `format` and `hook` and uses that format's prompt;
   the no-model fallback renders each format deterministically from brief facts.
5. **Brand cards for Instagram and Facebook**: deterministic SVG templates rendered to PNG with
   `sharp` (already a dependency), product palette, two layouts only (headline; myth/fact), sizes
   1080x1350 (Instagram) and 1200x630 (Facebook). Served by
   `GET /public/social-card/:postId.png?s=<hmac>`: the HMAC covers post id plus the card spec so URLs
   cannot be guessed or edited; no auth; long `Cache-Control`; rate-limited. Plan drafts for those
   channels get `media_url` set to the signed URL and `alt_text` stored, so the "needs image" block
   from intent 14 clears and Instagram drafts become approvable. Text on a card is clamped and
   wrapped; overflow is a test failure, not a clipped image.
6. **Briefs stay as they are** (the 12 in `content-plan.ts`) plus a small `briefs` YAML move is
   allowed but optional. **No AI brief proposals, no Briefs panel.**
7. **Plan tab**: format and hook chips per draft, and a card preview where there is one. Reuse
   `PlanPanel` pieces; no new tab.

**Gated, not built here** (needs counsel review of the wording first): "Calendar moment" posts
(tax-year end, ISA season, school terms) and "Illustrative scene" posts. Leave the format ids
reserved in the YAML schema as `status: held`, never selected by `chooseFormat`.

**Constraints**
- Trust tier: 0/1 (prepare drafts and images). Publishing stays Tier 2: the human approves the
  exact text via the content hash and sees the card. No new autonomous publish path.
- Regulated-advice check: every format's deterministic output and every example passes
  `checkCopy`; facts come only from live claims in the registry; no personal recommendations, no
  named providers, no "buy/switch", no savings promises, no invented numbers or testimonials;
  keep "Informational only" where the presence kit requires it.
- Data/privacy: public marketing text only; cards render only text already in the post; no family
  content in any prompt; no new trackers. Voice source: `docs/marketing/social-presence-kit.md`.

**Out of scope** — AI-generated images or video, multi-image carousels, AI-proposed briefs,
Briefs panel, calendar and scene formats (held), auto-replies/DMs, paid ads, landing page changes,
any learning (intent 19).

**Becomes** — docs/prd/219-content-studio-minimal.md

---

## Build spec

**Files likely touched**
- New `definitions/marketing-formats.yaml` and `apps/api/src/marketing/formats.ts` (loader, Zod
  schema, `chooseFormat`, `renderFallback`). Follow how other definitions are loaded and tested.
- `apps/api/src/marketing/cards.ts` (SVG templates, wrapping/clamping, `renderCardPng`,
  `signCard`/`verifyCard` following the existing HMAC token pattern in
  `routes/heartbeat-unsubscribe.ts` / `marketing/lifecycle-emails.ts`; reuse that secret source rather
  than adding a new secret store).
- `apps/api/src/routes/marketing-card.ts` (public route; add to the open-routes allowlist in
  `server.ts`; register rate limit).
- `apps/api/src/routes/marketing-posts.ts`: `draftPostText` gains `format`, `hook`.
- `apps/api/src/marketing/content-plan.ts`: call `chooseFormat` per slot, attach card spec and
  `media_url`, store `features`.
- `apps/web/.../PlanPanel.tsx` and `lib/api.ts`: chips and preview.
- Optional gateway task: none. Drafting keeps using the existing `marketing.social_draft.v1` task;
  only the prompt text differs. If a new task id is needed, register it in
  `definitions/ai-tasks.yaml` or the AI-gateway test fails.

**Tests (each must fail without the change)**
- YAML: schema validation rejects a missing prompt/fallback; a hook or example containing fear,
  urgency, scarcity, guarantee words fails; held formats are never returned by `chooseFormat`.
- Every format fallback output passes `checkCopy`; example model outputs in fixtures also pass.
- `chooseFormat`: distinct formats across a week's slots; thread format only where threads exist;
  least-used first; deterministic given the same usage.
- Cards: valid PNG, correct pixel size per channel; long text wraps and never overflows (assert on
  measured line count/height); signature required, tampered id or spec returns 404; no draft text
  is returned without a valid signature; alt text present on the post.
- Plan: an Instagram draft gets `media_url` and becomes approvable; a week uses at least 2 formats;
  existing plan, approve-the-week hash and sweep tests stay green.
- `trust-tier-gate` and AI-gateway tests unchanged and green.
- Web: chips and preview render; missing card shows the existing "needs image" state.

**Verification** — isolated stack, `dry_run_mode: true`: generate a week across five platforms,
fetch every card URL and **look at the images**, confirm Instagram drafts are approvable, approve,
confirm the sweep logs a dry run with zero publisher calls. **Taste check with the owner**: show
the sample week's text and cards before merge; tests do not judge quality.

**Open decisions for the owner** — brand voice changes (default: the presence kit as is); whether
to start with fewer platforms (default: 2 or 3 active).
