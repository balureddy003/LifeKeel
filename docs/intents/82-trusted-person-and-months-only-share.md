# Intent 82: A trusted person, and sharing the months without the figures

**Problem** — The brief assumes a second adult in the household. About one family in
six is a lone-parent family (ONS counted 3.0 million, 15.4% of families, in 2021), and
those parents have no one to confirm the numbers or hold the handover facts. Separately,
a partner may be willing to see the runway but not the underlying income and spending.
Both fixes change who sees what, and Surviving Economic Abuse research shows that
monitoring a partner's money through apps is a common control tactic (about 1 in 22 UK
adults report a partner or ex-partner controlling or trying to control their bank
account). A confirmed-open receipt that tells the creator exactly when someone looked
can be misused in the same way.

**Done looks like**
- **Just me path:** onboarding offers "just me" with no second adult required. A lone
  parent can nominate a trusted person such as a parent, sibling or friend.
- **Trusted person confirms with a one-time link,** needs no account, sees only the
  scope the household chose, and can print or save a PDF of the same result.
- **Months-only share:** a share mode that shows the runway, the dated change and the
  handover items the household chose, without showing income, spending or savings.
- **The recipient controls the share:** they can decline, leave or stop a share at any
  time. Declining or leaving sends no notice to the creator. The creator sees
  "confirmed" only when the recipient chooses to confirm, and no screen ever shows
  "has not opened" or when someone looked.
- **No brief about another adult's money without that adult:** figures for another
  adult's income come from that adult, or are entered by the creator and marked as
  the creator's own estimate, never as that adult's confirmed figures.
- A trusted person cannot be added to a brief by anyone other than its creator, and a
  household adult cannot be silently replaced as the designated adult.
- A **safeguarding review** by a qualified reviewer is recorded before this ships.
- Tests cover scope limits, one-time link expiry and reuse, decline and leave with no
  creator notification, months-only payload (no figures anywhere in the response),
  and the print/PDF output.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; creator-initiated shares
  only, nothing sent by LifeKeel.
- Regulated-advice check: share and decline copy is fixed factual text and passes
  `advice-rule.test.ts`.
- Data/privacy limits: DPIA updated for third-party recipients; recipient data is the
  minimum needed (a name or label and a link, no account); sensitive handover facts
  are shown to a trusted person only if the creator explicitly includes them and
  consent is recorded (Intent 79).

**Out of scope** — Separation, child-maintenance and any co-parenting briefs (parked
pending the safeguarding review), joint-account visibility, bank or pension feeds, and
reminders to the trusted person.

**Becomes** — [docs/prd/229-trusted-person-and-months-only-share.md](../prd/229-trusted-person-and-months-only-share.md)
