# PRD-208: Trust marks and public evidence

## Problem

The product asks a family for its most sensitive documents and, optionally, access to
its mailbox. Its zero-commission and no-training positions are the reason to trust it,
but today they are claims in copy, and the repo says rule 3 is not yet enforced by code.
There is no published sub-processor list, no security-testing summary, no vulnerability
disclosure policy, and no external attestation. Families, partners (PRD-207) and app
stores will all ask for these.

## Who it's for

Prospective users deciding whether to upload a document; partners doing due diligence;
reviewers at Apple and Google; the operator answering a question from a family.

## What "done" looks like

1. A public **trust page** that states only what is true and current, each statement
   linked to its evidence. A statement that cannot be evidenced is removed, not softened.
2. **How we make money:** plain-words model, no commissions, no referral fees, partner
   rules from PRD-207.
3. **Who processes your data:** the live sub-processor and retention table generated from
   the registry (PRD-142) and deletion rules (PRD-146), including backup windows.
4. **Security evidence:** an independent penetration test summary (upload, magic-link,
   share-link, mailbox flows), a vulnerability disclosure policy with `security.txt`,
   and a breach-response plan naming the regulators.
5. **Data protection evidence:** a published DPIA summary (PRD-143's launch gate), the
   regulator registration or fee position for each jurisdiction (PRD-149), and
   Article 28 agreements with processors on file.
6. **External marks, in order of cost and relevance** (quotes needed; none are priced
   here): UK Cyber Essentials Plus; Google's restricted-scope verification and annual
   assessment if PRD-144 proceeds; a later ISO 27001 or SOC 2 decision based on partner
   demand.
7. **Outcome evidence:** aggregated, minimum-cohort counts of gaps surfaced and closed
   (PRD-148), never individual data.
8. **Truthfulness rule:** a mark is described as "designed to align with" until it is
   achieved, and a claim is only published once the code or contract backs it. The "we
   don't train on your content" line waits for PRD-142's tripwire test; the vault-sealing
   page states that sealing excludes OCR (PRD-134, PRD-143).
9. Each item has an owner, a renewal date and an evidence link, and a stale one is
   flagged in the operator console.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** the trust page describes the product; it contains no
  advice and no provider names.
- **Data/privacy:** published figures are aggregate with a minimum cohort size.
- Registration and fee obligations differ by country; counsel confirms them for the UK
  and Slovenia rather than this PRD asserting them.

## Builds on

PRD-142, PRD-143, PRD-144, PRD-146, PRD-148, PRD-149, PRD-207, SECURITY.md, PRD-134.

## Success metrics

Upload and mailbox-connect rates among users who viewed the trust page versus those who
did not (observational, not causal); partner due-diligence turnaround; zero published
claims found to be untrue.

## Out of scope

Paid badges with no substantive audit, claiming certifications not held, and any
statement the code cannot back.

## Open questions

Budget and timing for the penetration test and Cyber Essentials Plus; who owns the page
and the renewal calendar.

## Becomes

docs/prd/208-trust-marks-and-public-evidence.md
