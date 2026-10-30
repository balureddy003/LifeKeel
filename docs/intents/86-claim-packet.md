# Intent 86: A claim packet ready on a bad day

**Problem** — When someone dies or cannot work, the household has to find the right
contact, the policy number and the papers while distressed. UK insurers' own claim pages
show the pattern: notify a bereavement team; the policy number is helpful but not always
essential; the death certificate (original or certified copy) is usually needed; a grant
of probate or letters of administration is often needed when the policy is not in trust,
with thresholds that differ by insurer; the claim form is completed by the beneficiary,
executor or trustee
([Royal London](https://www.royallondon.com/siteassets/site-docs/rlcis/claims-life.pdf),
[Aviva](https://www.aviva.co.uk/help-and-support/claims/online-life-claims-notification/death-claim),
[Co-op](https://www.coop.co.uk/insurance/life-cover/life-insurance/life-claims)).
Requirements vary, so each insurer's claim pack is the authority; LifeKeel's packet is a
checklist and a draft, not a claim.

**Done looks like**
- For **one policy type end to end** first, a packet that assembles: the insurer's claims
  contact **as printed on the policy**, the policy number, the policyholder's details from
  the record, and a checklist of papers the household has on file or has not located.
- A drafted notification message addressed to the household's **existing** provider and
  to no one else, with the household's recorded facts filled in. LifeKeel does not send
  it. The household reviews and sends it (PRD-103 prepare-only).
- The checklist says "the insurer's claim pack is the authority" and links to the insurer's
  own page when one is on file. It never states that a claim will be accepted.
- Gaps are shown as gaps: "policy number not on file".
- Nothing here is available to anyone but the household's own adults and a trusted person
  the creator chose (Intent 82 scope).

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 1, prepare-only**; sending is a
  human action outside LifeKeel. Approval gate: the household sends it; `ActionExecutor`
  is not used and `trust-tier-gate.test.ts` is not widened.
- Regulated-advice check: the draft goes only to the existing provider and states facts.
  It is never a comparison, a switch, or a recommendation of a product, and no flow
  suggests a different policy (CLAUDE.md second rule). Fixed templates; passes
  `advice-rule.test.ts`.
- Data/privacy limits: contains policy numbers and personal data; generated from the
  record without a model call where possible; if a model drafts text, it uses the
  gateway, an approved processor and task-minimised context; rule 3 applies.

**Out of scope** — Submitting claims, chasing insurers, legal or probate steps, medical
evidence, and any claim-outcome prediction.

**Becomes** — PRD number once accepted: docs/prd/NNN-claim-packet.md
