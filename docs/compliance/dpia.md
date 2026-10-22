# Data Protection Impact Assessment — working draft

Status: **draft, not approved.** Prepared from the code on 22 October 2026 (R12). A DPIA is
the controller's decision, so this document gathers the facts and proposed positions. Every
item marked *Decision* needs a named reviewer and a date before LifeKeel processes real
household data.

Why a DPIA is required: LifeKeel combines financial data about a whole household, profiles
it to estimate gaps, holds information about children and about adults who never signed up,
and may read a connected mailbox. That matches several ICO "likely high risk" indicators
(combining datasets, vulnerable people, innovative technology).

## 1. Processing inventory

| Purpose | Data | Subjects | Source | Systems |
|---|---|---|---|---|
| Account and sign-in | name, email, password hash, MFA secret (encrypted) | account holders | the person | `users` |
| Household planning | income, outgoings, policies, pensions, goals | the household | organizer, documents, email | `family_financial_profile`, `documents`, `inbox_items` |
| Roster | names, roles, dates of birth, email | all household members, including children | organizer | `family_groups` |
| Insights | detector output about gaps | the household | derived | `insights`, `signals` |
| Assistant | minimised profile context, questions | the household | the person | `apps/api/src/routes/assistant.ts` |
| Mailbox reading (optional) | message summaries, finance attachments | account holder and their correspondents | Gmail (read-only) or IMAP | `inbox_items`, `documents` |
| Payments | Stripe customer and subscription ids | payer | Stripe | `tenants.billing` |
| Security | sign-in history, IP, user agent | account holders | system | `login_events`, `audit_log` |
| Marketing (consented) | email, consent record | leads and users who opted in | the person | `leads`, `lifecycle_sends` |

Retention for each is in `docs/data-retention.md`.

## 2. Lawful basis per purpose (proposed)

| Purpose | Proposed basis | *Decision* |
|---|---|---|
| Account, planning, insights, assistant for the account holder | Art. 6(1)(b) contract | confirm |
| Data about other adults and children added by the organizer | Art. 6(1)(f) legitimate interests, with a balancing test below | balancing test sign-off |
| Mailbox reading | Art. 6(1)(b) for the account holder; Art. 6(1)(f) for correspondents' incidental data | confirm |
| Security and fraud prevention | Art. 6(1)(f) | confirm |
| Marketing email | consent (PECR reg. 22) | confirm wording and records |
| Advertising cookies | consent (PECR reg. 6) | confirm banner (`apps/web/src/components/MarketingTags.tsx`) |
| Health (special category) | **none relied on.** Product excludes it; free text sent to models has health terms removed (`apps/api/src/privacy/special-category.ts`) | decide whether to keep excluding or adopt an Art. 9 condition |

## 3. People who are not users

- **Other adults** on the roster: they have the right to be told. *Decision:* how (organizer
  prompt to share the notice, an email when added, or both).
- **Children:** no sign-ins, no marketing (`minorUserIds`), used only for household planning.
  Age is checked by role and date of birth at every access boundary
  (`isMinorMember`, R08). *Decision:* age-out process at 18 (see
  `docs/privacy/childrens-data-posture.md`).
- **Organizer authority:** being the organizer is not parental responsibility or authority
  over another adult's data. *Decision:* what the organizer is asked to confirm when adding
  someone.

## 4. Risks and controls

| Risk | Control in code | Residual |
|---|---|---|
| Account takeover | hashed and atomic recovery tokens, MFA with attempt limits and replay protection, session revocation, throttled sign-in (R01, R02, R06, R39, R40, R42) | phishing; no breached-password check |
| A former member keeps access | removal revokes sessions and marks the login removed (R03) | |
| A viewer changes shared facts | household-editor check on profile and policy writes (R04) | which other writes count is a product decision |
| Mailbox over-collection | Gmail read-only scope; finance-only retention (R38) | Google restricted-scope verification (CASA) |
| Data sent to an unreviewed AI processor | processor registry enforced outside dev; downgrade needs a recorded exception (R14) | no processor terms reviewed yet |
| Restore resurrects erased data | erasure journal, maintenance mode and enforced replay (R15) | journal storage location is operational |
| Tracking on a sensitive product | consent gate; never in the signed-in app (R36) | |

## 5. Sign-off

| Role | Name | Date | Outcome |
|---|---|---|---|
| Controller representative | | | |
| DPO or privacy counsel | | | |
| Engineering owner | | | |

Consult the ICO before processing if a high residual risk can't be reduced.
