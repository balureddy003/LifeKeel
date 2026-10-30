# Intent 83: A friction budget, and first value that needs no connection

**Problem** — LifeKeel's direction is a frictionless, high-value platform, but nothing
in the roadmap measures friction. Gates count sign-ups and "finished setup", which are
effort measures in disguise. The household brief already shows the better pattern: a
real number from three figures, with no inbox, bank or upload. The go-to-market channels
(advisers, employers, invites) still start from "connect something", so the people who
could bring the most households meet the most effort first. The second adult is the
other friction point: a partner who must join and set up before seeing anything does not
come back.

**Done looks like**
- **A friction budget is written down and measured** for the first-value path: time from
  landing to the first useful number, fields asked before it, screens before it, and
  whether any account, connection or upload was required. Targets are proposed in
  PRD-230 and baselined before they are enforced.
- **First value never depends on a connection.** A brief gives a useful number from
  today's figures and a date alone (partial answers already ship); inbox, bank and
  document features add to the same number and are never a prerequisite for it.
- **The brief link is the front door for every channel.** An adviser, an employer or a
  household member can send a link that opens a real result with no sign-up. Joining
  comes after seeing the result.
- **The second adult reads first, joins later.** The recipient sees the exact version,
  confirms in one named action, and is asked to join only afterwards.
- **Every screen asks for one thing,** and no screen asks for something the household
  has already entered.
- **Roadmap gates use friction and value numbers,** not "finished setup": time to first
  number, share of households whose second adult confirms, and a value ledger that keeps
  "found" apart from "confirmed saved".

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; nothing is sent or done on
  the household's behalf. Approval gate: none needed.
- Regulated-advice check: adviser and employer links carry LifeKeel's factual numbers
  only. Nothing in the link, page or message names a product, provider or action to take,
  and no channel is paid per placement or switch (`advice-rule.test.ts` covers the copy).
- Data/privacy limits: telemetry for the budget is counts and timings only, with no
  figures or content; recipient pages follow Intent 82 (no creator-visible "not opened"
  state). Rule 3: no family content leaves the tenant for any of this.

**Out of scope** — Account-free storage of a household's record, open-banking or inbox
feeds (Stage 3), any pricing change, partner-portal tooling, and any adviser feature that
reads a client's figures (Stage 4 grants only).

**Becomes** — [docs/prd/230-friction-budget-and-zero-connection-first-value.md](../prd/230-friction-budget-and-zero-connection-first-value.md)
