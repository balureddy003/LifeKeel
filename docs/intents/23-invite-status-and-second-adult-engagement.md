# Intent 23: Invite delivery status and second-adult engagement

**Problem** — Both reviews flagged the invite flow as the weakest link in the
"family" promise: a pending member shows only "Not joined yet" plus an invite
code (`memberStatusLabel` in `apps/web/src/lib/auth-types.ts:62`), with no
delivery status, no resend, and no signal the other person ever saw it. Until
the partner actually joins and sees the same picture, LifeKeel remains a solo
tool — the critic review ranks this the third-highest impact gap.

**Done looks like**
- The member row/invite surface shows a real state: "Invite sent <when>",
  "Invite opened" where trackable, "Waiting for {name} to join" — not just
  `pending`.
- Primary actions are "Copy invite link" and "Resend invite" (through the
  existing DeliveryRouter/email path, rate-limited); the raw code remains
  available but is not the whole story.
- The organizer can see when a member invite was sent and last re-sent;
  joining flips the same `pending → active` transition PRD-123 shipped.
- On mobile, "Share link" uses the native share sheet — the device test
  rated the bare-code flow the hardest task to complete one-handed; the
  join path must be obvious on the invitee's first open.
- A test covers send → status display → resend → accept.

**Constraints**
- Trust tier: 0/1 — resend sends an email on the family's behalf only when
  the organizer explicitly taps it; no automated chaser in this intent.
- Regulated-advice check: invite copy stays factual.
- Data/privacy: invite-open tracking (if added) must be minimal — a boolean
  or timestamp on the invite, not behavioural analytics on the invitee;
  disclose honestly in the UI copy.

**Out of scope** — automated reminder cadences (PRD-136/139 territory),
per-field permissions for the joined adult (deferred in PRD-110), the
emergency-sheet share surface (PRD-220).

**Becomes** — PRD in docs/prd/, amending PRD-110/PRD-123's join surface.

---

**Status: partially implemented — PR #250.** "Share link" (native sheet /
clipboard) and a "Waiting for X to join — sent {ago}" line are live on the
member invite card; email send + resend were already present. Still open:
invite-*viewed* tracking (needs server-side state the API doesn't expose),
the partner's first-open path, and any "Sam viewed it" surface.
