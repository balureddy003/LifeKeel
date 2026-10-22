# Data subject rights requests

Status: **owner to be named before launch** (R32). One month to respond (extendable by two
for complex requests, with notice). Free of charge in nearly all cases.

| Right | Self-service | Operator steps |
|---|---|---|
| Access / portability | Settings → Export (organizer: household bundle; other members: their own account) | for someone without a login (a roster member, a correspondent in a connected mailbox), verify identity and search by email across `family_groups`, `leads`, `inbox_items` |
| Erasure | organizer: Settings → Delete Account; members: ask the organizer to remove them | for a non-user, remove their roster entry and any lead; record it |
| Rectification | edit in the app | correct on the person's instructions |
| Objection / restriction | | stop the processing, flag the record, record the decision |
| Marketing opt-out | unsubscribe link in every email | `leads.suppressed`, `users.marketing_consent` |
| Complaint | | log it; tell the person they can go to the ICO |

Log every request: received date, identity check, response date, outcome. Deletion receipts
(`GET /operator/deletion-receipts`) are the evidence for erasure.
