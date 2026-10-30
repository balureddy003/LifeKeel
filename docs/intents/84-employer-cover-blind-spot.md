# Intent 84: Employer cover the household does not know it has

**Problem** — Death-in-service, group income protection and health cover often sit only
in work email or an HR portal. People do not know what they have, so a job change can end
cover nobody was counting. Evidence (UK surveys, mostly older, so indicative only):
nearly 15% of workers did not know which financial products their employer provided
([Friends Life/YouGov, via Cover](https://covermagazine.co.uk/news/2385709/-seven-employees-unaware-benefit-packages-friends-life));
42% of employees with workplace income protection were unclear on its benefits
([Zurich, via Financial Reporter](https://2025.financialreporter.co.uk/retirement/37m-employees-unaware-of-financial-products.html));
staff re-bought cover they already had
([HR Magazine](https://www.hrmagazine.co.uk/content/news/staff-unaware-their-employer-provides-life-insurance)).
Group income protection generally stops on the day employment ends; some insurers offer a
continuation option whose terms sit in the policy documents
([Aviva member guide](https://www.aviva.co.uk/adviser/product-literature/files/gr/gr02004.pdf),
[Cover Magazine](https://www.covermagazine.co.uk/feature/2147667/risk-clinic-group-ip-vs-individual-ip)).
No current survey was found for 2025–2026; the claim is directional.

**Done looks like**
- From a connected or forwarded mailbox, or a household's own entry, the record shows
  employer-provided cover **on file**: type, insurer or administrator name as printed in
  the source, source document, and the date it was last seen. Each fact links to its
  source and carries a confidence value; the household can correct or remove it.
- The job-change brief fills its recorded-cover field from these facts when present, and
  says "cover on file may end with the employment" with the end date the household
  entered. It never states what the household should do or buy.
- If a continuation option is mentioned in a source, it is shown as "your documents
  mention a continuation option; the terms and any deadline are in the policy documents".
  LifeKeel does not state terms it has not read, and never states a deadline it cannot see.
- Work mail is connected only through a forwarding address or a confirmed opt-in; the
  decision on which is recorded (open decision 4 in the channels review).
- Extraction is a candidate for review: nothing affects a brief until the household
  confirms it (`candidate_for_review`, PRD-143).

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0**; read-only, nothing sent.
- Regulated-advice check: copy describes cover on file and when it may end; never "replace
  it", never an insurer or product named as a suggestion, no "continue your cover".
  `advice-rule.test.ts` covers any new detector or playbook copy.
- Data/privacy limits: identifiers masked before any model call; only extracted facts are
  stored, not whole emails; hosted extraction waits for an approved processor
  (`document.extract_fields` is blocked until one exists); rule 3 applies; work mail may
  breach an employer's IT policy, so offer the forwarding route.
- Friction: this is **depth**, not front door (PRD-230 item 9). The job-change brief must
  still produce its first number with no mailbox connected.

**Out of scope** — Contacting the employer or insurer, completing or changing a
nomination, comparing cover, any statement about continuation terms not in a read source,
and health-insurance claims.

**Becomes** — PRD number once accepted: docs/prd/NNN-employer-cover-blind-spot.md
