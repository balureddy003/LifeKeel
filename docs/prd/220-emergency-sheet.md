# PRD-220: Product-led invite and share loop (emergency sheet)

## Problem

LifeKeel's best low-cost acquisition is existing families telling other
families, but the product gives them no moment or tool to do it. PRD-110
(partner joins the same family) and PRD-112 (friend referral link with a
two-sided credit) are both shipped — verified against `family-join.ts`,
`app/invite/[code]`, and `referrals.ts` — but there is no visible prompt at
the moments people feel the value ("my partner could find this if something
happened to me"), and no artefact worth sharing. Referral signups also do not
appear next to the social channels in the operator economics view — today a
`ref=` signup writes only a `referrals` row and reads as `direct` in
attribution.

## Who it's for

Existing families (a partner who can find things, an artefact worth sharing);
the founder (the cheapest acquisition channel made measurable).

## What "done" looks like

1. **Invite-your-partner prompt.** After a family's first useful result
   (first insight or first completed chart section, whichever exists), one
   calm dismissible card: "Add your partner so they can see this too". It
   opens the existing invite-code flow. Shown at most once per week, never
   after dismissal twice, never to a family that already has a second login.
2. **Shareable emergency sheet.** A one-page sheet the owner generates from
   their own on-file records: who to call, where the key papers are, which
   accounts and policies exist (names the family already entered; no balances
   unless the owner ticks them). Properties:
   - Built deterministically from the owner's own data — no model call, no
     marketing use.
   - Owner picks sections before anything renders; default is everything
     off.
   - Delivered as a file the owner sends themselves (print / save as PDF /
     native share). **No public URL ever contains family data**; no
     server-side copy kept beyond the request.
   - Footer: "Made with LifeKeel" and the owner's referral link, in plain
     text, removable by a toggle. "Informational only" line retained.
3. **Friend referral surfaced.** After the sheet is generated, "Know a family
   who would find this useful?" with the referral link and one-tap
   copy/share. Reward rules stay exactly as PRD-112 defines them (credit both
   sides on the invitee's first meaningful action).
4. **Measurement.** New `KNOWN_EVENTS`: `invite_prompt_shown`,
   `invite_prompt_clicked`, `sheet_generated`, `sheet_shared`,
   `referral_link_copied`; meta carries only a short enum. Shareable links
   are `/signup?ref=<code>&utm_source=referral&utm_medium=social&
   utm_campaign=<sheet|invite>` — `captureAttribution` picks the utm_* up
   client-side, so ref signups appear beside social channels in the funnel
   and economics views with the same intervals. A "Referral" row on the
   channel table; no new report.
5. **Abuse and cost controls.** Referral signups from the same device/IP
   burst are rate-limited by the existing limiter; credits stay capped per
   referrer (reuse PRD-112's cap or add one).

## Constraints

- **Trust tier:** 0/1. Generating a sheet is read-only on the owner's own
  data and nothing is sent by LifeKeel — the owner sends it. Credits are
  internal app currency (precedent: `redeemPromoCode`). No external provider
  call, no message sent on the family's behalf.
- **Regulated-advice check:** the sheet and prompts only list what is on
  file and point to "a licensed professional" where relevant; no
  recommendations, no provider names beyond what the owner entered, no "you
  should switch". Prompt and sheet copy pass `checkCopy`/advice-rule.
- **Data/privacy:** the sheet contains the family's most sensitive content —
  which is why it is owner-generated, opt-in per section, file-based and
  never hosted. No telemetry carries sheet content. Children's-data posture
  (intent 09) applies: no minors' details unless the owner ticks them.
  Events are anonymous enums. **Counsel reviews the sheet wording once** —
  it is the most family-sensitive artefact in the marketing path.

## Out of scope

A hosted/shared-by-URL sheet, LifeKeel-sent email or SMS, social "share to
feed" buttons carrying family content, rewards beyond PRD-112's,
partner-account permission redesign, public family profiles, referral
leaderboards.

## Builds on

PRD-110 (shipped join flow), PRD-112 (shipped referral mechanics).
Build spec: `docs/intents/17-invite-and-share-loop.md`.

## Success metrics

`invite_prompt_*`/`sheet_*`/`referral_link_copied` events visible in
`/growth/summary`; a ref signup shows `utm_source=referral` in funnel rows;
the sheet renders only the ticked sections and stores nothing server-side.
