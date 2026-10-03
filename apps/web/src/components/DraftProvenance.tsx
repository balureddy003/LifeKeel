/**
 * Draft provenance chips — the "from your data vs Oak's wording" split the
 * product-review council flagged. The API computes which concrete figures
 * in the source text survived verbatim into the generated draft
 * (apps/api/src/insights/draft-provenance.ts); this renders that list and
 * labels everything else as generated wording to check. `undefined` means
 * the backend didn't send provenance (older server) — render nothing
 * rather than claim a split we don't have.
 */
export function DraftProvenanceNote({ facts }: { facts: string[] | undefined }) {
  if (facts === undefined) return null
  if (facts.length === 0) {
    return (
      <p className="text-xs text-ink-tertiary leading-relaxed">
        No figures from your family&apos;s data appear in this draft — treat it as
        Oak&apos;s suggested wording and check it before sending.
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-tertiary">From your data:</p>
      <div className="flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span
            key={f}
            className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20"
          >
            {f}
          </span>
        ))}
      </div>
      <p className="text-xs text-ink-tertiary leading-relaxed">
        Everything else is Oak&apos;s suggested wording — check it before sending.
      </p>
    </div>
  )
}
