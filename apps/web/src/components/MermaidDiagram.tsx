'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Renders a mermaid diagram client-side. The import is dynamic — mermaid is
 * ~500KB and only blog posts with diagrams should pay for it. On any render
 * failure the raw source shows as a normal code block instead of breaking
 * the article.
 *
 * securityLevel 'strict' sanitizes labels — blog content is authored
 * markdown, but a stray <script> in a diagram label should still be inert.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const el = ref.current
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
        try {
          const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, chart.trim())
          if (!cancelled && el) el.innerHTML = svg
        } catch {
          if (!cancelled) setFailed(true)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [chart])

  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded-2xl border border-tint/[0.08] bg-tint/[0.03] p-4 text-xs text-ink-secondary whitespace-pre-wrap">
        <code>{chart}</code>
      </pre>
    )
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Diagram"
      className="my-4 overflow-x-auto rounded-2xl border border-tint/[0.08] bg-tint/[0.03] p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
    />
  )
}
