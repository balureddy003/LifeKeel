# Intent: migrations as an explicit deploy gate

**Problem** — `runMigrations()` failure is logged but the server starts anyway
("migration failed — starting anyway"); the deploy workflow has no migration
step; the canary only checks `/health/ready`, which reports
`MIGRATION_VERSION=unmanaged`. A failed migration can take traffic.
Index creation is scattered across migrate.ts, db.ts, and per-module
`ensure*Indexes` helpers with swallowed errors.
Evidence: `server.ts:1933-1938`, `migrate.ts`, `deploy-api.yml`.

**Done looks like**
- Migration failure fails boot in production (dev may warn).
- Deploy pipeline asserts ledger head ≥ expected version before traffic
  shift (pre-step job or boot-gate the canary actually verifies).
- `/health/ready` reports the real applied migration version.
- Index-as-code verification: critical missing/conflicting indexes fail
  readiness or CI rather than being swallowed.

**Constraints**
- Trust tier touched: none; approval gate: existing human-gated deploy.
- Regulated-advice check: none.
- Data/privacy limits: none new.

**Out of scope** — expand/migrate/contract rolling-schema discipline (Stage
B15); backfilling historical index drift beyond what readiness checks catch.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md
