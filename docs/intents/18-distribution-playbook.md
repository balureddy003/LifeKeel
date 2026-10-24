# Intent 18: Distribution playbook (drafted by Keel, executed by the founder)

**Problem** — With ~100 landing views a month, posting to six platforms will not move signups;
people-and-places distribution will. The founder needs a short, concrete, repeatable plan of where
to show up, what to say, and how to measure it, with every message in the founder's own voice and
nothing posted or sent by software. Nothing like this exists in `docs/marketing/` today.

**Done looks like**
A single document, `docs/marketing/distribution-playbook.md`, plus a reusable tagged-link helper,
that an agent or the founder can follow with no further research:
1. **Ranked channel list (10 to 15 entries)** with, per entry: audience, why LifeKeel fits, the
   rules of the place (self-promotion limits, disclosure norms), effort per week, expected signal,
   and the exact tagged link to use. Candidates to evaluate with fresh web research (cite sources
   and date; do not assert from memory): UK personal-finance and family-admin communities,
   parenting and bereavement-admin forums and Facebook groups, relevant subreddits, solicitor /
   will-writing / financial-planner referral conversations (information sharing only, see
   constraints), local parent networks, newsletter swaps, podcasts, Product Hunt-style launches,
   Hacker News Show HN, indie/builder communities, Bluesky starter packs and feeds, LinkedIn
   founder posting, directory listings (free ones only).
2. **A 4-week sprint plan**: 3 to 5 actions a week, each with a time box (<= 3 hours a week
   total), the draft text, and a success check. Week 1 is conversations and listings, not posts.
3. **Draft messages in the founder's voice**, clearly marked as drafts: a short "what I'm building
   and why" story post, 5 helpful answers templates for recurring questions (information only),
   a launch post per venue type, and an outreach note for newsletters/podcasts. Each passes
   `checkCopy` and the advice rule (run them through the checker; record the result in the doc).
4. **Tracking**: a table mapping each action to a tagged link
   `utm_source=<venue>&utm_medium=social|content&utm_campaign=playbook&utm_content=<action_id>`
   built through `utmQuery` (a tiny CLI or script in `scripts/` that prints the link and validates
   the token rule is enough). Visits and signups then appear in the intent 15 table and the funnel.
5. **A weekly 15-minute review checklist**: what was done, visits and signups by action, one thing
   to repeat, one to drop. Becomes the input to the intent 19 brief once it exists.
6. **Compliance guardrails section** the founder can keep open: never promise outcomes, never
   recommend products or providers, always disclose being the builder when promoting, respect
   each community's rules, no unsolicited DMs, no fake accounts or astroturf, no scraping.

**Constraints**
- Trust tier: 0. Documentation and a link-building script only. **No software posts, replies, DMs
  or emails**; the founder performs every action. No connector calls.
- Regulated-advice check: all draft text is information about what is on file and what the product
  does; where a reader asks for a recommendation, the template points to "a licensed professional"
  and "compare quotes from multiple insurers". No product comparison or switch advice, even when
  a community asks for it.
- Data/privacy: no personal data of community members is collected or stored; no scraping of
  forums; no family content in drafts.

**Out of scope** — paid ads or sponsorships (needs budget decision), automated outreach, a CRM for
prospects, influencer programmes, building new product features, translating to other markets.

**Becomes** — a document, not a PRD; link it from `docs/marketing/social-presence-kit.md`.

---

## Build spec

**Files**
- `docs/marketing/distribution-playbook.md` (the deliverable).
- `scripts/utm-link.mjs` (or `.ts` via the repo's runner): `node scripts/utm-link.mjs
  --source reddit-personalfinanceuk --medium social --campaign playbook --content a01 --path /`
  prints the URL using the same token rule as `apps/api/src/marketing/utm.ts` (import it if the
  repo's tooling allows, otherwise copy the regex and add a test that fails if they diverge).
- Optional test: a script or vitest that runs every draft message in the doc through `checkCopy`
  (extract fenced blocks tagged `draft`) so the doc cannot drift from the guard — run them as
  kind `'social'`; the buy/switch rule does not fire for the `'blog'` kind.

**Acceptance (reviewer checks)**
- Every channel claim cites a source with a retrieval date; rules-of-the-venue are quoted or
  summarised, not guessed.
- Every draft block passes `checkCopy` and the advice-rule words list; the doc records the run.
- No action requires software to post. The script only prints links.
- Total weekly effort in the sprint is <= 3 hours and the first week requires no new content.

**Research method for the agent** — use web search for current venue rules and audience sizes;
prefer primary sources (venue rules pages, official docs); note anything unverifiable as such.

**Open decisions for the owner** — whether the founder is comfortable being named as the builder
publicly (default: yes, with disclosure); preferred communities to exclude.
