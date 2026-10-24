# Intent 27: Document upload feedback loop (free tier)

**Problem** — QA could load the documents page (PDF/Word/photo up to 50 MB,
malware scan mentioned, Plus gate on extraction) but found the loop cold: no
upload progress feedback, and after upload a free-tier user gets little
confirmation of what happened — effort in, no visible value out. The critic
review puts it plainly: "uploading a policy should immediately show 'we
stored it and here are the key dates', even on the free tier."

**Done looks like**
- An inline progress bar during upload and an explicit success toast/state
  ("Document stored" + where it lives) on completion — no silent land on a
  list.
- The stored-document row immediately shows what free tier can honestly
  show: filename/type, upload date, vault `doc_type` if chosen — and, where
  the family can see it without extraction, the option to hand-enter a
  renewal/review date that already feeds the renewal detector.
- The upgrade prompt stays honest per PRD-206's tone ("Upgrade to Keel Plus
  to extract details automatically") — value of the action is shown before
  the ask, never framed as risk-alarm upsell.
- Web tests cover progress → success → row rendering; the existing Plus
  gate copy is unchanged in meaning.

**Constraints**
- Trust tier: 0 — UI/state on the existing vault upload path.
- Regulated-advice check: none.
- Data/privacy: no new processing — nothing is parsed or sent to a model on
  free tier; that boundary stays deliberate.

**Out of scope** — free-tier OCR/extraction (a pricing/business decision,
not an engineering intent; PRD-143 covers the Plus pipeline), the automated
upload test-harness limitation noted in the QA report.

**Becomes** — PRD in docs/prd/, amending PRD-003's intake surface.
