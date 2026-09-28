# PRD-134 — Client-side sealing for vault documents

## The decision
The audit asked whether the vision's "client-side encrypted" requires
zero-knowledge. Full per-user ZK was rejected: the vault's job is family
access *in a crisis* — precisely when the person holding a private key may
be unavailable. A "forgot passphrase → estate documents gone forever"
vault is actively harmful to the product's purpose. What shipped instead
is the honest middle: **opt-in per-document sealing under a shared family
passphrase**.

## What landed
- `apps/web/src/lib/vault-seal.ts` — PBKDF2 (310k iterations, per-doc
  random salt) → AES-256-GCM. Envelope: `[salt][iv][ciphertext+tag]`.
- Upload: optional "Seal with a passphrase" checkbox + double-entry.
  The browser seals the file; the server stores the opaque envelope,
  *also* wrapped in its existing `encryptBuffer` layer (double-encrypted
  at rest).
- Download: server unwraps its layer, returns the sealed envelope; the
  browser unseals. No new server code path — `decryptBuffer` round-trips
  whatever was uploaded.
- Server accepts `?sealed=1&mime=<declared>` on upload; the MIME allowlist
  applies to the *declared* type since the blob is opaque. `sealed: true`
  is stored + listed.
- UI: "Sealed" badge + lock icon; opening a sealed doc prompts for the
  passphrase; wrong passphrase surfaces the GCM auth-tag failure as
  "that passphrase doesn't open this document."

## Honest limits (stated in the UI too)
- **No recovery.** Forget the passphrase → the document is unreadable.
  The copy says this plainly at upload time.
- **Metadata is not sealed.** Filename, doc_type, size, and upload date
  stay server-visible — the estate detector needs `doc_type`, and the
  list needs a name.
- **Shared-passphrase model.** Any family adult with the passphrase can
  open the doc — by design, matching how families actually handle estate
  access. Passphrase distribution is out of band (the app doesn't store
  or transmit it).

## Tests
- `vault-seal.test.ts` — round-trip, wrong-passphrase rejection via GCM
  tag, damaged envelope, random-salt uniqueness, no plaintext leakage.
- `vault.test.ts` — sealed upload stores the flag + declared mime, the
  declared-mime allowlist still applies, and download returns the
  envelope byte-for-byte.
