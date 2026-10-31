# PRD-235: A claim packet ready on a bad day

Status: **PROPOSED.** From Intent 86. **Tier 1, prepare-only** — the household
sends; `ActionExecutor` is not used and `trust-tier-gate.test.ts` is not
widened. Gated on PRD-232 and PRD-233 landing (A–D per the work order).

## Problem

When someone dies or cannot work, the household has to find the right contact,
the policy number and the papers while distressed. UK insurers' own claim
pages show the shape: notify a bereavement or claims team; the policy number
is helpful but not always essential; the death certificate is usually needed;
a grant of probate or letters of administration is often needed when the
policy is not in trust — thresholds differ by insurer, so **the insurer's own
claim pack is the authority**. LifeKeel's packet is a checklist and a draft,
never a claim.

## Who it's for

A household whose records already hold at least one life-type policy — and the
trusted person the creator chose (Intent 82 scope) who may need to act while
grieving.

## What "done" looks like

1. **One policy type end to end first: `life`.** `POST
   /family/policies/:policy_id/claim-packet` assembles, from the record only:
   the insurer's claims contact **as printed on the policy** (`contact_phone`
   / `contact_email` fields — if absent, "claims contact not on file"), the
   policy number, the policyholder's details, and a checklist of papers the
   household has on file (`documents`/key-papers sources) or has not located.
2. **A draft notification, never sent.** The packet includes a fixed-template
   draft addressed to the household's **existing provider and no one else**,
   with recorded facts filled in. The household reviews it and sends it
   themselves — PRD-103 prepare-only. No `ActionExecutor`, no send button,
   no `tel:`/`mailto:` auto-action beyond a printable/copyable draft.
3. **The insurer's pack is the authority.** The checklist states this plainly
   and links the insurer's own page **only when one is on file**
   (`provider_form_url` from PRD-234 or the document's source link). It never
   states that a claim will be accepted, and never states deadlines or terms
   not read from a source.
4. **Gaps are shown as gaps.** "policy number not on file", "death
   certificate not located", "claims contact not on file" — the packet is
   honest about what is missing rather than papering over it.
5. **Scope.** Adults of the household, and a trusted person the creator chose
   (Intent 82). No model call: the packet assembles from the record and a
   fixed template — rule 3 is satisfied by not calling one.

## Constraints

- **Trust tier:** 1, prepare-only. The send is a human action outside
  LifeKeel.
- **Regulated-advice check:** the draft goes only to the existing provider
  and states facts — never a comparison, a switch, a different-policy
  suggestion, or a claim-outcome prediction. Fixed templates join
  `advice-rule.test.ts`.
- **Data/privacy:** policy numbers and personal data stay inside the tenant;
  no model call; access-logged like other sensitive reads (Intent 79).

## Out of scope

Submitting or chasing claims, legal/probate steps, medical evidence,
claim-outcome prediction, non-life policy types (follow-up slice), and any
send mechanism.

## Builds on

Intent 86; `policies[]` (`contact_phone`, `contact_email`, `policy_number`,
`nomination.provider_form_url`); `emergency-sheet.ts` sources; PRD-103
prepare-only pattern; Intent 79/82.

## Success metrics

- **Cheapest first test:** given a life policy with contact + number on file
  and one document on file, the packet assembles the contact verbatim, the
  checklist, and the draft; the same policy with gaps shows them as gaps —
  all asserted in an API test with no browser and no model.
- Zero `ActionExecutor`/`taskLlm` calls on the packet path (asserted under
  the dead-mock pattern).
- Share of households with a life policy that open a packet (counts only).
