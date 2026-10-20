'use client'

/**
 * Public blog list (PRD-202) — the detector-driven content engine's index.
 * No auth required. page.tsx prerenders the list at build and passes it in as `initialPosts`;
 * with no initial posts (API unreachable at build) it loads them in the browser as before.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard, PageHeader } from '@/components/Glass'
import { fetchBlogPosts, type BlogPostSummary } from '@/lib/api'

export default function BlogIndexClient({ initialPosts }: { initialPosts: BlogPostSummary[] }) {
  const [posts, setPosts] = useState<BlogPostSummary[]>(initialPosts)
  const [loading, setLoading] = useState(initialPosts.length === 0)

  useEffect(() => {
    if (initialPosts.length > 0) return
    fetchBlogPosts().then((p) => {
      setPosts(p)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="From LifeKeel" subtitle="Plain-language explainers behind what Keel checks for your family." backHref="/" action={<></>} />

      {loading && (
        <div className="mt-4 space-y-3">
          <div className="shimmer h-20 rounded-2xl" />
          <div className="shimmer h-20 rounded-2xl" />
        </div>
      )}

      {!loading && posts.length === 0 && (
        <GlassCard className="p-5 mt-4">
          <div className="text-center">
            <div className="w-12 h-12 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mx-auto mb-3">
              <span className="text-xl">🌱</span>
            </div>
            <p className="text-sm font-semibold text-ink-primary mb-1">We&apos;re just getting started</p>
            <p className="text-sm text-ink-secondary leading-relaxed mb-3">
              Plain-language explainers for what Keel checks for your family are on the way. In the meantime, our guides cover the same ground.
            </p>
            <Link href="/guides" className="text-sm text-family-400 font-semibold">Read the guides →</Link>
          </div>
        </GlassCard>
      )}

      <div className="mt-4 space-y-3">
        {posts.map((post) => (
          <Link key={post.id} href={`/blog/${post.slug}`}>
            <GlassCard className="p-4" interactive>
              <span className="text-footnote font-semibold uppercase tracking-wide text-family-400">{post.category}</span>
              <div className="text-base font-semibold text-ink-primary mt-1 mb-1">{post.title}</div>
              <p className="text-sm text-ink-secondary leading-relaxed">{post.excerpt}</p>
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  )
}
