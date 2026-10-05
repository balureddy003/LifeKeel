# @lifekeel/pipeline

Connector data pipeline — normalizes any connector's raw data into the
engine's event shape and deduplicates via SHA-256. `apps/api`'s email/Gmail
connector and generic connector-credentials/webhook plumbing depend on this
for turning synced data into events the engine can evaluate.
