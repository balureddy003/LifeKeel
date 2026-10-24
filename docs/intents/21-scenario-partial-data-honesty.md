# Intent 21: Scenario partial-data honesty — no silent fallbacks

**Problem** — QA found What-If scenarios silently degrading: on incomplete or
extreme profile data the event page shows "Sample scenario — connect your
data for a real one" or "This event could not be found"
(`apps/web/src/app/events/[eventId]/EventDetailClient.tsx` ~lines 200, 343;
`e2e/events-readiness.spec.ts` currently *asserts* the sample text). The
critic review calls this the emotional core of the product failing exactly
when a stressed family with imperfect data needs it — a silent fallback
reads as broken, not as partial.

**Done looks like**
- A scenario always renders personalized math against whatever profile data
  exists, with a visible "Using the data you have so far — add X for a more
  accurate result" banner naming the missing inputs, instead of switching to
  sample copy.
- The runway number stays visible even when other sections degrade.
- "This event could not be found" appears only for genuinely unknown/deleted
  event ids and offers a way back to the events list — it is never used as a
  data-completeness fallback.
- The e2e assertion is updated to cover the partial-data state; a test
  asserts a thin-profile family gets personalized runway + banner, not
  sample content.

**Constraints**
- Trust tier: 0 — deterministic math on existing profile inputs.
- Regulated-advice check: the banner names missing data ("no partner income
  entered"), never prescribes outcomes.
- Data/privacy: none beyond existing profile scope.

**Out of scope** — new scenario types (PRD-132 covers multi-step); changing
the scenario math itself; the free-text narrative freshness (intent 22).

**Becomes** — PRD amending PRD-115/PRD-132's scenario surface contract.
