# Intent 32: Retirement "what would close the gap" estimate

**Problem** — The critic review found retirement projection language present
but "not actionable enough": a pre-retiree sees a projected corpus and a gap
number but no sense of what changes it. A "what would close the gap"
affordance (contribution slider or similar, plainly labelled an estimate)
is the medium-term suggestion worth triaging.

**Done looks like**
- On the retirement surface, an interactive estimate: adjusting monthly
  contribution or retirement age re-projects the corpus using the existing
  `projectRetirement` math — clearly labelled "estimate, based on the
  figures you entered".
- Copy describes arithmetic on the family's own inputs ("at £X more per
  month the projected gap closes") — never "increase contributions to
  product Y", never a provider or fund name.
- The estimate is visually distinct from the recorded profile values; no
  input here mutates the profile without an explicit save.
- Copy passes `advice-rule.test.ts`; a test asserts the estimate reacts to
  slider input against the deterministic projection.

**Constraints**
- Trust tier: 0 — arithmetic on existing profile data; the slider writes
  nothing.
- Regulated-advice check: this is the intent most likely to brush against
  rule 2. "What would close the gap" stays informational about *amounts and
  timing*; it must not become a recommendation of a pension product,
  contribution level as advice, or a steer toward any provider. Wording
  needs the same care as detector `reasoning_template` copy, plus the
  estimate disclaimer.
- Data/privacy: none new.

**Out of scope** — product/provider comparison (permanently out per rule 2),
persisting hypothetical scenarios (that's the PRD-115 scenario
infrastructure if ever wanted), actuarial-grade projection changes.

**Becomes** — PRD in docs/prd/, extending the retirement readiness surface.
