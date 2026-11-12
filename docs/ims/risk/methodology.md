# Risk assessment and treatment methodology

| Field | Value |
|---|---|
| Document ID | LK-IMS-030 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

One method serves ISO/IEC 27001 6.1.2/6.1.3, ISO/IEC 42001 6.1.2/6.1.3 and ISO 9001 6.1. It
follows ISO/IEC 27005 and ISO 31000; AI risk sources follow ISO/IEC 23894. Closes, with the
register and owner acceptance, **G-MGT-04**. Source: ISO_AUDITABLE.md §13.

Register: [`risk-register.yaml`](risk-register.yaml). AI system impact assessments
(42001 6.1.4) are separate records in [`../ai-impact/`](../ai-impact/) and feed AI risks here.

## 1. Process

1. **Establish context** — scope (`docs/ims/scope.md`), issues and interested parties
   (`docs/ims/context.md`), criteria and appetite (§3 below).
2. **Identify** — per asset class (ISO_AUDITABLE.md §8.2: C1–C4), per AI system
   (`definitions/ai-tasks.yaml`, `ai-bom.yaml`), per quality failure and legal requirement.
   Sources: threats, AI hazards (misuse, bias, opacity, data leakage, over-reliance), supplier
   failure, product rules 1–3 in CLAUDE.md.
3. **Analyse** — likelihood × impact taking existing controls into account; record the
   controls and the repository paths that implement them (`control_evidence`).
4. **Evaluate** — compare the score against the acceptance criteria.
5. **Treat** — choose an option: **modify** (add/improve controls), **avoid** (stop the
   activity), **share** (contract/insurance), **retain** (accept as is).
6. **Select controls** — map to ISO/IEC 27001 Annex A (`annex_a`) and ISO/IEC 42001 Annex A
   (`aims_controls`); confirm each is in the SoAs (`docs/ims/soa/`).
7. **Accept residual risk** — the owner with the authority in §3 records acceptance. Until
   then `acceptance: pending`. Nobody records an acceptance on another person's behalf.
8. **Monitor and review** — quarterly, and on any material change (new processor, model, data
   class, market, audience or autonomy level; a security incident; a §15 gap closing).

## 2. Scales

**Likelihood**

| Score | Label | Guide |
|:-:|---|---|
| 1 | Rare | Not expected in 5 years; requires several independent failures |
| 2 | Unlikely | Could occur in 2–5 years |
| 3 | Possible | Could occur within a year |
| 4 | Likely | Expected within a year; has happened in similar products |
| 5 | Almost certain | Expected within months or already observed |

**Impact** (take the highest dimension)

| Score | Families / people | Legal / regulatory | Financial | Operational / reputation |
|:-:|---|---|---|---|
| 1 | No noticeable effect | None | < £1k | Minutes of degradation |
| 2 | Minor inconvenience to one household | Minor breach, no report | £1k–£10k | Hours of degradation |
| 3 | Confidential data of one household exposed; wrong insight acted on | Reportable breach | £10k–£100k | Day outage; local press |
| 4 | Many households exposed; a child's data exposed; regulated advice given | Regulator investigation; perimeter breach | £100k–£1m | Multi-day outage; national press |
| 5 | Cross-tenant mass exposure; irreversible action without consent | Enforcement, licence-type breach | > £1m | Existential |

**Score = likelihood × impact** → Low (1–4), Medium (5–9), High (10–16), Critical (20–25).
(No product of two 1–5 integers falls between 17 and 19.)

## 3. Acceptance criteria and risk appetite (proposed for approval)

| Level | Who may accept | Condition |
|---|---|---|
| Low | Risk owner | Record in the register |
| Medium | IMS manager | With a treatment plan |
| High | CEO | Treatment within 90 days |
| Critical | Nobody | Treat or avoid |

**Override:** any impact-5 event touching CLAUDE.md rules 1–3 or children is treated
regardless of likelihood (for example R-AI-16, R-AI-02, R-PRIV-02).

## 4. Register fields

| Field | Meaning |
|---|---|
| `id` | Stable ID: `R-<category>-NN` |
| `assets` / `ai_systems` | Assets affected; AI task ids from `definitions/ai-tasks.yaml` |
| `likelihood`, `impact`, `score`, `level` | Per §2; `score` must equal `likelihood × impact` (checked in CI) |
| `existing_controls`, `control_evidence` | Controls in place and repository paths implementing them (paths checked in CI) |
| `treatment` | `option` (modify/avoid/share/retain) and `plan` |
| `annex_a`, `aims_controls` | Linked SoA controls |
| `linked_gaps` | G-IDs in `docs/ims/gap-register.yaml` |
| `owner_role` | Risk owner role (names in `docs/ims/roles.md` once appointed) |
| `acceptance` | `pending` until the authorised person accepts; then the acceptance record reference |

## 5. Records

The register's git history is the record of assessment results (27001/42001 8.2) and treatment
results (8.3). Acceptance decisions are recorded with the approver role, date and reference in
the register once made, and minuted at management review.
