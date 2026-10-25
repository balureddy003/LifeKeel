# Intent 33: Crisis mode — the dashboard reduced to three next actions

**Problem** — The critic review's longer-term suggestion: a family in crisis
(job loss, bereavement) opening LifeKeel sees the full dashboard — score,
insights, cards, settings — when what they need is the three most important
next actions and the key documents/contacts. The product's best moment (the
"bad day" framing QA also called the strongest idea) is also its most
overwhelming one.

**Done looks like**
- An opt-in or event-triggered "crisis mode" that reduces Home to: the top
  3 next actions (from the PRD-108 playbook for the reported event, or a
  deterministic severity ranking), the emergency-fund runway number, and
  pointers to the relevant vault documents/contacts.
- Easy to exit; a deliberate mode, not a hidden simplification — the full
  dashboard is one tap away.
- Reuses the playbook machinery and severity work (intent 24) rather than
  inventing a second ranking.

**Constraints**
- Trust tier: 0 — presentation of existing derived data.
- Regulated-advice check: crisis copy is the highest-sensitivity copy in the
  product — describes steps and what's on file, never steers toward
  products; same standard as PRD-108's playbook text.
- Data/privacy: none new.

**Out of scope** — new crisis content (PRD-108 ships playbooks), the
emergency-sheet artefact (PRD-220), notifications (PRD-138/139).

**Becomes** — PRD in docs/prd/ when the roadmap reaches it; flagged
lower-priority than intents 20–24 in the QA report's own ordering — this is
a "rely on it in the worst moment" improvement, not a trust-blocker.

---

**Status: investigated — implementation pending.** `EmergencyMode.tsx`
exists but is a crisis *entry* surface (event picker → life-event
reporting), not the dashboard reduction this intent asks for. The actual
work: a deliberate mode flag (probably `mode-context` like the existing
persona modes), a stripped Home variant showing the top-3 playbook steps
for the reported life event + runway + vault/doc pointers, and an exit
control. Sized at a focused session, not a quick patch — no code shipped.
