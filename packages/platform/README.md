# @agentoak/platform

Shared platform primitives used throughout `apps/api`: JWT auth
(`AuthService`, `canPerform`, quota enforcement), MongoDB connection/tenant
helpers, OpenTelemetry init, `Decimal`-based money utilities, structured
logging (`createLogger`), and the LLM-provider abstraction (Anthropic/
OpenAI/Azure/Groq/Ollama routing). Everything else in `packages/*` and
`apps/api` that needs auth, logging, or money math depends on this.
