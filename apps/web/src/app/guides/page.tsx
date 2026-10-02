import Link from 'next/link'
import { GUIDES, guideQuizUrl } from './guides-data'

// Static marketing content — a server component so the guides index is
// real HTML in the static export, not client-injected like the blog
// (posts are dynamic; guides are build-time constants).

export default function GuidesIndex() {
  return (
    <div className="min-h-screen px-5 py-10">
      <main className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-family-400">Agent Oak · Guides</p>
        <h1 className="mt-2 text-3xl font-bold text-ink-primary">The checks a family should know about</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          Plain-language explainers for the things that quietly decide whether a household is ready for a
          bad month — the same checks Oak runs continuously once you sign up.
        </p>

        <div className="mt-8 space-y-4">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/guides/${g.slug}/`} className="block">
              <article className="glass rounded-2xl border border-tint/[0.08] p-5 transition-colors hover:border-family-500/40">
                <h2 className="text-lg font-semibold text-ink-primary">{g.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{g.description}</p>
                <p className="mt-2 text-xs font-semibold text-family-400">Read the guide →</p>
              </article>
            </Link>
          ))}
        </div>

        <div className="glass mt-8 rounded-2xl border border-tint/[0.08] p-5 text-center">
          <p className="text-sm text-ink-secondary">
            Not sure where your household stands?
          </p>
          <Link
            href={guideQuizUrl('index')}
            className="mt-3 inline-block rounded-xl bg-family-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-family-600"
          >
            Take the free Family Readiness Check
          </Link>
          <p className="mt-2 text-xs text-ink-tertiary">Six questions, no signup, about a minute.</p>
        </div>
      </main>
    </div>
  )
}
