import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GUIDES, getGuide, guideQuizUrl, QUIZ_CTA } from '../guides-data'
import { GuideTracker } from './GuideTracker'

const SITE_URL = 'https://lifekeel.co.uk'

// Real static generation — every guide is a build-time constant, so unlike
// /blog (dynamic posts behind a placeholder rewrite) each guide emits its
// own index.html with the full copy in it. No firebase.json entry needed:
// Hosting serves the exported directory before the ** catch-all rewrite.
export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = getGuide((await params).slug)
  if (!guide) return {}
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `${SITE_URL}/guides/${guide.slug}/` },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url: `${SITE_URL}/guides/${guide.slug}/`,
      type: 'article',
    },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getGuide((await params).slug)
  if (!guide) notFound()

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: guide.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="min-h-screen px-5 py-10">
      <GuideTracker slug={guide.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <main className="mx-auto max-w-2xl">
        <nav className="text-xs text-ink-tertiary">
          <Link href="/guides/" className="hover:text-ink-secondary">Guides</Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-secondary">{guide.title}</span>
        </nav>

        <header className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-family-400">{guide.tagline}</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-ink-primary">{guide.title}</h1>
        </header>

        <div className="mt-5 space-y-3">
          {guide.intro.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-ink-secondary">{p}</p>
          ))}
        </div>

        {guide.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
            <div className="mt-3 space-y-3">
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-[15px] leading-relaxed text-ink-secondary">{p}</p>
              ))}
            </div>
            {section.bullets && (
              <ul className="mt-3 space-y-2">
                {section.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-secondary">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-family-400" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-ink-primary">Common questions</h2>
          <div className="mt-3 space-y-3">
            {guide.faq.map((f) => (
              <details key={f.q} className="glass rounded-2xl border border-tint/[0.08] p-4">
                <summary className="cursor-pointer text-sm font-semibold text-ink-primary">{f.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="glass mt-10 rounded-2xl border border-tint/[0.08] p-5 text-center">
          <p className="text-sm text-ink-secondary">{QUIZ_CTA}</p>
          <Link
            href={guideQuizUrl(guide.slug)}
            className="mt-3 inline-block rounded-xl bg-family-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-family-600"
          >
            Check your family&apos;s readiness
          </Link>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-ink-tertiary">
          This guide is general information, not financial advice. Product and provider choices are
          individual — a licensed professional can evaluate your household&apos;s situation.
        </p>
      </main>
    </div>
  )
}
