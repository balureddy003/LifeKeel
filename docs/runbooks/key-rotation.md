# Key rotation runbook — KEK and per-tenant DEKs

Two layers exist (B4):

- **KEK** — the platform key-encryption key, resolved by
  `ENCRYPTION_KEY_V{n}` env vars (`packages/platform/src/key-registry.ts`).
  It wraps tenant DEKs and still decrypts legacy `v{n}:iv:tag:ct`
  ciphertexts written before envelope encryption.
- **Tenant DEKs** — one AES-256-GCM key per tenant in `tenant_keys`,
  wrapped by the KEK (`dek_wrapped`). Ciphertexts are self-describing:
  `dek:{key_id}:{iv}:{tag}:{ct}` for strings, `[0xDE][key_id][iv][tag][ct]`
  for vault document buffers.

## Rotate a tenant's DEK

```ts
import { rotateTenantDek } from '../crypto/envelope.js'
await rotateTenantDek(db, tenantId)   // mints active key, retires the rest
```

Old ciphertexts keep decrypting — `key_id` resolves to the retired doc.
Re-encryption is lazy: a value is rewritten under the new DEK the next
time it is saved. There is no eager re-encrypt sweep yet; run one
manually only if a DEK itself is suspected compromised.

## Rotate the KEK

1. Generate: `openssl rand -hex 32`.
2. Set `ENCRYPTION_KEY_V{n+1}` and `ENCRYPTION_KEY_CURRENT_VERSION={n+1}`,
   keeping all prior `ENCRYPTION_KEY_V{n}` vars — old wrapped DEKs and
   legacy ciphertexts still resolve their version.
3. Deploy. New wraps/ciphertexts use the new KEK automatically.
4. To re-wrap existing `dek_wrapped` values under the new KEK, run a
   one-off script: `decryptField(dek_wrapped)` → `encryptField(hex)` per
   `tenant_keys` row. Not urgent — wrapped DEKs under old KEK versions
   still decrypt while the old env var stays set.
5. Remove old `ENCRYPTION_KEY_V{n}` vars only after every wrapped DEK and
   legacy ciphertext has been re-wrapped/migrated — removing one early
   makes its ciphertexts permanently undecryptable (fail-closed by
   design; the registry errors rather than silently trying the wrong key).

## Compromise recovery

- **Tenant DEK suspected:** `rotateTenantDek`, then re-save the tenant's
  credential documents (connector credentials, email connector, social
  connections) so ciphertexts re-encrypt under the new key; finally
  `cryptoShredTenantKeys` is NOT the answer here — shredding kills the
  retired key's ciphertexts too. Instead delete the retired key doc by
  `key_id` only after all ciphertexts are re-written.
- **KEK suspected:** rotate KEK per above, then rotate every tenant DEK
  (re-wrap covers it), then rotate all `dek:` ciphertexts by re-saving
  credentials. Schedule as an incident drill.

## Crypto-shredding and erasure

`eraseTenantData` wipes `tenant_keys` — the crypto-shred that makes all
`dek:` ciphertexts for the tenant undecryptable even if a blob survives
somewhere. Caveat: **not backup-retroactive** — a backup taken before
the shred still contains the DEK. The effective deletion SLA for
envelope-encrypted data is bounded by backup retention until per-backup
key exclusion exists.

## Restore testing

`scripts/ops/restore-drill.ts` restores from backup and replays erasures.
`tenant_keys` restores with the rest of the database, so vault/credential
decryption works post-restore for live tenants — and correctly fails for
erased ones (their key docs were shredded and the replay re-wipes them).
