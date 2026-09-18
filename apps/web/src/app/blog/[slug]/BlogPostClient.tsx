'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { HelpCircle } from 'lucide-react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { fetchBlogPost, type BlogPost } from '@/lib/api'

const MARKDOWN_COMPONENTS = {
  h2: (props: React.ComponentProps<'h2'>) => <h2 className="text-lg font-semibold text-ink-primary mt-6 mb-2" {...props} />,
  p: (props: React.ComponentProps<'p'>) => <p className="text-sm text-ink-secondary leading-relaxed mb-3" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => <ul className="list-disc list-outside pl-5 text-sm text-ink-secondary leading-relaxed mb-3 space-y-1" {...props} />,
  li: (props: React.ComponentProps<'li'>) => <li {...props} />,
  strong: (props: React.ComponentProps<'strong'>) => <strong className="text-ink-primary font-semibold" {...props} />,
  a: (props: React.ComponentProps<'a'>) => <a className="text-family-400 font-medium" {...props} />,
}

export default function BlogPostClient() {
  const params = useParams<{ slug: string }>()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchBlogPost(params.slug).then((p) => {
      if (!cancelled) {
        setPost(p)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [params.slug])

  if (loading) {
    return (
      <div className="px-5 pt-2 pb-12">
        <PageHeader title="From Agent Oak" backHref="/blog" action={<></>} />
        <div className="shimmer h-4 rounded mt-4 mb-2" />
        <div className="shimmer h-4 rounded w-2/3" />
      </div>
    )
  }

  if (!post) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <h1 className="text-lg font-semibold text-ink-primary mb-1">Post not found</h1>
        <Link href="/blog" className="text-sm text-family-400 font-semibold">Back to all posts</Link>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title={post.title} backHref="/blog" action={<></>} />
      <span className="text-footnote font-semibold uppercase tracking-wide text-family-400">{post.category}</span>
      <div className="mt-3">
        <ReactMarkdown components={MARKDOWN_COMPONENTS}>{post.content}</ReactMarkdown>
      </div>
      <GlassCard className="p-4 mt-4">
        <p className="text-sm text-ink-secondary leading-relaxed">
          Informational and educational only — not financial, investment, tax, or insurance advice.
        </p>
      </GlassCard>
    </div>
  )
}
