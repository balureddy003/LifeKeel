# Intent 78: Factual household briefs, with two adult confirmations

**Problem** — The Stage 1 briefs do not cover the household's dated income,
cost and practical handover needs. An anonymous open is not evidence that two
adults saw the same facts, and live handover reads can change a shared result.

**Authorization** — The user approved the catalogue after the implementation
review and explicitly requested end-to-end implementation. This supersedes the
Stage 2 problem-pack implementation gate for this scope; feeds, employer seats
and the external read API remain out of scope.

**Done looks like**
- All supplied money/income and child-phase cases map to deterministic dated
  income, expense and cash changes. Continuing income is retained; entered
  cover waiting periods and end dates are represented explicitly.
- Practical handovers work without financial inputs. Facts are entered by the
  household, labelled as entered, and snapshotted with the result.
- Both the creator and the intended active adult explicitly acknowledge the
  same result hash, after viewing it. Anonymous opens never count. New share
  payloads require the intended participant's household session.
- Creating a revised brief produces a new snapshot and new acknowledgements.
  Profile edits only flag an old snapshot as potentially out of date.
- Default output is fixed factual text, with no recommendation or model call.
  Catalogue handover content cannot be sent to optional narration.
- Regression tests cover calculations, participant/tenant/minor boundaries,
  immutable facts, confirmations, revocation, and the browser journey.

**Constraints**
- Tier 0: calculation and manual records only. Sharing is explicitly initiated
  by the creator; LifeKeel sends no messages or executes external actions.
- No product selection, recommendation, retirement withdrawal assumption or
  inferred cost. Unknown facts remain unknown.
- Health details are optional manual entries, require explicit permission to
  record/share, and are accessible only to the creator and designated adult.
  No health extraction, models, marketing, queue payloads or content telemetry.
  Record locations for credentials/access codes, never their secret values.
- Existing billing entitlement gates remain; deletion and revocation are
  available to the creator.

**Out of scope** — Bank/pension feeds, diagnosis, clinical care plans, provider
recommendations, autonomous reminders or actions.

**Becomes** — Implementation amendment to PRD-222 and PRD-223.
