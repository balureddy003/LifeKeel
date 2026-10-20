/**
 * Build-time blog reads, for the static export (PRD-210, phase 1).
 *
 * The pages under /blog are prerendered from the public API when the site is built, so a post's
 * text, title, description, canonical URL and structured data are in the HTML a search engine
 * fetches. If the API cannot be reached at build time these return empty/null and the pages fall
 * back to the client-side placeholder behaviour, so a build never fails on a missing API.
 * A post published after the last build appears on the next deploy; until then the placeholder
 * route still serves it in the browser.
 */
import type { BlogPost, BlogPostSummary } from '@/lib/api'

const API = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function fetchBlogPostsAtBuild(): Promise<BlogPostSummary[]> {
  try {
    const res = await fetch(`${API()}/blog/posts`, { next: { revalidate: false } })
    if (!res.ok) return []
    const data = (await res.json()) as { posts?: BlogPostSummary[] }
    return data.posts ?? []
  } catch {
    return []
  }
}

export async function fetchBlogPostAtBuild(slug: string): Promise<BlogPost | null> {
  try {
    const res = await fetch(`${API()}/blog/posts/${encodeURIComponent(slug)}`, { next: { revalidate: false } })
    if (!res.ok) return null
    return (await res.json()) as BlogPost
  } catch {
    return null
  }
}

export const BLOG_SITE_URL = 'https://lifekeel.co.uk'

/** Article structured data for a post; mirrors what the client used to inject after load. */
export function blogPostJsonLd(post: BlogPost, slug: string) {
  const description = (post.meta_description || post.excerpt).trim()
  const url = `${BLOG_SITE_URL}/blog/${slug}/`
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: post.published_at,
    dateModified: post.updated_at ?? post.published_at,
    author: { '@type': 'Organization', name: post.author || 'LifeKeel', url: BLOG_SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'LifeKeel',
      logo: { '@type': 'ImageObject', url: `${BLOG_SITE_URL}/icon.svg` },
    },
    ...(post.cover_image ? { image: post.cover_image } : {}),
  }
}
