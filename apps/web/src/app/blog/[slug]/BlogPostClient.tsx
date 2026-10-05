'use client'

import { isValidElement, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { HelpCircle } from 'lucide-react'
import { GlassCard, PageHeader } from '@/components/Glass'
import { MermaidDiagram } from '@/components/MermaidDiagram'
import { fetchBlogPost, type BlogPost } from '@/lib/api'
import { track } from '@/lib/growth-track'

// Diagram fences can arrive as ```mermaid, ```flowchart, or a bare ```
// block whose first line is a diagram keyword — all render as mermaid.
const DIAGRAM_START = /^(flowchart|graph|sequenceDiagram|stateDiagram|stateDiagram-v2|erDiagram|classDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|C4Context|block-beta|quadrantChart|sankey|xychart|kanban)\b/

function isDiagramBlock(className: string | undefined, text: string): boolean {
  const lang = /language-(\w+)/.exec(className ?? '')?.[1]
  if (lang === 'mermaid' || lang === 'flowchart') return true
  // Bare fenced block: multi-line content starting with a diagram keyword.
  // Inline code never contains a newline, so this can't hit inline spans.
  return !lang && text.includes('\n') && DIAGRAM_START.test(text.trim())
}

const SITE_URL = 'https://lifekeel.co.uk'

/**
 * Static export means every /blog/<slug> serves the same placeholder HTML,
 * so per-post <title>/description/canonical/OG can't be prerendered — the
 * crawler-facing fix is injecting them here once the post loads (Google
 * executes JS for rendering; social-scraper unfurls stay on the root
 * metadata, a hard constraint of the static export). Everything we touch
 * is snapshotted and restored on unmount so navigating away leaves the
 * root layout's site-wide tags intact.
 */
function applyPostSeo(post: BlogPost, slug: string): () => void {
  const description = (post.meta_description || post.excerpt).trim()
  const url = `${SITE_URL}/blog/${slug}/`
  const prevTitle = document.title
  document.title = `${post.title} — LifeKeel`

  const created: HTMLElement[] = []
  const restored: { el: HTMLMetaElement | HTMLLinkElement; prev: string | null }[] = []

  const upsertMeta = (attr: 'name' | 'property', key: string, content: string) => {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attr, key)
      created.push(el)
      document.head.appendChild(el)
    } else {
      restored.push({ el, prev: el.getAttribute('content') })
    }
    el.setAttribute('content', content)
  }

  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', post.title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:type', 'article')
  upsertMeta('name', 'twitter:title', post.title)
  upsertMeta('name', 'twitter:description', description)
  if (post.cover_image) upsertMeta('property', 'og:image', post.cover_image)

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (canonical) restored.push({ el: canonical, prev: canonical.getAttribute('href') })
  else {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    created.push(canonical)
    document.head.appendChild(canonical)
  }
  canonical.href = url

  // Google processes JSON-LD injected by JS — this is the per-post
  // structured data the placeholder HTML can't carry.
  const ld = document.createElement('script')
  ld.type = 'application/ld+json'
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description,
    url,
    datePublished: post.published_at,
    dateModified: post.updated_at ?? post.published_at,
    author: { '@type': 'Organization', name: post.author || 'LifeKeel', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'LifeKeel',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.svg` },
    },
    ...(post.cover_image ? { image: post.cover_image } : {}),
  })
  created.push(ld)
  document.head.appendChild(ld)

  return () => {
    document.title = prevTitle
    for (const { el, prev } of restored) {
      const attr = el instanceof HTMLLinkElement ? 'href' : 'content'
      if (prev === null) el.removeAttribute(attr)
      else el.setAttribute(attr, prev)
    }
    for (const el of created) el.remove()
  }
}

const MARKDOWN_COMPONENTS = {
  code: (props: React.ComponentProps<'code'>) => {
    const { className, children } = props
    const text = String(children ?? '')
    if (isDiagramBlock(className, text)) return <MermaidDiagram chart={text} />
    return <code className={className}>{children}</code>
  },
  // A diagram renders a <div> — invalid inside <pre>, so unwrap it there.
  pre: (props: React.ComponentProps<'pre'>) => {
    if (isValidElement(props.children) && props.children.type === MermaidDiagram) return <>{props.children}</>
    return <pre {...props} />
  },
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
  // Landing UTM is captured once on mount; the CTA click echoes it so
  // channel-level conversion (view → CTA) is attributable per source.
  const utmRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    // The first-touch attribution capture point for social landings —
    // generated posts deep-link here with utm_* params; track() persists
    // them before any later signup reads getAttribution(). The params are
    // also echoed into the event meta so /marketing/performance can
    // attribute views per channel (pathname alone can't).
    const utm: Record<string, string> = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const) {
      const v = new URLSearchParams(window.location.search).get(k)
      if (v) utm[k] = v.slice(0, 100)
    }
    utmRef.current = utm
    track('blog_view', Object.keys(utm).length ? utm : undefined)
    let seoCleanup: (() => void) | null = null
    fetchBlogPost(params.slug).then((p) => {
      if (cancelled) return
      if (p) seoCleanup = applyPostSeo(p, params.slug)
      setPost(p)
      setLoading(false)
    })
    return () => {
      cancelled = true
      seoCleanup?.()
    }
  }, [params.slug])

  if (loading) {
    return (
      <div className="px-5 pt-2 pb-12">
        <PageHeader title="From LifeKeel" backHref="/blog" action={<></>} />
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
      <GlassCard className="p-4 mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-primary font-medium">How covered is your family, really?</p>
        <Link
          href="/readiness"
          onClick={() => track('blog_cta_click', Object.keys(utmRef.current).length ? utmRef.current : undefined)}
          className="shrink-0 text-sm font-semibold text-family-400"
        >
          Take the 2-min check →
        </Link>
      </GlassCard>
    </div>
  )
}
