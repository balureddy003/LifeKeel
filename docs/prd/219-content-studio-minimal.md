# PRD-219: Minimal Content Studio — three formats in YAML, signed brand cards

## Problem

Every post is written by one generic prompt from one of 12 hard-coded briefs,
so the week looks the same as last week, a learner would have nothing distinct
to compare, and Instagram and Facebook drafts have no image (Instagram cannot
post without one — `IMAGE_REQUIRED_CHANNELS`). The earlier plan for a large
Studio (seven formats, AI-proposed briefs, a Briefs panel, a bandit) is too
heavy for ~100 visits a month. This is the smallest version that makes content
visibly more varied and attractive.

## Who it's for

The operator (a week that doesn't look cloned; Instagram drafts that can
actually be approved); prospective families (more varied, better-presented
posts).

## What "done" looks like

1. **Three formats in `definitions/marketing-formats.yaml`**, loaded and
   validated with Zod at boot (invalid file fails API start, like other
   definitions):
   - `myth_vs_file` — "a common assumption" vs "what a family can check on
     file".
   - `one_thing_to_check` — one small habit (a renewal date, a named
     beneficiary, where the papers are). Information, never advice.
   - `hard_day_steps` — a calm numbered list of what a partner would need to
     find, rendered as a single post. (No publisher posts multi-post threads
     today; thread splitting is out of scope — an optional `thread: true`
     marker may exist in the schema for later, never acted on.)
   Each format: `id`, `label`, `channels` it suits, `min_facts`,
   `draft_prompt`, `fallback` (deterministic template for the no-model path),
   optional `card` layout name.
2. **A hook allow-list** in the same file: `question`, `concrete_scene`,
   `myth_bust`, `checklist`, `plain_statement`, `claim`. Fear, urgency,
   scarcity, guarantees and "act now" are excluded by construction (a test
   asserts no hook text or example contains them).
3. **Selection**: `chooseFormat(slot, channel, usage)` picks the least-used
   suitable format, a different one per slot in a week, never a `thread`
   format on a channel without thread support (today: never). Format and hook
   land on `features.format`/`features.hook` (PRD-218).
4. **Drafting by format**: `draftPostText` takes `format` and `hook` and uses
   that format's prompt; the no-model fallback renders deterministically from
   brief facts.
5. **Brand cards for Instagram and Facebook**: deterministic SVG templates
   rendered to PNG with `sharp` (already a dependency), product palette, two
   layouts (headline; myth/fact), 1080x1350 (Instagram) and 1200x630
   (Facebook). Served by `GET /public/social-card/:postId.png?s=<hmac>` —
   HMAC covers post id plus card spec; no auth; long `Cache-Control`;
   rate-limited; the URL is built against the API's public origin (not
   `LIFEKEEL_URL`), and when no public API base exists `media_url` stays
   unset so the draft remains "needs image" rather than carrying a dead link.
   Text on a card is clamped and wrapped; overflow is a test failure.
6. **Briefs unchanged** (the 12 in `content-plan.ts`); an optional move to a
   `briefs` YAML is allowed. No AI brief proposals, no Briefs panel.
7. **Plan tab**: format and hook chips per draft and a card preview where one
   exists. No new tab.

**Held, not built** (counsel reviews wording first): "calendar moment" and
"illustrative scene" formats — reserved in the schema as `status: held`,
never selected by `chooseFormat`.

## Constraints

- **Trust tier:** 0/1 (prepare drafts and images). Publishing stays Tier 2:
  the human approves exact text via the content hash and sees the card. No
  new autonomous publish path; `NEVER_AUTONOMOUS` unchanged.
- **Regulated-advice check:** every format's deterministic output and every
  example passes `checkCopy`; facts come only from live claims in the
  registry; no personal recommendations, named providers, "buy/switch",
  savings promises, invented numbers or testimonials; keep "Informational
  only" where the presence kit requires it.
- **Data/privacy:** public marketing text only; cards render only text
  already in the post; no family content in prompts; no new trackers. Voice
  source: `docs/marketing/social-presence-kit.md`. Card signing reuses the
  per-purpose HMAC pattern (`auth/signing-key.ts` `hmacFor`/`verifyLinkHmac`,
  as `heartbeat-unsubscribe.ts` / `lifecycle-emails.ts` use it) — no new
  secret store.

## Out of scope

AI-generated images or video, carousels, AI-proposed briefs, Briefs panel,
calendar and scene formats (held), auto-replies/DMs, paid ads, landing page
changes, any learning (PRD-221), multi-post threads.

## Builds on

PRD-218 (post features), intent 14 (channel health + "needs image" gating).
Build spec: `docs/intents/16-minimal-content-studio.md`.

## Success metrics

A generated week uses at least 2 formats; every Instagram draft carries a
signed card `media_url` and is approvable; a week with the model disabled
still produces complete drafts via the fallbacks.
