# Intent 70: Stage 1 — The household brief (three problems, one solver, send, opened-at)

**Problem** — The market is crowded with storage vaults (SafeKeep, Biscuit Tin, Capsafa, SuccessionKeeper, Lyfeguard, Safe4) and product sellers/advisers, and empty of a shared, computed brief for a real household problem. Meanwhile LifeKeel's public landing page (`HomeExperience.tsx`, `SampleDay.tsx`, `PlusSpotlight.tsx`, `Pricing.tsx`) still leads with "Your family's chart, kept current", a made-up sample family, and Keel Plus sold as AI document reading, while the signed-in home page (`apps/web/src/app/page.tsx`) drops visitors into a multi-step profile wizard and composite score dashboard. A real couple cannot sit down in one evening, answer one specific upcoming problem with a number both adults have seen, and leave without a product recommendation.

**Done looks like**
- **Three problems only** at the front door:
  1. *One of us might stop earning* (earner income stops; savings + any recorded income protection / life cover on file determine how many months the household can run).
  2. *Someone is about to earn less* (income drops by £X in M months; solver projects savings at the change date and runway months after).
  3. *The other adult does not know* (essential handover brief: runway months, who to call, where key papers are, accounts and policies on file).
- **One engine, hot path:** a few problem-specific inputs → one deterministic solver call (`calculate.ts`) → fixed template sentence rendered from the solver payload → stored brief result stamped with `solver_version` and `data_version` → share link generated → `opened_at` stamped when the second adult opens it.
- **Template-first, model-optional (`brief.narrate`):** the brief route itself never calls a model and always returns the solver result plus the deterministic template sentence. If optional narration is requested, it runs as a separate, budgeted single call (`brief.narrate`, `authority: language_only`) through the task gateway with a **server-side numeral-presence output guard** (every numeral in the narrated text must appear in the solver payload, or it falls back to the deterministic template) and is cached by `solver_version + data_version`.
- **First brief free** with zero model calls and zero document uploads required.
- **Cut from landing and upgrade surfaces:** remove the harbour chart hero (`HarbourChart.tsx`, `YearsTimelapse.tsx`), the made-up sample family (`SampleDay.tsx`, `SAMPLE_FAMILY`), and selling Keel Plus as AI document reading (`PlusSpotlight.tsx`, `Pricing.tsx` OCR framing).
- **Success gate (measurable):** `brief_created` → `brief_share_link_generated` → `brief_opened` events, where "finished" means the share link was generated AND `opened_at` was stamped by a **second, distinct** roster member (`opener_member_id != created_by` — the creator opening their own link does not count). Both adults render `runway_months` from the same stored `result` payload, so the numbers are identical by construction; the event stream proves both saw it.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (deterministic calculation, persisted brief read model, revocable share link, anonymous `opened_at` timestamp). Approval gate: none required (user initiates share link via device share sheet or copy link; no outbound email sent by LifeKeel to an unverified third party).
- Regulated-advice check: outputs state only what is entered/on file and the deterministic months calculated; never recommends a product, insurer, or policy switch (`CLAUDE.md` Rule 2).
- Data/privacy limits: zero LLM calls on the first brief path (`CLAUDE.md` Rule 3); share link is unguessable (SHA-256 hashed bearer token at rest), `noindex`, rate-limited, revocable, and every rendered numeral on the shared brief must be present in the cached solver payload — Intent 65's numeral-presence invariant applies to the **deterministic template itself** (built only from solver-payload fields, no hard-coded example numbers), not only to `brief.narrate` output.

**Out of scope** — Problem packs beyond the initial three (Stage 2), live open-banking or pension feeds (Stage 3), external partner read API (Stage 4), and AI document extraction on the first-brief path.

**Becomes** — [docs/prd/222-stage-1-the-household-brief.md](../prd/222-stage-1-the-household-brief.md)
