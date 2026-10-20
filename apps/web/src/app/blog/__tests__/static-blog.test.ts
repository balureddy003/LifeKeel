/**
 * PRD-210 phase 1: blog pages are prerendered, so search engines get the post in the HTML.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { blogPostJsonLd } from '@/lib/blog-build'
import type { BlogPost } from '@/lib/api'

const BLOG = path.resolve(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(BLOG, ...p), 'utf8')

const post = {
  id: 'a', slug: 's', title: 'A title', excerpt: 'An excerpt', category: 'tutorial', author: 'LifeKeel Team',
  published_at: '2026-09-13T00:00:00Z', updated_at: '2026-10-20T00:00:00Z', content: 'Body', tags: [],
} as unknown as BlogPost

describe('blogPostJsonLd', () => {
  it('describes the post as a BlogPosting with its canonical URL and dates', () => {
    const ld = blogPostJsonLd(post, 'life-insurance-coverage-gap')
    expect(ld['@type']).toBe('BlogPosting')
    expect(ld.url).toBe('https://lifekeel.co.uk/blog/life-insurance-coverage-gap/')
    expect(ld.datePublished).toBe('2026-09-13T00:00:00Z')
    expect(ld.dateModified).toBe('2026-10-20T00:00:00Z')
    expect(ld.description).toBe('An excerpt')
  })
  it('prefers the meta description when one is set', () => {
    expect(blogPostJsonLd({ ...post, meta_description: ' Short meta ' }, 's').description).toBe('Short meta')
  })
})

describe('blog pages are static', () => {
  it('the post page generates a page per published post and keeps the placeholder for newer ones', () => {
    const src = read('[slug]', 'page.tsx')
    expect(src).toContain('generateStaticParams')
    expect(src).toContain("slug: 'placeholder'")
    expect(src).toContain('generateMetadata')
    expect(src).toContain('application/ld+json')
  })
  it('the index is a server component that passes the build-time list to the client', () => {
    const src = read('page.tsx')
    expect(src).not.toContain("'use client'")
    expect(src).toContain('fetchBlogPostsAtBuild')
  })
  it('a post served through the placeholder page is marked indexable by the client', () => {
    expect(read('[slug]', 'BlogPostClient.tsx')).toContain("'robots', 'index, follow'")
  })
})
