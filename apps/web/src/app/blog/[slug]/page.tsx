import type { Metadata } from 'next'
import BlogPostClient from './BlogPostClient'
import { BLOG_SITE_URL, blogPostJsonLd, fetchBlogPostAtBuild, fetchBlogPostsAtBuild, jsonLdScript } from '@/lib/blog-build'

// Every published post is prerendered at build, with its own title, description, canonical URL and
// Article structured data in the HTML (PRD-210, phase 1). Firebase Hosting serves an exported file
// before the "/blog/**" catch-all rewrite in firebase.json.
//
// 'placeholder' stays in the list: a post published after the last build is rewritten to that one
// page, and BlogPostClient then loads it in the browser from the real URL, as it always did.
export async function generateStaticParams() {
  const posts = await fetchBlogPostsAtBuild()
  return [...posts.map((p) => ({ slug: p.slug })), { slug: 'placeholder' }]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  if (slug === 'placeholder') return { robots: { index: false, follow: true } }
  const post = await fetchBlogPostAtBuild(slug)
  if (!post) return {}
  const description = (post.meta_description || post.excerpt).trim()
  const url = `${BLOG_SITE_URL}/blog/${slug}/`
  return {
    title: `${post.title} — LifeKeel`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: 'article',
      ...(post.published_at ? { publishedTime: post.published_at } : {}),
      ...(post.cover_image ? { images: [post.cover_image] } : {}),
    },
    twitter: { card: 'summary', title: post.title, description },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = slug === 'placeholder' ? null : await fetchBlogPostAtBuild(slug)
  return (
    <div>
      {post && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(blogPostJsonLd(post, slug)) }} />
      )}
      <BlogPostClient key={slug} initialPost={post} initialSlug={post ? slug : null} />
    </div>
  )
}
