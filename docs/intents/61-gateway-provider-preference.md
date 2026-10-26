# Intent 61: Gateway prefers approved configured providers

**Problem** — QA pass 2: Ask Keel free-form + 'Draft this for me' dead in prod — provider pick order scans anthropic→openai→azure→vertex→groq…, openai key configured → picked → unreviewed → refused → canned reply. Fail-closed is correct, but the pick shouldn't prefer an unapproved processor over an approved configured one.

**Done looks like**
- The first-configured-credential fallback prefers providers with an approved status in ai-processors.yaml over unreviewed ones
- Operator docs note LIFEKEEL_LLM_PROVIDER=groq as the prod fix
- Unreviewed providers still refused (fail-closed preserved)

**Constraints**
- Tier 0 — routing order; rule-3 enforcement unchanged.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.
