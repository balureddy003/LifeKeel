# Intent 89: Holding a parent's file, with the parent's consent

**Problem** — Adult children often need a parent's papers, contacts and power-of-attorney
status before they have any legal authority. In England and Wales a lasting power of
attorney must be registered with the Office of the Public Guardian before it can be used,
registration can take weeks, and banks run their own separate process; Scotland has a
separate system
([gov.uk guidance](https://gov.uk/government/publications/how-to-be-an-attorney/how-to-be-an-attorney-property-and-financial-decisions),
[bank guidance](https://assets.publishing.service.gov.uk/media/681e023dced319d02c90607f/guidance-for-people-wanting-to-manage-a-bank-account-for-someone-else.pdf),
[Financial Ombudsman case](https://financial-ombudsman.org.uk/decisions-case-studies/case-studies/unregistered-enduring-power-attorney-causes-problems)).
Processing times in sources are dated; check gov.uk before quoting any figure. Finding a
parent's papers is the pain; a store for them is easy to build and easy to misuse.

**Done looks like (design only until the blockers clear)**
- A parent invites an adult child to hold a defined **scope** of their file (key papers
  location, contacts, whether an LPA exists and its registration status as the parent
  states it). The parent consents in their own session; the consent is recorded, can be
  narrowed or withdrawn at any time, and withdrawal sends no notice to the child beyond
  the access ending.
- The child sees only the chosen scope, with the parent's own words and dates. LifeKeel
  never states that the child has legal authority; it states what the parent recorded.
- The file works for a parent who is not a LifeKeel user via a one-time link, within the
  Intent 82 trusted-person model.
- No figures are shown unless the parent includes them.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**.
- Regulated-advice check: informational; never advises on making or registering an LPA
  beyond pointing to the official gov.uk page.
- Data/privacy limits: an older person's data and consent are the highest-risk part of
  this feature (coercion, capacity). **Blocked** until the safeguarding review for
  Intent 82 / PRD-229 is recorded and extended to this case, and until counsel has
  reviewed capacity and consent wording. DPIA update. Rule 3 applies.
- Friction: high by nature (needs another person's consent). Not part of the front door.

**Out of scope** — Acting for the parent, bank access, any monitoring of the parent, and
managing their money.

**Becomes** — **Blocked** on PRD-229's safeguarding review. PRD number once unblocked:
docs/prd/NNN-parent-mode.md
