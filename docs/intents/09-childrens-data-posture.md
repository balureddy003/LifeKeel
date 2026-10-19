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
