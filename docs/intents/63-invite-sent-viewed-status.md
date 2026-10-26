# Intent 63: Invite delivery + viewed status

**Problem** — Carried partial from intent 23 + demographic matrix: invite shows Pending forever — no 'sent'/'viewed' signal. Needs a small API state transition.

**Done looks like**
- Invite records sent_at (already) + viewed_at when the link is opened; roster shows 'Sent Xd ago' → 'Viewed' → 'Joined'
- Viewed tracking is an anonymous timestamp, no content telemetry

**Constraints**
- Tier 0 — state field + display.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.
