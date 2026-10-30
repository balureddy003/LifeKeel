# Intent 91: Adviser and employer pilots built on the brief link

**Problem** — One £7.99 plan sold household by household is slow (about 125 payers make
£1,000 a month; about 1,250 make £10,000). Reach should come through people who already
hold the client: protection advisers, mortgage brokers, will-writers, accountants, and
employers. The first pilot design measured "how many finish setup", which is an effort
measure. The brief link already opens a real result with no sign-up, so the pilot can
measure the better thing.

The regulatory line matters more than the growth idea. The FCA's rules for introducer
appointed representatives exclude arranging deals in investments, and commentary treats
"passive introduction versus arranging" as the key question
([FCA Handbook, PERG 8](https://handbook.fca.org.uk/handbook/perg8/perg8s34),
[FCA Handbook glossary](https://handbook.fca.org.uk/glossary/G1018)). The FCA has warned
firms about introducers drifting into advice. Nothing was found specific to referral links
in software; **take regulatory advice before approaching advisers** (open decision 6).

**Done looks like**
- A professional can send a household a brief link. The household sees a real result with
  no sign-up. The link carries LifeKeel's factual numbers only.
- **No revenue from placement, switch or commission**, and no product named anywhere in
  the link, page or message. Pricing to the professional, if any, is a flat seat or client
  fee, set only after counsel's view.
- The professional sees **their own outcome counts only** — links sent, results seen,
  second adults confirmed — as aggregates, never a household's figures, never whether a
  specific person opened a link (Intent 82).
- Pilot measures, in place of "finish setup": time to first useful number, and share of
  households whose second adult confirms within 7 days (PRD-230).
- Pilot scope: five professionals, ten clients each, free; wording reviewed first.
- Employers: a life-event brief an employee runs privately; the employer never sees
  figures (existing Stage 3 employer-seat rule).

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; creator-initiated links,
  nothing sent by LifeKeel.
- Regulated-advice check: the whole intent is bounded by CLAUDE.md's second rule. If the
  pilot cannot be run without LifeKeel becoming an intermediary, the right response is to
  narrow it, not to add compliance machinery.
- Data/privacy limits: professional dashboards contain aggregates only; no client data is
  readable by the professional without a household grant (Stage 4, separate).

**Out of scope** — Adviser portals that read client figures, fact-find export (Stage 4),
commissions, lead sales, and pricing beyond the pilot terms. Pricing has its own intent
(39) and feeds are Stage 3 (intent 72).

**Becomes** — **Gated** on regulatory advice. PRD number once cleared:
docs/prd/NNN-adviser-and-employer-brief-link-pilot.md. Builds on PRD-207.
