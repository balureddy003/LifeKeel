import { fetchBlogPostsAtBuild } from '@/lib/blog-build'
import BlogIndexClient from './BlogIndexClient'

// Prerendered at build from the public API so the post list is in the HTML (PRD-210, phase 1).
export default async function BlogPage() {
  const posts = await fetchBlogPostsAtBuild()
  return <BlogIndexClient initialPosts={posts} />
}
