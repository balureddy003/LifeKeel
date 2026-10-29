# Intent 79: Sensitive brief facts are encrypted, and secrets are discouraged

**Problem** — Intent 78 shipped handover briefs that hold health and care
details (GP, allergies, medications, agreed care notes) as free-text `facts` on
`household_briefs`. The `sensitive` flag and consent check exist, but a review of
`apps/api/src/briefs/briefs.ts` and `apps/api/src/routes/family-briefs.ts` found
no field-level encryption of those facts, although the repo already has a
per-tenant envelope module (`apps/api/src/crypto/envelope.ts`). The same fields
accept any text up to 2,000 characters, so a household can type a password or
recovery code into "location of recovery methods". Both are privacy risks for
the families this product is for.

**Done looks like**
- For catalogue entries marked `sensitive`, the stored `facts` and any derived
  fact text are encrypted with the tenant key; the stored document contains
  ciphertext, and a test fails if plaintext health content appears in
  `household_briefs`.
- Decryption happens only on the two permitted reads (the creator and the
  designated adult), after the existing participant checks.
- Sensitive content never appears in logs, `system_events`, queue payloads,
  telemetry or erasure-export previews as plaintext; the erasure and account
  export paths still include these briefs and still work.
- Free-text handover fields show a visible hint ("record where it is, never the
  password or code"). Input that looks like a credential (a "password:" prefix, or
  a long mixed-character token) is rejected with a plain message, not silently
  stored. The check is deterministic; no model sees the content.
- Existing sensitive briefs are migrated by a one-off script that re-writes them
  encrypted and is safe to re-run. The script logs runs without plaintext, and a
  rollback is tested.
- A data protection impact assessment is completed before this reaches production.
  It records the lawful basis and the condition for special-category data, and
  covers the third parties named in a brief (a parent receiving care, a person who
  has died), who have not consented.
- A stated retention period applies to handover facts: deleted on request by the
  creator or the designated adult, and expired after a period the DPIA sets.
- An access log (content-free) shows the creator who viewed a sensitive brief and
  when, so a family can see that only the two permitted people did.
- The credential-shape check is a guard rail, not a control. It will miss
  passphrases and may flag ordinary numbers, so the UI hint stays beside the field
  and no claim of "secrets are blocked" is made in copy or docs.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; no external action.
- Regulated-advice check: no new user-facing copy beyond field hints and the
  rejection message; neither recommends anything.
- Data/privacy limits: health data is special-category data under UK GDPR;
  explicit permission, creator-only deletion and revocation (Intent 78) stay.
  `CLAUDE.md` rule 3: no model call on this content, unchanged.

**Out of scope** — Changing which handover fields exist, new handover entries,
client-side (end-to-end) encryption, and scanning uploaded documents.

**Becomes** — [docs/prd/227-brief-catalogue-expansion-and-engine-hardening.md](../prd/227-brief-catalogue-expansion-and-engine-hardening.md) (Part A)
