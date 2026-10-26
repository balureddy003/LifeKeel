# Intent 50: Property playbook honesty + copy bug

**Problem** — QA pass 2: the property playbook never says no home policy is on file (unlike the What-If which does), and the text reads '…damage too on file' — a broken sentence (render-playbook.ts ~line 283).

**Done looks like**
- Property playbook states honestly when no home/contents policy is on file, matching the What-If's missing-inputs behaviour
- The 'damage too' sentence is grammatically complete
- Copy passes advice-rule test

**Constraints**
- Tier 0 — copy/conditional text. Advice: informational only, no product steering.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.
