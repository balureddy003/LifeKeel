# @lifekeel/specifications

Portable outcome specifications and provider contracts — zod schemas that
define the shape of an "outcome" (an insight's measured effect over time)
independent of any specific database or vertical. The leaf of the dependency
graph: every other `packages/*` here depends on it, directly or through
`@lifekeel/runtime`.

Not family-specific. Part of the generic outcome-lifecycle data model
`@lifekeel/mongodb-adapter` also plugs into.
