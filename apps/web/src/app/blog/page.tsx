'use client'

/**
 * Public blog list (PRD-202) — the detector-driven content engine's index.
 * No auth required, same public-page pattern as /readiness.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard, PageHeader } from '@/components/Glass'
import { fetchBlogPosts, type BlogPostSummary } from '@/lib/api'

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPostSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchBlogPosts().then((p) => {
      setPosts(p)
      setLoading(false)
    })
  }, [])

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="From Agent Oak" subtitle="Plain-language explainers behind what Oak checks for your family." backHref="/" action={<></>} />

      {loading && (
        <div className="mt-4 space-y-3">
          <div className="shimmer h-20 rounded-2xl" />
          <div className="shimmer h-20 rounded-2xl" />
        </div>
      )}

      {!loading && posts.length === 0 && (
        <GlassCard className="p-4 mt-4">
          <p className="text-sm text-ink-secondary leading-relaxed">No posts yet — check back soon.</p>
        </GlassCard>
      )}

      <div className="mt-4 space-y-3">
        {posts.map((post) => (
          <Link key={post.id} href={`/blog/${post.slug}`}>
            <GlassCard className="p-4" interactive>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-family-400">{post.category}</span>
              <div className="text-base font-semibold text-ink-primary mt-1 mb-1">{post.title}</div>
              <p className="text-sm text-ink-secondary leading-relaxed">{post.excerpt}</p>
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  )
}
