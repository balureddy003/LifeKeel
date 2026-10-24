# Intent 17: Product-led invite and share loop

**Problem** — LifeKeel's best low-cost acquisition is existing families telling other families, but
the product gives them no moment or tool to do it. PRD-110 (partner joins the same family) and
PRD-112 (friend referral link with a two-sided credit) describe the mechanics; the product has no
visible prompt at the moments people feel the value ("my partner could find this if something
happened to me"), and no artefact worth sharing. Attribution of these signups is also not visible
next to the social channels in the operator economics view.

**Done looks like**
1. **Invite your partner prompt (PRD-110).** After a family's first useful result (first insight
   or first completed section of the chart, whichever exists today), show one calm, dismissible
   card: "Add your partner so they can see this too". It opens the existing invite-code flow
   (`/family`, `invite/[code]`). Shown at most once per week, never after dismissal twice, never
   to a family that already has a second login. Verified during review: PRD-110 join is shipped
   end-to-end (`routes/family-join.ts` request/approve/deny/code-reset, `app/invite/[code]`,
   invite code surfaced in settings and home) — the prompt card is the only new work here.
2. **Shareable emergency sheet.** A one-page sheet the owner generates from their own on-file
   records: who to call, where the key papers are, which accounts and policies exist (names the
   family already entered, no balances unless the owner ticks them). Properties:
   - Built **deterministically from the owner's own data**, no model call, no marketing use.
   - Owner picks which sections to include before anything renders; default is everything off.
   - Delivered as a **file the owner sends themselves** (print / save as PDF / native share sheet).
     **No public URL ever contains family data.** No server-side copy kept beyond the request.
   - Footer: "Made with LifeKeel" and the owner's referral link (`/signup?ref=<code>`, PRD-112),
     in plain text, removable by a toggle. Informational only line retained.
3. **Friend referral surfaced (PRD-112).** After the sheet is generated, offer "Know a family who
   would find this useful?" with the referral link and a one-tap copy/share. Reward rules stay as
   PRD-112 defines them (credit both sides on the invitee's first meaningful action).
4. **Measurement.** Events through the existing public endpoint's allow-list (add to
   `KNOWN_EVENTS`): `invite_prompt_shown`, `invite_prompt_clicked`, `sheet_generated`,
   `sheet_shared`, `referral_link_copied`. Meta carries only a short enum (never ids or text).
   Signups arriving with `ref=` are attributed `utm_source=referral`, `utm_medium=social`,
   `utm_campaign=sheet` or `invite` so they appear beside social channels in the funnel and
   economics views with the same intervals. Mechanism: the shareable link is
   `/signup?ref=<code>&utm_source=referral&utm_medium=social&utm_campaign=<sheet|invite>` —
   `captureAttribution` already picks up utm_* client-side, so no server attribution change is
   needed; `attributeReferral` today writes only the `referrals` row, which is why ref signups
   currently read as `direct`. Add a "Referral" row to the channel table; do not build a new
   report.
5. **Abuse and cost controls.** Referral signups from the same device/IP burst are rate-limited with
   the existing limiter; credits stay capped per referrer (reuse PRD-112's cap or add one).

**Constraints**
- Trust tier: 0/1. Generating a sheet is read-only on the owner's own data and nothing is sent by
  LifeKeel; the owner sends it. Credits are internal app currency (precedent: `redeemPromoCode`).
  No external provider call, no message sent on the family's behalf.
- Regulated-advice check: the sheet and prompts only list what is on file and point to "a licensed
  professional" where relevant; no recommendations, no provider names beyond what the owner
  entered, no "you should switch". Prompt and sheet copy pass `checkCopy`/advice-rule.
- Data/privacy: the sheet contains the family's most sensitive content, which is why it is
  owner-generated, opt-in per section, file-based and never hosted. No telemetry carries sheet
  content. Children's data posture (intent 09) applies: no minors' details unless the owner ticks
  them. Events are anonymous enums.

**Out of scope** — a hosted/shared-by-URL sheet, email sending by LifeKeel, SMS, social "share to
feed" buttons with family content, rewards beyond PRD-112's, partner-account permission redesign,
public family profiles, referral leaderboards.

**Becomes** — amend PRD-110 and PRD-112 where they overlap; new docs/prd/220-emergency-sheet.md.

---

## Build spec

**Files likely touched**
- `apps/web`: new prompt component on the home/dashboard; new `app/family/sheet` page with section
  picker, print stylesheet, and a client-side PDF/print path (prefer browser print; avoid a PDF
  library unless one is already a dependency); referral share block (check Settings for the existing
  PRD-112 surface and reuse it).
- `apps/api/src/routes/emergency-sheet.ts`: `POST /family/emergency-sheet/preview` returns the
  structured sections for the chosen toggles (auth required, tenant-scoped, not stored, not logged
  beyond a non-content audit event "sheet_generated"). Reuse existing family/financial-profile
  readers; do not add new data stores.
- `apps/api/src/routes/growth-events.ts`: new event names; `routes/referrals.ts`: attribution
  fields on signup (`utm_*` set from `ref`), cap and rate limit check.
- Funnel/economics: map `utm_source=referral` into the channel registry/table.

**Tests (each must fail without the change)**
- Prompt: shows once per week, not after two dismissals, not when a second login exists.
- Sheet endpoint: a section left off is absent from the response; default response has no sections;
  another tenant's data never appears; response not cached (`Cache-Control: no-store`); no
  persistence (assert no insert); audit event has no content.
- Footer: referral link present by default, removable; copy passes `checkCopy`.
- Referral attribution: signup with `ref=` yields `utm_source=referral` and appears in funnel rows;
  cap and rate limit enforced; reward only on first meaningful action (PRD-112 behaviour unchanged).
- Events: new names accepted, free text in `meta` rejected or sanitised.
- Erasure: no new collection holds family content; if any is added, it is in the erasure catalogue.
- Web: prompt, picker, print view render; nothing sensitive in the DOM before toggles are chosen.

**Verification** — isolated stack: create a family with sample data, generate a sheet with one
section on, confirm only that section prints, copy the referral link, sign up a second tenant
through it, confirm attribution and (on first insight) credits. Look at the printed output.

**Open decisions for the owner** — whether the sheet may ever include balances (default: never
unless ticked per section); whether partner prompt should also fire after the sheet (default: yes).
Counsel should review the sheet wording once because it is the most family-sensitive artefact in
the marketing path.
