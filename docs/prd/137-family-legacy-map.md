# PRD-137: Family Legacy Map — wills, authority documents, inherited & ancestral property

## The problem

Oak's estate coverage today is two booleans: does the vault contain a
document tagged `will`, and one tagged `power_of_attorney`
(`detectors/family/estate-readiness.yaml`, driven by `doc_type` on vault
uploads). The assets register (PRD-135) knows a property's name and
declared value and nothing else. Neither knows **who** a document covers,
**who** is named in it, **when** it was last reviewed, **where** the
original is, or how a property came to be owned, by whom, in what
proportion, in which jurisdiction.

For most families the hardest continuity failure isn't "no will" — it's
"there is a will, but it predates the second child, names an executor
who has died, and doesn't mention the land that passed down informally
from a grandparent that two cousins also believe they own." That is
exactly the knowledge that lives in one person's head and is lost with
them. No competitor found models it: Trustworthy stores documents,
Everplans/Cake do end-of-life forms, Empathy picks up *after* the death.

Who it's for: adult members, with the organizer controlling access; a
future executor/trustee/guardian role for named non-members.

Trust tier: **Tier 0** for the register, detectors and rehearsal. Access
grants to non-members are **Tier 2** (approve-gated, audited). Any
*release* of a document on a trigger is explicitly **out of scope** — see
ARCHITECTURE.md's note on time-delayed release as the highest-stakes
action in the product.

## Regulatory line (CLAUDE.md second rule)

Oak records what the family *declares*, links it to evidence, and flags
*gaps and staleness*. It never: states a document is legally valid,
determines who legally owns a property, computes inheritance or
succession outcomes, or drafts a legal instrument. Every legacy
insight's `actions` end at "consult a solicitor / notary / local
professional." Every record carries a **verification label** so the UI
can never present a family belief as a legal fact.

## What "done" looks like

1. An adult can record, per person, each estate/authority document
   (will, codicil, POA/LPA, advance directive, trust deed, letter of
   wishes, guardianship nomination, funeral wishes, probate record,
   civil certificates) with named roles (executor, trustee, attorney,
   guardian, beneficiary), jurisdiction, signed/reviewed dates, original
   location, and an optional link to a vault document.
2. An adult can record properties beyond "name + value": ownership
   basis (purchase / inherited / gifted / trust / customary succession),
   recorded vs. claimed owners with percentages, jurisdiction,
   title/deed reference, occupants/caretakers, insurance/mortgage/tax
   status, disputes, intended successor (labelled *family intention*),
   and professional contacts.
3. Every claim has a `verification` of `document_linked` /
   `user_declared` / `family_understanding` / `unverified`, shown as a
   badge everywhere the claim appears.
4. The twin gains a **relationship graph**: person ↔ document ↔ property
   ↔ policy ↔ role, rendered on `/legacy` and queryable by Ask Oak
   ("who is the executor of Mum's will and where is the original?").
5. A **Legacy readiness** component joins the readiness score, with
   drivers, explicitly captioned "completeness and freshness of what's
   recorded — not legal validity."
6. Eight new detector rules (below) fire on the new signals, each with
   a `detector-evals/` golden set at F1 = 1.0.
7. A **continuity rehearsal** lets a second adult check, without any
   document being released, whether they could *find* what they'd need.
8. Free-text **family knowledge notes** attach to any node, labelled
   `family_understanding`, and are fed to Ask Oak as user-authored
   background (same path as PRD-135's `context_note`).
9. Legacy records have stricter visibility than the financial profile:
   existence-visible/contents-private per item; audit on every read of
   a document's metadata beyond the owner.

## What exists (verified) and what changes

| Area | Today | Change |
|---|---|---|
| Vault | `VAULT_DOC_TYPES = will, power_of_attorney, insurance_policy, estate_instruction, other`; `has_will`/`has_power_of_attorney` signal | Extend doc types; vault doc becomes *evidence* a legacy record links to, not the record itself |
| Estate detector | 2 rules on booleans | Rewritten to read the legacy register; 8 rules |
| Assets register | `kind, name, value_minor, notes` | `property` kind gains an optional `legacy` sub-document (below); other kinds untouched |
| Roster | `id, role, dob, user_id` | New `legacy_contacts` collection for named non-members (executor who isn't in the family) |
| Readiness score | 5 components | 6th component `legacy` (weight renormalises; "not entered" never counts as zero — same rule as today) |
| Ask Oak `buildContext` | profile + insights + docs + context note + life-event context | + legacy graph summary (names, roles, locations; never amounts for youth mode) |
| Permissions | `isFamilyAdult`, `isFamilyOrganizer` | + per-record `visibility` and read audit |
| Vision | "Digital Legacy & Emergency Vault" (ARCHITECTURE.md) | This PRD is the *register and reasoning* half; release stays gated |

## Design

### 1. Schema — `apps/api/src/routes/family-legacy.ts`

```ts
const Verification = z.enum(['document_linked', 'user_declared', 'family_understanding', 'unverified'])

const LegacyRole = z.object({
  role: z.enum(['executor', 'trustee', 'attorney', 'guardian', 'beneficiary', 'witness', 'caretaker', 'successor_intended']),
  member_id: z.string().optional(),        // roster member…
  contact_id: z.string().optional(),       // …or legacy_contacts entry (non-member)
  share_pct: z.number().min(0).max(100).optional(),
  verification: Verification,
})

const LegacyDocument = z.object({
  id: z.string(),
  type: z.enum([
    'will', 'codicil', 'power_of_attorney', 'advance_directive', 'trust_deed',
    'letter_of_wishes', 'guardianship_nomination', 'funeral_wishes',
    'probate_record', 'civil_certificate',
  ]),
  subject_member_id: z.string(),           // who it is about
  jurisdiction: z.string().max(80),        // "England & Wales", "Telangana, IN"
  signed_on: z.string().date().optional(),
  last_reviewed_on: z.string().date().optional(),
  review_due_on: z.string().date().optional(),
  original_location: z.string().max(200).optional(),   // "Solicitor X, Leeds" / "home safe"
  vault_document_id: z.string().optional(),            // evidence link → verification=document_linked
  roles: z.array(LegacyRole).max(20),
  covers_asset_ids: z.array(z.string()).max(50),       // family_assets ids this document references
  verification: Verification,
  notes: z.string().max(1000).optional(),              // never medical detail — UI copy says so
  visibility: z.enum(['adults', 'organizer', 'named_roles']).default('adults'),
})

const PropertyLegacy = z.object({                      // optional sub-doc on family_assets kind=property
  ownership_basis: z.enum(['purchase', 'inherited', 'gift', 'trust', 'customary_succession', 'unknown']),
  jurisdiction: z.string().max(80),
  recorded_owners: z.array(LegacyRole),                // from title/deed
  claimed_owners: z.array(LegacyRole),                 // what the family believes
  title_reference: z.string().max(120).optional(),
  title_document_id: z.string().optional(),            // vault evidence
  acquired_on: z.string().date().optional(),
  occupants: z.string().max(200).optional(),
  insured: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  mortgage_outstanding_minor: z.number().int().min(0).optional(),
  dispute: z.enum(['none', 'possible', 'active', 'unknown']).default('unknown'),
  professional_contact_id: z.string().optional(),
  verification: Verification,
})

const LegacyContact = z.object({                       // named non-members
  id: z.string(), name: z.string().max(120),
  relationship: z.string().max(80), email: z.string().email().optional(),
  phone: z.string().max(40).optional(), firm: z.string().max(120).optional(),
  kind: z.enum(['family', 'solicitor', 'notary', 'accountant', 'land_agent', 'other']),
})

const KnowledgeNote = z.object({                       // attaches to any node
  id: z.string(), node: z.object({ kind: z.enum(['member', 'document', 'asset', 'contact']), id: z.string() }),
  text: z.string().max(2000), author_user_id: z.string(), created_at: z.date(),
  verification: z.literal('family_understanding'),
})
```

Collections (tenant-scoped via `getTenantCollection`): `legacy_documents`,
`legacy_contacts`, `legacy_notes`; `family_assets.legacy` embedded.

Routes (adult-only; `visibility` enforced; every read of a
`named_roles`/`organizer` record by a non-owner is audited via
`getAuditLogger()`):

```
GET/POST           /family/legacy/documents
PATCH/DELETE       /family/legacy/documents/:id
GET/POST/PATCH/DEL /family/legacy/contacts
PATCH              /family/assets/:id/legacy          (property only)
GET/POST/DELETE    /family/legacy/notes
GET                /family/legacy/graph               (nodes + edges, redacted by role/mode)
GET                /family/legacy/rehearsal?as=<member_id>
```

> **Implementation decision (batch 3):** the identifiers below were
> originally proposed as new (`family.legacy`, `family_legacy_readiness`,
> a sixth `legacy` component). `family_estate_readiness` / `family.estate`
> / the `estate` component are referenced from vault.ts, family-inbox.ts,
> the web `useFamilyData`, the eval runner and the static `/health/estate`
> route — renaming is churn with no user-visible benefit. We **keep the
> existing ids and enrich them**: `family.estate` becomes a superset
> signal, `estate-readiness.yaml` grows from 2 to 10 rules, and the
> `estate` component scores from the legacy register when records exist,
> falling back to today's vault-boolean behaviour when they don't. Read
> "legacy" below as "the enriched estate".

### 2. Signals → `family.estate` (enriched; registered in `family-signal-schemas.ts`)

Emitted on every legacy write and on the daily sweep, one per tenant:

```ts
{
  adults_total, adults_with_will, adults_with_poa, adults_with_directive,
  wills_stale: number,              // last_reviewed_on older than 36 months OR a child/marriage/property recorded after it
  wills_with_dead_or_missing_executor: number,
  minors_total, minors_with_guardian_nomination,
  properties_total, properties_without_title_evidence, properties_ownership_unknown,
  properties_foreign_without_contact, properties_disputed, properties_uninsured_or_unknown,
  documents_without_original_location,
  assets_unreferenced_by_any_will,
  beneficiary_conflicts: number,    // same subject, different beneficiaries across will / policy.beneficiary_member_id / trust
  businesses_without_successor,     // when kind=business lands; 0 until then
}
```

### 3. Detector — `detectors/family/legacy-readiness.yaml` (replaces `estate-readiness.yaml`; keep rule ids `estate_no_will`/`estate_no_power_of_attorney` for continuity with vault.ts's `ESTATE_RULE_IDS`)

| rule_id | condition | copy direction (informational, ends at a professional) |
|---|---|---|
| `estate_no_will` | `adults_with_will < adults_total` | unchanged intent, now per-adult count |
| `estate_no_power_of_attorney` | `adults_with_poa < adults_total` | unchanged intent |
| `legacy_will_review_due` | `wills_stale > 0` | "A will on file predates a change recorded since (child / marriage / property). Oak can't judge whether it still reflects your wishes — a solicitor can." |
| `legacy_guardianship_gap` | `minors_total > 0 and minors_with_guardian_nomination < minors_total` | guardian nomination not recorded for a dependent child |
| `legacy_executor_missing` | `wills_with_dead_or_missing_executor > 0` | executor is not a current roster member or contact |
| `legacy_property_title_gap` | `properties_without_title_evidence > 0 or properties_ownership_unknown > 0` | "Ownership documentation incomplete — Oak cannot determine title. Locate the deed / land-registry record." |
| `legacy_foreign_property_review` | `properties_foreign_without_contact > 0` | property in another jurisdiction with no local professional recorded |
| `legacy_will_asset_mismatch` | `assets_unreferenced_by_any_will > 0` | a recorded property isn't referenced by any will on file — review prompt, not a legal conclusion |
| `legacy_beneficiary_conflict` | `beneficiary_conflicts > 0` | "Named beneficiaries differ across documents. Rules differ by asset type and jurisdiction — a professional can confirm which applies." |
| `legacy_original_location_unknown` | `documents_without_original_location > 0` | the other adults can't find it |

`impact_low/high: 0` throughout (no honest minor-unit cost — same stance
as today's estate rules). Confidence 0.7. Entity key = tenant for
counts, `subject_member_id`/`asset_id` for per-item rules so adaptive
copy (G10) escalates per item.

Golden eval: `detector-evals/family_legacy_readiness.yaml` with a
positive and a negative case per rule; the existing
`family_estate_readiness.yaml` cases carry over.

### 4. Readiness component `legacy` (`readiness/score.ts`)

Checks (weights sum 100), each a driver: will coverage per adult 25 ·
POA per adult 20 · guardianship per minor 15 · executor/trustee resolvable
10 · property title evidence 15 · original location known 10 · reviewed
within 36 months 5. "Not entered yet" (no legacy documents *and* no
property legacy) → component unscored, not zero. Caption string lives in
the component so the web can't omit it.

### 5. Graph read model (`GET /family/legacy/graph`)

Nodes: members, contacts, documents, assets(property), policies (from
profile, by `beneficiary_member_id`/`member_id`). Edges: `subject_of`,
`names_as(role)`, `covers`, `evidence_for`, `owns(recorded|claimed, pct)`,
`occupies`, `advises`. Every node/edge carries `verification`. Youth
mode: members + documents' *existence* only. Ask Oak's `buildContext`
gets a ≤1,200-char textual rendering of this graph (names, roles,
locations, verification labels — no amounts), appended after the
household context note.

### 6. Continuity rehearsal (`GET /family/legacy/rehearsal?as=<member_id>`)

Pure read model, no notifications, no release. For the chosen adult:
which documents/properties they *can see*, which have an original
location recorded, which name them in a role, which professional
contacts are reachable, and the list of "only one person knows" items
(records with `visibility: organizer` and no note). Returns a
`findability_pct` and the gap list. Web renders it as "If Alex couldn't
act tomorrow, could Jordan find…" with each gap deep-linking to the
record to fix.

### 7. Access model

- `visibility` per document: `adults` (default) · `organizer` ·
  `named_roles` (subject + anyone with a role on it).
- Non-member contacts never get login in this PRD. A future Tier-2
  "executor access request" (organizer-approved, time-boxed, audited)
  is noted as follow-up — not built here.
- Every read of a non-`adults` record by someone other than the
  subject/organizer writes an audit entry (`legacy.document.read`).
- Deleting a member cascades: roles referencing them flip to
  `verification: unverified` and emit `legacy_executor_missing`, they
  are never silently dropped.

### 8. Web

- `/legacy` (new, adult-only): three tabs — **Documents** (per-person
  cards with verification badges, review-due chips), **Property &
  land** (property cards with ownership basis, recorded vs. claimed
  owners, dispute/insurance/jurisdiction chips), **Family map** (graph,
  SVG, click-to-inspect). Rehearsal entry point in the header.
- `/vault` upload: doc-type picker extended; after upload, "Link to a
  legacy record?" prompt.
- `/assets`: property rows gain a "Legacy details" disclosure.
- `/health/legacy`: the component's drivers page (same pattern as
  other domains).
- `/member/[id]`: "Named in" section (roles) + their documents.
- Copy rule everywhere: the verification badge is mandatory, the
  "completeness, not legal validity" caption is mandatory on scores,
  and "please don't include medical details" appears on every notes
  field (PRD-135 precedent).

## Acceptance tests

- `routes/__tests__/family-legacy.test.ts`: CRUD with visibility
  enforcement (403s), audit write on restricted reads, member deletion
  flips roles to `unverified`, youth graph redaction.
- `__tests__/legacy-signal.test.ts`: signal emission counts for a
  fixture family (2 adults, 2 minors, 1 inherited property with unknown
  owners, a will reviewed before the second child).
- `detector-evals/family_legacy_readiness.yaml`: F1 = 1.0, all 10
  rules; `scripts`/CI eval runner picks it up automatically.
- `readiness/__tests__/score-legacy.test.ts`: unscored when empty;
  drivers listed; caption present.
- `routes/__tests__/legacy-rehearsal.test.ts`: findability % and the
  "only one person knows" list.
- Web: `/legacy` renders badges; `/health/legacy` shows caption.

## Sizing

| Piece | Size |
|---|---|
| Schema, collections, routes, visibility + audit | M |
| Signal + schema registration | S |
| Detector YAML (10 rules) + golden evals | S |
| Readiness `legacy` component + web domain page | S |
| Graph read model + Ask Oak context | M |
| Rehearsal read model + UI | S |
| `/legacy` page (3 tabs) + vault/assets/member hooks | L |
| Knowledge notes | S |

Total: **L–XL**, splittable: (a) register + detector + score, (b) graph
+ Ask Oak + member hooks, (c) rehearsal + notes + access polish.

## Explicitly out of scope

- Any automatic or time-delayed **release** of documents (ARCHITECTURE.md
  gated capability — needs its own PRD with legal review).
- Legal validity, succession/inheritance computation, tax estimates.
- Logins for non-member executors/trustees (follow-up Tier-2 PRD).
- Family business entities beyond a placeholder signal (follow-up with
  PRD-135's asset kinds).
- Medical/health information of any kind.
