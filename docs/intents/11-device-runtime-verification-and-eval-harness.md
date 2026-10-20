# Intent: on-device runtime verification + weakest-runtime eval harness

**Problem** — the device tier ships untested on real hardware. The Capgo
native adapter is verified only against *documented* API shapes
(`getReadiness` values, `textFromAi`/`aiFinished` payloads, `createChat`
session semantics) — never executed on an iPhone or Pixel. The eval gate
(`on-device-evals.ts`) runs the deterministic floor and adversarial guard
recall in CI, but `runDeviceDraftEvals` has only ever run against mock
providers; the blueprint's rule — "a task ships on-device only after its
eval passes on the **weakest supported runtime**" — is unimplemented for
want of a harness that drives real runtimes. Three concrete things need
device truth: (a) the Capgo session protocol actually fires the events the
adapter waits on, (b) `getReadiness` returns `'ready'` (not e.g.
`'available'`) so the tier activates at all, (c) a 1B WebLLM model in a
mobile WebGPU context produces draft output that passes the eval, not just
a vitest mock of it.

**Done looks like**
- A repeatable eval harness — a hidden dev route (e.g.
  `/dev/device-eval`, gated behind a dev/feature flag, never linked in
  prod nav) that runs `runDeviceDraftEvals` + `runGuardRejectionEvals` +
  `runFloorEvals` against the *real* `generateDraftOnDevice` and renders
  the verdict JSON for copy-out. Manual driving is acceptable and honest:
  the deliverable is verdicts, not a CI bot.
- A recorded **per-runtime matrix** in
  `docs/reviews/device-eval-results-*.md`: each tier's pass/fail, plus
  observed `getReadiness` value strings, latency, and load size actually
  seen on hardware — those observed values get written back into the
  adapter if they differ from vendor docs.
- Pass/fail thresholds a runtime must hit before the draft task may claim
  it as supported:
  - Floor: 100% (deterministic template is guard-clean — already CI-gated)
  - Adversarial recall: 100% rejection + negative-control acceptance
    (already CI-gated — rerun on-device to catch renderer differences)
  - Golden draft eval: `runDeviceDraftEvals` verdict `pass === true`
    against the real provider — generated/complete thresholds as defined
    in `on-device-evals.ts`
  - A runtime that fails is *not shipped* for the task — the tier simply
    reports unavailable and the deterministic fallback covers it.
- Device targets, minimum viable coverage:
  - iOS: iPhone 15 Pro or later on iOS 26 with Apple Intelligence enabled
    (CapgoLLM Apple Intelligence path)
  - Android: Pixel 9+ with Gemini Nano via AICore (CapgoLLM Gemini Nano
    path); a non-Nano Android validates the `.litertlm` fallback or the
    tier correctly reporting unavailable
  - Desktop: Chrome with `LanguageModel` available (Gemini Nano Prompt
    API), and any WebGPU browser for the WebLLM tier
- Every run is opt-in and user-consented — model downloads are never
  triggered inside an eval run the same way they aren't in a Draft click.

**Constraints**
- Trust tier touched: 0–1 (drafting only; human review before send,
  unchanged); approval gate: none new.
- Regulated-advice check: none — the eval corpus is fixed strings, no new
  output paths.
- Data/privacy limits: the eval corpus contains no real family data;
  verdicts are metadata-only (same rule as `prepare-on-device` pings —
  outcomes and timings, never content).
- Hardware: requires actual devices (or a device-farm slot) — this is the
  hard dependency the code can't fake. iOS simulator counts for
  CapgoLLM *if* the host Mac supports Apple Intelligence; Android
  emulator does **not** count (Gemini Nano needs physical hardware).

**Out of scope** — extending on-device tasks beyond contact-step drafts
(this harness is the gate *for* that, not the thing itself); the real
Layer-B NER classifier eval set; scanned-PDF client rasterization;
shipping the harness in the prod build (it stays dev-gated).

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
