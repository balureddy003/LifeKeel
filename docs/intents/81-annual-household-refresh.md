# Intent 81: The yearly "if one of us stopped" refresh

**Problem** — The paid step is "keeping the record current", but a household that
has made one brief has no reason to return until another life event arrives, which
is rare. Without a recurring reason to reopen the record, the second-brief gate is
the only conversion moment and retention depends on luck.

**Done looks like**
- Once a household has a confirmed brief, it can start a **refresh**: the same
  brief re-created with last time's entered figures prefilled, every field
  editable, and a new calculation date.
- The refresh produces a new immutable snapshot and new acknowledgements from both
  adults (Intent 78); the old snapshot stays viewable and is labelled as earlier.
- A household-entered review date ("revisit on") on a brief produces an in-app
  prompt when it falls due. LifeKeel sends no message and takes no action on the
  family's behalf; the prompt appears when they open the app.
- The refresh is part of the paid household record. The first refresh path is
  instrumented (`brief_refresh_started`, `brief_refresh_confirmed`) so the
  retention hypothesis can be read from real use.
- The prompt and refresh copy are fixed factual text and pass `advice-rule.test.ts`.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; nothing is sent or
  executed; the date is household-entered.
- Regulated-advice check: the prompt says a date has arrived and figures may have
  changed; it never says what to do with money or cover.
- Data/privacy limits: sensitive handover facts are carried into a refresh only
  with fresh consent and stay encrypted (Intent 79); no model sees refresh content.

**Out of scope** — Email, SMS or push reminders (they would need a sending channel
and its own review), automatic recomputation from feeds, and any model-written
summary of what changed.

**Reminders: a deliberate decision, with a revisit criterion.** Competing vaults
send expiry reminders, and an in-app prompt reaches only people who already come
back. We keep reminders out for now because they add a sending channel and a
review. Revisit in a separate PRD if refresh instrumentation shows that fewer than
the agreed share of due prompts lead to a started refresh. Any later reminder would
be a single optional message that the household turned on, reviewed under the
advice and privacy rules.

**Becomes** — [docs/prd/228-annual-household-refresh.md](../prd/228-annual-household-refresh.md)
