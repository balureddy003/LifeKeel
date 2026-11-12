# Cryptography policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-024 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Principal developer (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.8.24 (also A.5.17, A.8.10, A.8.13).

## Statements

1. **In transit:** TLS for every external connection; no plaintext protocols for family data.
2. **At rest:** sensitive fields and vault documents are encrypted with AES-256-GCM under a
   per-tenant data-encryption key (DEK); DEKs are wrapped by a versioned platform
   key-encryption key (KEK). Ciphertexts are self-describing so keys can rotate.
3. **Key custody:** KEKs and secrets live in the secret manager, never in source, logs or agent
   sessions. KEK custody in a KMS/HSM is the target state.
4. **Rotation:** KEK and DEK rotation follows `docs/runbooks/key-rotation.md`; rotate
   immediately on suspected exposure.
5. **Crypto-shredding:** deleting a tenant deletes its keys, making any surviving ciphertext
   unreadable.
6. **Backups** are encrypted with `age` before they touch disk; the identity is stored apart
   from the archives.
7. **Secrets in the database** (MFA secrets, reset tokens, OTP codes) are stored encrypted or
   as hashes/HMACs only.
8. Use only vetted libraries and standard algorithms; no home-grown cryptography.

## Enforced today

| Statement | Evidence |
|---|---|
| 2, 4 | `apps/api/src/crypto/envelope.ts`, `packages/platform/src/key-registry.ts`, `docs/runbooks/key-rotation.md` |
| 5 | `apps/api/src/erasure.ts` |
| 6 | `scripts/ops/backup.sh` (refuses to write unencrypted unless a local-drill flag is set) |
| 7 | `apps/api/src/auth/totp.ts`, `apps/api/src/auth/otp.ts` |

## Not yet in place

KMS/HSM custody for the KEK (A.8.24 gap in ISO_AUDITABLE.md §10.4); workload identity
(G-SEC-02).
