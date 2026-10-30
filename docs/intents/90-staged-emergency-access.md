# Intent 90: Staged emergency access — PARKED

**Status: PARKED. Do not design in detail or build.** It is recorded so the reason it is
parked is not lost.

**Problem** — The right adults need the right papers at the right time, without the
household handing over passwords. Password managers offer emergency access with a waiting
period during which the owner can refuse
([MP Estate Planning](https://mpestateplanning.uk/how-executors-access-passwords-digital-accounts/)).
UK sources say probate authority does not automatically unlock password-protected
accounts, most terms of service ban sharing logins, and a secondary legal guide warns that
using a dead person's passwords could risk an offence
([UK Legal Guides](https://www.uklegalguides.com/how-to-handle-online-passwords-in-estate-planning/)).
These are estate-planning firms and guides, not statute or case law; nothing was found on
how UK courts treat the Computer Misuse Act in this context.

**Why parked**
- It releases material on a trigger. That is an irreversible action and sits at Tier 2 or
  3, which CLAUDE.md forbids without an explicit human approval gate. A timed release is
  not an approval; a person must approve each release.
- It overlaps regulated and legal territory (access to a deceased person's accounts).
- It needs attorney review and a prototype before any design, and the split-key
  mechanism is a patent candidate: no mechanism detail is published before a prior-art
  search and filing (the UK has no grace period).
- The cheap, safe part is proposed as the claim packet (Intent 86), the single-point-of-
  failure map (Intent 85) and the emergency sheet (PRD-220): a list of where
  things are and who to call, with no credentials.

**What would reopen it** — a recorded legal opinion on access and consent, an approval
gate design a reviewer accepts, a safeguarding review, and evidence from Intents 85/86
that households want more than a list.

**Out of scope** — Storing or releasing passwords, recovery keys or credentials of any
kind. LifeKeel's documented position is "password stored in a password manager" as a
location note only (Intent 79).

**Becomes** — Nothing. Parked.
