# Intent: children's-data regulatory posture

**Problem** — LifeKeel models youth members, serves youth-facing views, runs
literacy content, and scores/nudges youth twins by design — making it a
service "likely to be accessed by children" under the Age-Appropriate Design
Code. None of the required posture exists: no parental-consent model, no
profiling position, no marketing age-exclusion (only `consent.marketing`), no
youth AI task policy, no age-out transition.
Evidence: critical review F1; `ARCHITECTURE.md` §11 sensitive-domain boundary.

**Done looks like**
- Minors' DPIA completed with counsel input; recorded in the data catalogue.
- Named consent model: who consents for a youth member's profile, documents,
  and AI interactions.
- Profiling position per youth feature (which automated processing applies to
  minors and why) + "best interests" as a recorded design constraint.
- Marketing eligibility hard-excludes youth members regardless of consent flag.
- A youth `AiTaskPolicy` variant (narrower context, stronger guards, no
  retention) lands before any youth-facing assistant path.
- Age-out workflow defined (feeds the member-lifecycle work): consent
  re-papering, redaction removal, history visibility.

**Constraints**
- Trust tier touched: 0–1 (posture/consent modeling, not new actions).
- Regulated-advice check: youth-facing copy must stay strictly informational.
- Data/privacy limits: Children's Code defaults apply — profiling off by
  default, highest-privacy settings, no marketing to minors.

**Out of scope** — member lifecycle transitions for adults (separate Stage-B
item); youth product features beyond the posture itself.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md

---

## Implementation record (2026-10)

**Shipped (engineering posture — counsel review outstanding):**

- **Posture document:** `docs/privacy/childrens-data-posture.md` — the named
  consent model (organizer consents on the child's behalf; a child never
  consents for themselves), the per-feature profiling position, and the
  defined age-out workflow. Framed honestly as the technical input to the
  minors' DPIA, not the DPIA itself.
- **Marketing exclusion:** `minorUserIds`/`excludeMinorUsers` in
  `family/family-permissions.ts` resolve each candidate user to their
  roster member and drop minors (`role === 'child'` or DOB < 18). Applied
  to every user-recipient path — lifecycle activation/trial/winback/upgrade
  and campaign `resolveUsers`. Children cannot hold sign-ins today
  (family-join blocks 'child' invites), but member role and DOB are mutable
  on a live adult member, so the check does not rely on "a child user
  can't exist".
- **Youth AI policy:** `assistant.youth_answer.v1` seeded in
  `definitions/ai-tasks.yaml` before any youth-facing path exists, plus a
  new `lifekeel_infra_required` data boundary that fails closed rather
  than falling back to a hosted provider. `retention: none`, quarter-size
  input ceiling. A gateway-test tripwire asserts the entry cannot weaken.
- **Tests:** 3 lifecycle + 2 campaign exclusion cases (child role,
  under-18 DOB on an adult role, 18th-birthday boundary) on real MongoDB;
  2 gateway assertions for the youth task.

**Explicitly not done (needs counsel/product, recorded in the posture doc):**
the minors' DPIA itself and lawful-basis mapping; lead-capture age
attestation (leads carry no age data); auth-time age gating / session
revocation on reclassification; minors' retention schedules.
