# FCA perimeter — questions for a regulatory assessment

Status: **open** (R17). LifeKeel's rule is to stay outside regulated activity permanently
(`CLAUDE.md`, second rule). Code enforces parts of that; whether the product as built is
inside the perimeter is a legal question for a specialist to answer in writing before live
banking or wider launch.

## What the product does today

| Area | Behaviour | Code |
|---|---|---|
| Open Banking | account list only, read-only, behind a feature flag; no payment initiation | `apps/api/src/open-banking/`, `apps/api/src/routes/family-connectors.ts` |
| Insights | describe what's on file and estimate a gap; point to a licensed professional; never name a provider | `detectors/family/*.yaml`, `packages/engine/src/__tests__/advice-rule.test.ts` |
| Assistant | informational system prompt; same rules | `apps/api/src/routes/assistant.ts` |
| Actions | anything external needs explicit human approval | `apps/api/src/__tests__/trust-tier-gate.test.ts` |

## Questions for the assessment

1. **Account information services (PSRs 2017).** If LifeKeel shows consolidated account
   information from a bank, is LifeKeel providing AIS itself, or acting as an agent of an
   authorised AISP? Which model, permissions and consent wording does that require?
2. **Personal recommendations (PERG 8).** Do any insight or assistant outputs, as actually
   worded, amount to advice on investments or insurance? Keyword tests and disclaimers are
   not the answer; review samples of real output.
3. **Arranging (Art. 25 RAO).** Do "notify your existing provider" drafts (PRD-103) or any
   introductions risk arranging?
4. **Financial promotions (s.21 FSMA).** Do marketing pages or emails promote a regulated
   product?
5. If any answer is "inside": which partner/agent model keeps LifeKeel informational, and
   which Consumer Duty, complaints and resilience duties then apply?

## Until answered

Live banking stays behind its flag. Output changes go through the advice-rule test and a
human review against this note.
