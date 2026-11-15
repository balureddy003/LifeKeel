# Intent 95: Splitting a household account (spec only, not built)

Status: design for the safeguarding review. Owner decision 2026-11-15: there must be a way to split the
account when adults part, and either adult can start it with the other told. Everything else below is a
proposed default for review, not a decision. Tier 0 until built; the split itself moves no money and sends
nothing external beyond an in-product notice and the existing family email.

## Why
An adult who is leaving, or in a dispute, must not keep a live view of the other adult's figures (A5, H23,
H25, H26), and neither should be trapped in a shared view they cannot leave.

## Proposed behaviour
1. **Start.** Either active adult can start a split. The other adult is told in the product and by email that
   a split was started and by whom. The notice says what changes, not why.
2. **Pending state.** From the start, the engine stops showing each adult the other's individual figures
   (income, protection, cover). Household figures both already see (savings, spend) stay visible until the
   split completes. Nothing is deleted yet.
3. **Complete.** Two households exist. Each adult keeps their own figures. Shared household figures are copied
   to both as of the split date and then diverge. Confirmed facts from before the split are copied only for
   figures that adult entered or both confirmed; nothing the other adult alone entered is copied.
4. **Undo.** Only before completion, by the adult who started it. After completion, nothing is merged back
   automatically; re-joining is a normal invite.
5. **Children's records.** Not decided here. Default is that they stay with the original household and are
   not copied, because custody arrangements need a human decision. Safeguarding review to settle.
6. **Vault, documents, policies.** Out of this spec; each needs its own ownership rule.
7. **Erasure.** Each resulting household deletes independently; the split creates no shared copy.

## Not decided (needs the review)
Whether the other adult may block a split; what happens when only one adult has an account; protected-person
cases where telling the other adult is itself unsafe (the notice may need to be suppressible); children;
retention of the pre-split audit trail.

## Done looks like (when built)
Tests that: an adult never sees the other's individual figures after a split is started; a copied household
contains nothing only the other adult entered; undo works only before completion and only for the starter;
each household erases independently; the notice never contains a figure.
