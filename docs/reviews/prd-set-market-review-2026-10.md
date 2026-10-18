# Market review of the growth, retention and ingestion PRDs (October 2026)

As of 2026-10-18. Four independent research reviews of PRDs 138-147 and 203-206
(conversion and behavioural growth; retention and notifications; competitive
positioning; trust, privacy and regulatory), each reading the PRDs and the repo,
researching externally, and reporting. This document is the synthesis. The PRDs
carry the resulting requirement changes in an "Amendments from the October 2026
market review" section.

## How much to trust this

- **Repo claims were re-checked by hand** before being used (see "Verified in the
  code" below). Everything in that section was read in the source.
- **External evidence is mostly secondary** (law-firm notes, vendor documents,
  trade press). Apple, Google and ICO primary pages were read for the trust review;
  they are marked verified there. The conversion and retention reviews could not
  reach primary sources for Apple's current rules, the DMCC regulations, or any
  digest-cadence benchmark.
- **No benchmark was found** for calculator-to-email conversion, the effect of magic
  links, UK family-app trial-to-paid, or digest cadence in passive-utility products.
  Every numeric default in the PRDs (monthly digest, 14-day cap, 2 per month, 2 per
  quarter, "two unopened") is a hypothesis to test, not a requirement with evidence.
- **Sample-size arithmetic** in the conversion review is the reviewer's own, not
  sourced: about 2,200 views per arm to detect 5% to 7% on reveal-to-email, and about
  1,100 trial starts per arm for 20% vs 25% trial-to-paid, which this product cannot
  reach. Plan top-of-funnel tests only, one at a time.
- **Competitor facts are mostly US-sourced and secondary.** Treat "nothing found for
  Slovenia" as weak evidence. Re-verify before using any competitor or price claim to
  justify a build or pricing decision.
- Reviewers are researchers, not lawyers. Items below marked "counsel" need a lawyer.

## Verified in the code

1. `sendHeartbeatEmail` (`apps/api/src/auth-email.ts`) returns `void`, swallows send
   errors, and returns silently when `SENDGRID_API_KEY` is unset.
   `family-heartbeat.ts` inserts the `heartbeat_sends` row after the call regardless,
   so a skipped or failed email is recorded as sent and never retried.
2. The monthly job runs at `0 8 1 * *` but the window starts on the 1st of the current
   UTC month, so it covers about eight hours. It should cover the previous month.
3. `DeliveryRouter.inQuietHours` uses the server's `getHours()`, not the family's
   timezone. The heartbeat bypasses the router entirely, so no shared budget applies.
4. The heartbeat email has no `List-Unsubscribe` header and no unsubscribe link in the
   sender, renderer or job.
5. PRD-136 defaults to weekly and measures a "30-day return rate", which contradicts
   PRD-138 (monthly) and PRD-141 (retention for users who don't log in).
6. The repo has no localisation (no i18n library, no `Intl` use). ARCHITECTURE.md
   already lists a single-currency assumption as a P2 gap. The product is served on
   `lifekeel.si`.
7. `feature_hash_eval` loads approved and dismissed insights across tenants.
   SECURITY.md already says it should become per-tenant, synthetic, or governed. It
   becomes a Gmail Limited Use problem the moment PRD-144 produces Gmail-derived
   insights.

Items 1-4 are bugs in shipped code, independent of any PRD. They are tracked as a
separate piece of work, not fixed in this docs change.

## Findings that changed the PRDs

| PRD | Finding | Basis |
|---|---|---|
| 203 | Email scanners prefetch and burn single-use links. Use link plus a 6-digit code; a GET shows a page and a POST consumes the token. | Secondary (Okta, Stytch, Supabase); OWASP verified |
| 203 | "Resend answers from the client" breaks the cross-device case. Create a short-lived pending record only after the user clicks "Keep this result". | Reasoning |
| 203 | Identical response bodies are not enough against enumeration: uniform timing, async send, per-address and per-IP caps, no score in the email. | OWASP verified |
| 204 | Do not publish "we don't train AI on your content" until the registry (PRD-142) is wired. CLAUDE.md says it is not enforced by code yet. | Repo |
| 205 | Default expiry, a report control, no email sent by LifeKeel to the third party, no-referrer. | Reasoning |
| 206 | The DMCC subscription regime is reported as not yet in force (expected spring 2027). Design to that standard, say "designed to meet", not "compliant". | Secondary (law firm); counsel |
| 206 | "3 items could be filled from your email" cannot be true for a user with no mailbox connected. | Logic |
| 206 | Apple allows link-outs to non-IAP purchase without an entitlement only on the US storefront. Shell v1 is web checkout only. | Verified (Apple 3.1.1); UK/EU terms need checking |
| 138 | A digest that can fail silently is the opposite of proof of work. Return a delivery result, record sends only on success, alert on a missed cycle. | Verified in code |
| 138 | A promotional element would make the digest PECR direct marketing. Keep it informational, add one-click unsubscribe. | Secondary (law firms, ICO) |
| 139 | Renewal reminders alone (30/14/7 days) exceed a 1-per-14-days cap. Never demote dated-obligation messages; ask before demoting. Opens are unreliable, so use clicks. | Reasoning; MPP is inference |
| 141 | Retention conditioned on "still paying" and "did not log in" is survivorship-biased; the 4-week baseline is shorter than one monthly cycle. | Reasoning |
| 142 | Registry needs per-model retention class, sub-processors, transfer mechanism, DPA date, breach-notice SLA. A `source=gmail` flag must block eval capture, human review and cross-tenant use. | Verified (Google policy) |
| 143 | A DPIA, ROPA and Art. 6/9 decision are missing. Policies and wills can carry health data. Never extract medical text. | Verified (ICO DPIA triggers) |
| 144 | `gmail.readonly` and `gmail.metadata` are both restricted scopes; "narrowest scope" is not true for this purpose. Google verification and an annual security assessment are launch gates. | Verified (Google) |
| 144 | "Rest of the inbox neither read nor retained" is overstated: header matching inspects the inbox. | Logic |
| 146 | Erasure covers backups; they may persist "beyond use" and the receipt must say so. LifeKeel cannot verify a negative at a provider. | Verified (ICO) |
| 146 | A retention sweep that irreversibly expires user documents conflicts with CLAUDE.md rule 1. | Repo |
| 201 | Leans on a US FEMA statistic for a UK product, and its result spec is superseded by 125 and 203. | Repo |

## Decisions for the product owner (not applied)

These change scope or strategy and were left alone.

1. **Defer PRD-144 (mailbox agent)?** The competitive review argues Trustworthy
   already ships it and the security assessment is a recurring cost. The trust review
   adds launch gates. The upload path (143) carries most of the value without them.
2. **Defer PRD-205, trim PRD-139 to a family-level cap and PRD-140 to web push plus
   email?** Recommended by the competitive review; the retention review pushes the
   other way on caps being too rigid.
3. **Billing is dormant (PRD-006).** PRDs 138, 141 and 206 measure paying users who do
   not exist yet. Make production cutover the gating milestone, and decide whether to
   drop "annual plans out of scope" and add a pricing and packaging test.
4. **New PRDs the portfolio lacks:** partner distribution compatible with zero
   commission (employers, flat licence fees, aggregate stats only, no steering); a
   detector roadmap (11 of 14 PRDs are plumbing around nine detectors); a
   jurisdiction pack for UK and Slovenia (currency, locale, document types, per-language
   advice-rule tests); a trust-marks plan (ICO registration, Cyber Essentials Plus,
   pen-test summary, "how we make money" page, public sub-processor table).
5. **Re-scope PRD-137.** Empathy LifeVault reportedly launched in the UK on 2026-08-05
   with wills, powers of attorney, an asset register and trusted-contact access. The
   repo's market documents say no funded competitor does this.
6. **Counsel:** Art. 9 consent design; controller and processor roles; transfer
   mechanisms; Slovenian specifics (deceased persons' data, minors, ZEKom/ePrivacy);
   PECR for push and partner links; FCA sign-off on the gap-estimate copy
   (the FCA's targeted-support regime is not a loophole and rule 2 stays correct);
   Apple UK and EU link-out terms; DMCC applicability; AI Act classification.
7. **Your inputs:** which AI processors have signed DPAs; the security-assessment
   budget and date (only vendor pages gave costs, roughly USD 540 to 6,000 for Tier 2,
   unverified; get a quote); retention and backup windows; shell v1 scope.

## Stale or unverifiable claims in the repo's market documents

Flagged by the competitive review. None has been edited; each needs a primary-source
check first.

- LifeVault is treated as North American only, and "no competitor models legacy" is now
  contradicted by the UK launch above.
- The Empathy $72M Series C is dated May 2025, not recent; "40M+ lives" is unverified.
- "LifeOS needs the user to initiate" is contradicted by its own site (proactive alerts,
  monthly check-in calls). Its price and the "13x versus 1/12th" comparison are
  inconsistent.
- Monarch, Copilot and Origin prices and Origin's model, tool-count and funding claims
  are unverified or differ from secondary reports.
- Trustworthy Next has conflicting dates (11 Mar 2026 in the body, 7 Oct 2026 in
  metadata).
- `built-vs-market-and-innovation-flywheel-2026-10.md` has a duplicated status and
  roadmap block (about lines 433-514) with stale "Kairos" and "Oak" strings.
- PRD-201 says Policygenius and Ladder use "exactly this mechanic"; unverified.
- Nearly all comparators are US companies.

## Top risks to the plan

1. Distribution and monetisation are unproven; billing is dormant.
2. Bundling by Empathy, Trustworthy and bank AI assistants (Revolut and Starling reported
   shipping them in 2026).
3. A trust or regulatory-boundary incident, most plausibly from mailbox ingestion or an
   advice-like sentence in generated copy.
