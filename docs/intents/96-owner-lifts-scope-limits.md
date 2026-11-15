# 96. Owner lifts four scope limits (2026-11-15)

Decision by the product owner, in chat, on 2026-11-15.

## Lifted (build now, one concern per PR)
- **MCP server.** Read-only. Exposes a household's own engine output to the signed-in adult's own AI client. Same visibility rule as the web route (`canSeeEngineOutput`: adults only, fails closed). No write tools, no actions.
- **Business graph.** A household member's business linked to the household shock model: if the business stops, the income it pays stops. Pure module first.
- **Second datastore.** Built as a storage port with a tenant-scoped adapter. A new database engine is infrastructure the owner has to choose, fund and deploy; the port means that choice does not change the engine code.

## Built gated off (flag defaults to off; nothing runs on real family data)
- **Cross-tenant learning.** CLAUDE.md rule 3 stays in force. The plumbing ships behind a flag that is off, with opt-in consent per household, a minimum cohort size, deletion on withdrawal, and a privacy-review reference required before the flag can be turned on.

## Not lifted
- **Naming or steering to a product (rule 2).** The owner chose "build gated off" for the two rule-bound items; for rule 2 there is nothing safe to gate, because arranging or advising on a product is a regulated activity in itself. It is not built. Reopen only with an FCA position on file.

## Unchanged
Tier 0 only, no autonomous action, merges and deploys stay with the owner.

## Addendum: what the gated cross-tenant plumbing is (and is not)
Built, off by default (`apps/api/src/learning/`, `routes/family-learning.ts`):
- **Gate:** opens only with `LIFEKEEL_CROSS_TENANT_LEARNING=true` AND a non-blank `LEARNING_PRIVACY_REVIEW_REF`. Otherwise the routes do not exist.
- **Consent:** every active adult in the household must opt in; any one adult withdrawing deletes the household's contribution at once.
- **What is shared:** one coarse band of months ("0-3", "3-6", "6-12", "12+"). No figures, no names. Stored with the household key only so withdrawal and erasure can delete it.
- **What is shown:** counts per band, only above a minimum cohort (`MIN_COHORT`, provisional 20) with cells under 5 hidden, and only to households that contribute.
- **Not a model.** Nothing is trained or fine-tuned, and no family content goes to any model. This is a count of bands.

Before the flag may be turned on (owner, procedural): privacy review recorded and its reference set; user-facing disclosure and a consent screen (not built); a decision on `MIN_COHORT`; a deletion check in the erasure tests against a real database.
