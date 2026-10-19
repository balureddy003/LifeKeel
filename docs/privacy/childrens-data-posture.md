# Children's-data posture (intent 09)

**Status: engineering position — pending counsel review.** This document
records the consent model, profiling positions, marketing exclusion,
youth-AI policy and age-out workflow that the codebase now enforces or is
committed to. It is the technical input to the minors' DPIA, not the DPIA
itself: a UK GDPR / Age-Appropriate Design Code DPIA requires legal review
before the posture can be called settled.

## Who a "child" is in this codebase

A minor is a `family_groups` roster member where `role === 'child'` **or**
`date_of_birth` computes under 18 (`ageFromDob`,
`family/family-permissions.ts`). Both signals are checked together — a
mislabelled role does not rescue an under-18 DOB, and a missing DOB does
not rescue a 'child' role.

Today a child member cannot hold a sign-in at all: the invite flow
hard-rejects `role === 'child'` (`family-join.ts`). A child's twin is
managed by the adults. The exclusion machinery below therefore guards the
real residual path — an adult member with an account whose role or DOB is
later edited into minor territory — plus the future state where youth
sign-ins exist.

## Consent model

- **Who consents:** the family organizer (or another adult member, where
  the organizer delegates) consents on the child's behalf. Adding a
  `role: 'child'` member, entering their `date_of_birth`, linking a
  `child_name` education fund, or uploading documents about them are all
  adult actions under the adult account's consent — never the child's.
- **A child never consents for themselves.** No child-facing consent
  surface exists; none may be added without a lawful-basis review.
- **Basis recorded as:** parental responsibility, exercised through the
  organizer's account. Counsel to confirm the UK GDPR lawful basis per
  processing purpose in the DPIA (likely: contract for the twin service,
  legitimate interests for readiness scoring, consent for anything
  optional).

## Profiling position per feature

"Best interests of the child" is the recorded design constraint (Children's
Code standard 4). Default is highest privacy: profiling off unless the
feature only exists to serve the child.

| Feature | Automated processing on a minor | Position |
|---|---|---|
| Youth twin (`member-twin.ts` `mode === 'youth'`) | Deterministic projection of savings-goal progress; all household financial amounts and readiness scores dropped **server-side** | On — it is the child-facing product, minimized to goal progress |
| Member agent (`buildMemberAgent`) | Deterministic nudges from the member's own twin; no LLM | On — deterministic only, informational copy |
| Readiness/scenario scoring | Never computed for minors (omitted in youth mode) | Off |
| Detector insights attributed to a member | Dedup/scoring treats minors' entries identically but youth mode never surfaces household insights to them | On for household records only — nothing child-targeted |
| Marketing/lifecycle email | **Excluded — hard, server-side, regardless of consent flags** (`excludeMinorUsers` in `family-permissions.ts`, applied by `lifecycle-emails.ts` and `campaigns.ts`) | Off — enforced |
| LLM calls on a child's behalf | None today; `assistant.youth_answer.v1` is the only permitted task for any future youth-facing path | Off until the youth policy below is wired |

## Marketing age-exclusion

`excludeMinorUsers` / `minorUserIds` (`family/family-permissions.ts`)
resolve each candidate user to their roster member and drop minors. It is
applied to every user-recipient query: lifecycle activation, trial,
winback and upgrade sequences, and campaign `resolveUsers`. A consent
flag, an opt-in, or an operator-fired segment cannot put a minor on a
campaign. Covered by tests in `marketing/__tests__/` (role-'child' and
under-18-DOB cases, and the 18th-birthday boundary).

**Known residual:** `leads` are pre-signup captures with no age data — a
minor could enter an email into the public readiness quiz. Mitigation
proposed for counsel/product: an 18+ attestation checkbox on the lead
capture form, or drop marketing consent entirely for addresses later
linked to a minor member (the signup-conversion stop already suppresses
converted leads). Tracked as open DPIA input.

## Youth AI task policy

`assistant.youth_answer.v1` in `definitions/ai-tasks.yaml` is the only
task id a youth-facing assistant path may use, and it is stricter than
`assistant.answer.v1` in every enforced dimension:

- `data_boundary: lifekeel_infra_required` — a new boundary that **fails
  closed** when the self-hosted model is undeployed, rather than falling
  back to a hosted provider like `lifekeel_infra` does. A minor's prompt
  never leaves LifeKeel-operated infrastructure.
- `provider_retention_class: none` — no processor at all.
- `max_input_tokens: 2000` / `max_output_tokens: 600` — quarter/half the
  adult ceilings; the prompt is contractually the youth twin (savings-goal
  progress, literacy content), never household finances.
- `guard_policy: youth_context_min` — label recording the intent pending
  per-task guard wiring.

A `ai-task-gateway.test.ts` tripwire asserts all of the above, so the
youth entry cannot silently weaken. No youth-facing assistant path exists
today — this policy lands before one, as the intent requires.

## Age-out workflow (defined — implementation is member-lifecycle work)

When a member's `date_of_birth` crosses 18 (or their role is edited off
'child'):

1. **Notification** — organizer notified on the member's 18th-birthday
   sweep that consent re-papering is due; the member can then be invited
   to their own sign-in (the `family-join` 'child' block lifts when the
   role changes to 'adult' — currently a manual organizer edit).
2. **Consent re-papering** — on first adult sign-in, the member accepts
   the adult terms in their own right; until then their account access is
   organizer-mediated only.
3. **Visibility transition** — youth-mode twin stops applying: household
   financial data they were shielded from does **not** automatically
   become visible; the adult twin reveals their own earner slice, not the
   household's. Prior redaction (dropped amounts/readiness) is a view
   mode, not a data deletion — nothing is "restored", the adult view is
   simply computed differently.
4. **History** — the member's attributed insights and twin history carry
   forward; the organizer retains no special access to the adult member's
   new sign-in beyond what the roster grants any adult.

## What this does not settle (counsel/product inputs)

- The minors' DPIA itself (required before stronger youth claims).
- Lawful-basis mapping per processing purpose.
- The lead-capture age attestation (residual above).
- Sign-in revocation when an existing adult account is reclassified as a
  minor — the data exclusions apply immediately, but no auth-time age
  gate exists today. Worth deciding whether reclassification should force
  session revocation.
- Retention schedules specific to minors' records.
