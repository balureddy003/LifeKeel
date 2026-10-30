# Intent 85: What stops if one adult is out

**Problem** — Households know what they own but not who holds each thread: whose name a
policy is in, whose card pays, whose phone receives the codes and renewal notices. The
useful question is "if one adult is out for six weeks, what stops, and when?" The
competitor scan (marketing pages only, not a teardown) showed vaults and document
stores, not this question. Confirm in a teardown before claiming a gap in public.

**Done looks like**
- A map with one row per recurring obligation or account the household has told LifeKeel
  about: who is named, who pays, whose phone or email receives notices, the next due date,
  and what happens if that person is unavailable, **as a date**, e.g. "next payment due
  14 Dec; paid from a card in Sam's name".
- Facts are entered by the household or confirmed after extraction. A person's name on a
  row is the household's own entry; another adult's entries are marked as the creator's
  estimate until that adult confirms (Intent 82 rule).
- A single summary line: the number of obligations that depend on one person and the
  earliest date one of them comes due. Counts and dates only; no scoring of a person.
- The map reuses the handover facts already in the brief catalogue (who to call, key
  papers) and adds nothing that requires a connection to produce its first view.
- Printable view for a trusted person, within Intent 82's scope rules.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; informational.
- Regulated-advice check: shows who is named and what is due. Never "add a second payer",
  never a product or provider suggestion. Copy fixed and factual; passes
  `advice-rule.test.ts`.
- Data/privacy limits: handover facts follow Intent 79 (sensitive facts encrypted, no
  password-shaped input, nothing in logs or telemetry). The map must not become a way for
  one adult to monitor another: no "last active" or "last seen" data, no activity of a
  named person; the safeguarding review from Intent 82 applies before sharing beyond the
  household's own adults.
- Friction: user-entered first, feed-assisted later (PRD-230 item 9).

**Out of scope** — Joint-account visibility, bank or card feeds, changing who pays,
reminders sent by LifeKeel, and any inference about a person's behaviour.

**Becomes** — PRD number once accepted: docs/prd/NNN-household-single-point-of-failure-map.md
