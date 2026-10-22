# Personal data breach response

Status: **owners and contacts to be named before launch** (R32). UK GDPR Art. 33–34: a
reportable breach goes to the ICO within 72 hours of becoming aware; people at high risk
are told without undue delay; every breach is recorded, reportable or not.

## Roles

| Role | Name | Backup | Contact |
|---|---|---|---|
| Incident lead | | | |
| Privacy decision (report or not) | | | |
| Communications | | | |
| Engineering on call | | | |

## Within the first hour

1. Open an incident record (template below) with the time you became aware.
2. Contain: revoke sessions for affected users (`users.sessions_revoked_at`), rotate exposed
   secrets (`docs/runbooks/key-rotation.md`), turn on maintenance mode
   (`platform_config.maintenance_mode`) if data is still leaking.
3. Preserve evidence: audit log, `login_events`, Cloud Run logs. Don't delete anything.

## Within 24 hours

Work out what data, whose, how many people, and the likely consequences. Decide with the
privacy lead whether it's reportable to the ICO and whether people must be told.

## Within 72 hours of awareness

Report to the ICO (ico.org.uk/for-organisations/report-a-breach) if required, even if some
facts are still unknown; add them later. Tell affected people in plain language if the risk
to them is high. Tell processors and payment partners where contracts require it.

## Record (every breach)

Date and time aware; what happened; data and people affected; consequences; containment;
reported to ICO (yes/no and why); people told (yes/no and why); follow-up actions and owners.

## Practice

Run a tabletop exercise before launch and once a year. Record the date and what changed.
