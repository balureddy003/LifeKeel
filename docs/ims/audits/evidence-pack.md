# Evidence pack procedure

| Field | Value |
|---|---|
| Document ID | LK-IMS-082 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Principal developer (role) |
| Approver | IMS manager (role) |
| Approved | — |
| Next review | — |

`scripts/ims/evidence-pack.sh` exports, read-only, the GitHub configuration and change
records the audit programme samples. It covers branch protection, rulesets, environment
protection, collaborators (the access review), deployments, Dependabot alerts, the last N
merged PRs with reviews and checks, deploy runs, and the signature status of the last 100
commits on the default branch. It writes a sha256 `MANIFEST.txt` so the pack can be shown
to be unaltered after collection.

## When

- Monthly, before the KPI review (O7, O10).
- Before each internal audit (IA-3, IA-5) and before Stage 1 and Stage 2.
- After any change to repository or environment settings.

## How

```bash
scripts/ims/evidence-pack.sh <out_dir> 10
```

The output names people (collaborators, PR authors). Store it with audit records,
**outside this repository**. A permission the token lacks is written to `<file>.err`
instead of failing the run. A missing setting is itself evidence.

## Reading the result

| File | Conforming looks like |
|---|---|
| `branch-protection.json` / `rulesets.json` | an active rule on the default branch requiring a review and the CI checks |
| `environments.json` | `Production` has required reviewers |
| `merged-prs.json` | `reviewDecision: APPROVED` and passing checks on every sampled PR |
| `signed-commits-summary.txt` | no `N` (unsigned) entries after the date signing was required |
| `collaborators.json` | each login maps to a named role in `docs/ims/roles.md`; no leavers |

Anything that does not conform becomes an entry in `docs/ims/nc-log.yaml`.
The first run (2026-11-12) produced NC-2026-005 to NC-2026-007.
