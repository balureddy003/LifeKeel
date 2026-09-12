# @agentoak/workflows

**Not the workflow/automation engine anymore, in this trimmed backend.**
The package still contains a full LangGraph-based workflow engine (it's
copied wholesale from kairos-ai), but `apps/api` doesn't register any
workflow HTTP routes and creates zero workflow definitions for the family
vertical — so `WorkflowEngine` is constructed but never actually runs a
workflow (see `ARCHITECTURE.md`'s "current implemented architecture").

What `apps/api` genuinely uses from this package today:
- Connector OAuth/credential plumbing (`connector-credentials.ts` shares
  this with the generic multi-provider OAuth flow Gmail uses).
- The event-schema registry (`insights.ts` and others).

If Agent Oak's roadmap reaches Tier 1+ "prepare/act" automations (see
`ARCHITECTURE.md`'s trust tiers), this package's actual workflow engine is
the natural place to build that — it isn't dead weight to delete, it's
dormant capability. Don't remove it casually; do register real routes and
family-vertical workflow definitions if/when it's needed for real.
