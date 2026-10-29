# PRD-229: A trusted person, and sharing the months without the figures

Status: **PROPOSED, BLOCKED on a safeguarding review.** Design may proceed; no code
ships until a qualified reviewer has signed off the recipient-control rules below.

## Problem

The brief assumes two adults in the household. Lone parents are about one family in
six (ONS: 3.0 million, 15.4% of families in 2021; 2025 shows small rises in the share),
so the "second adult" framing excludes a large group. Couples also differ in how much
they will show each other. At the same time, Surviving Economic Abuse reports about 1 in
22 UK adults have had a partner or ex-partner control or try to control their personal
bank account, and lists monitoring through apps as a common tactic. Any new way to share
a household's money has to be designed so it cannot be used for that.

## Who it's for

A lone parent who wants someone to hold the picture if something happens; a couple
where one adult wants to share the months but not the figures; a trusted relative or
friend who needs a plain, printable result without creating an account.

## What "done" looks like

1. **Just me path.** Onboarding and the catalogue accept a household with one adult.
   A brief can be created and used without a second confirmation; the "confirmed by
   two adults" language is shown only where two adults exist.
2. **Trusted person.** The creator nominates a person by label (for example "Mum"),
   gets a one-time link, and chooses a scope: months only, months plus dated change,
   or months plus chosen handover items. The recipient needs no account.
   - The link is single-use for confirmation, expires (default 30 days, re-issuable),
     and is revocable by the creator and leavable by the recipient.
   - A trusted person can print or save a PDF of the same result; nothing else.
3. **Months-only share.** A share mode whose API response contains the runway months,
   the dated change and chosen handover items and **contains no income, spending,
   savings or cash figures anywhere in the payload**, enforced by a test that scans
   the response.
4. **Recipient control and no surveillance.**
   - The recipient can decline, leave or stop receiving a share at any time.
   - Declining or leaving sends no notification to the creator and changes nothing
     the creator sees beyond "not confirmed".
   - The creator never sees a "not opened" state, a read time, or an access time for
     a trusted person. Confirmation is shown only when the recipient chooses it.
   - For two-adult households the Intent 78 acknowledgement flow is unchanged, but
     the second adult can leave a share with the same no-notice rule.
5. **No brief about another adult's money without that adult.** Another adult's income
   is entered by that adult, or by the creator and labelled as the creator's estimate.
   An estimate is never shown as confirmed by that adult.
6. **Role integrity.** Only the creator can add or remove a trusted person; the
   designated adult cannot be replaced silently; changes are recorded in the audit log.
7. **Copy.** All share, decline and leave messages are fixed factual text and pass
   `advice-rule.test.ts`.
8. **Safeguarding review recorded** before launch, with its outcome linked from this
   PRD, and a named owner for revisiting it after the first cohort.

## Constraints

- **Trust tier:** 0. Creator-initiated links only; LifeKeel sends no message.
- **Regulated-advice check:** copy is informational (item 7).
- **Data/privacy:** DPIA covers third-party recipients; recipient data is a label and a
  link, no account; sensitive handover facts are shown only if the creator includes
  them and consent is recorded (PRD-227 Part A); `CLAUDE.md` rule 3: no model call on
  this content.

## Out of scope

Separation, child-maintenance and co-parenting briefs; joint-account visibility; feeds;
reminders to a trusted person; any way for a creator to learn that a link was opened.

## Builds on

Intent 78, PRD-222, PRD-227 (Part A), `apps/api/src/briefs/briefs.ts`,
`apps/api/src/routes/family-briefs.ts`, Intent 82.

## Success metrics

Share of lone-parent households that create a brief and nominate a trusted person;
share of trusted-person links confirmed by the recipient (confirmation is the
recipient's choice, so a low rate is not a failure on its own); zero payload scans
showing figures in months-only responses; zero creator-visible signals about
unconfirmed recipients (verified by test). Qualitative: safeguarding reviewer's
conditions are all closed before launch.
