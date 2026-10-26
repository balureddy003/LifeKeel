# Intent 58: Service worker network-first HTML

**Problem** — QA pass 2: returning users can get a stale bundle — SW serves cached pages first; the old bundle even re-ran the fixed Settings loop (163 calls). Fresh bundle fixed it after cache clear.

**Done looks like**
- HTML navigations go network-first with cache fallback; versioned asset cache stays cache-first; deploys don't strand users on the previous bundle

**Constraints**
- Tier 0 — infra.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.
