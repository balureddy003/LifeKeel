# Resilience engine: ingestion note (B6)

Decision (owner, 2026-11-14): documents may come in by upload or from a connected mailbox, either. This note
fixes what does not change with that choice. It is a design note, not legal advice, and no mailbox
ingestion is built by it.

1. **Same path for both.** Whatever arrives is parsed locally first, then extracted against a fixed schema per
   document type (payslip, mortgage statement, home and car insurance schedule, life policy, pension
   statement, council tax bill, tenancy, energy bill, bank statement). Anything outside the schema is dropped,
   not stored.
2. **Models only through the gateway.** Any extraction model call is a registered task in
   `definitions/ai-tasks.yaml` with `allowed_processors` limited to approved ones (intent 93 A2). Document
   text is data, never instructions.
3. **Mailbox adds consent, not exemptions.** Connecting a mailbox needs the user's explicit consent screen and
   a read scope as narrow as the provider allows. Mail is read only to find the document types above.
4. **Gmail Limited Use.** Anything derived from Gmail is excluded from any cross-tenant scorer or learning
   (CLAUDE.md rule 3 and intent 93 A3) and is never used to train a model. This is procedural and is stated
   on the consent screen; code alone does not enforce it.
5. **Health-bearing fields.** A policy schedule can carry health detail. Those fields are not kept: the engine's
   fact store accepts only allow-listed money figures (`fact-store.ts`). Anything else is held in the existing
   documents store with its envelope encryption and retention, not in the engine.
6. **Every extracted figure is confirmed by a person** before it becomes a fact (blueprint: assume every
   extraction contains an error). Mechanical checks run first (ledger row R9).
7. **Erasure.** Account deletion removes facts and extractions (both are in the wipe), and nothing derived
   outlives the source.

Open for the owner: the exact consent wording, and whether a mailbox connector is built before upload (the
loop builds neither).
