/**
 * Blog Routes
 * 
 * Manages blog posts for the marketing landing page.
 * Supports CRUD operations for blog posts with markdown content.
 *
 * Orphaned-surface decision (remediation item 24): the public GETs
 * (/blog/posts, /blog/posts/:slug, /blog/posts/category/:category) are
 * live — apps/web calls them. The write surface (POST/PUT/DELETE and
 * /admin/blog/posts) has no caller in any shipped UI; it is PARKED, not
 * deleted: it's auth-gated via x-kairos-admin-key (absent the env var it
 * can never authorize), it's how blog content plausibly gets managed
 * out-of-band today, and removing it buys nothing — ~100 lines, already
 * small. If an admin UI is never built, the write surface can go in a
 * later cleanup without touching the public GETs.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'

const BlogPostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  content: z.string().min(1),
  excerpt: z.string().min(1),
  category: z.enum(['product', 'tutorial', 'case-study', 'news']),
  author: z.string().min(1),
  published: z.boolean().default(false),
  cover_image: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

type BlogPost = z.infer<typeof BlogPostSchema> & {
  id: string
  created_at: Date
  updated_at: Date
  published_at?: Date | undefined
}

function adminAuthorized(headers: Record<string, unknown>): boolean {
  const expected = process.env['KAIROS_ADMIN_KEY']
  return Boolean(expected && headers['x-kairos-admin-key'] === expected)
}

export function registerBlogRoutes(app: FastifyInstance, db: Db): void {
  const collection = db.collection('blog_posts')

  // Create indexes
  collection.createIndex({ slug: 1 }, { unique: true })
  collection.createIndex({ published: 1, published_at: -1 })
  collection.createIndex({ category: 1 })

  /**
   * GET /blog/posts
   * Returns all published blog posts (public)
   */
  app.get('/blog/posts', async (_req, _reply) => {
    const posts = await collection
      .find({ published: true })
      .sort({ published_at: -1 })
      .project({ content: 0 }) // Exclude full content from list
      .toArray()

    return { posts }
  })

  /**
   * GET /blog/posts/:slug
   * Returns a single blog post by slug (public)
   */
  app.get<{ Params: { slug: string } }>('/blog/posts/:slug', async (req, reply) => {
    const { slug } = req.params
    const post = await collection.findOne({ slug, published: true })

    if (!post) {
      return reply.status(404).send({ error: 'Post not found' })
    }

    return post
  })

  /**
   * GET /blog/posts/category/:category
   * Returns blog posts by category (public)
   */
  app.get<{ Params: { category: string } }>('/blog/posts/category/:category', async (req, _reply) => {
    const { category } = req.params
    const posts = await collection
      .find({ published: true, category })
      .sort({ published_at: -1 })
      .project({ content: 0 })
      .toArray()

    return { posts }
  })

  /**
   * POST /blog/posts
   * Creates a new blog post (admin only)
   */
  app.post('/blog/posts', async (req, reply) => {
    if (!adminAuthorized(req.headers)) {
      return reply.status(403).send({ error: 'Admin key required' })
    }

    const parsed = BlogPostSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid post data', issues: parsed.error.issues })
    }

    const { data } = parsed
    const now = new Date()

    const post: BlogPost = {
      id: crypto.randomUUID(),
      ...data,
      created_at: now,
      updated_at: now,
      published_at: data.published ? now : undefined,
    }

    try {
      await collection.insertOne(post)
      return reply.status(201).send(post)
    } catch (error: any) {
      if (error.code === 11000) {
        return reply.status(409).send({ error: 'Slug already exists' })
      }
      throw error
    }
  })

  /**
   * PUT /blog/posts/:id
   * Updates a blog post (admin only)
   */
  app.put<{ Params: { id: string } }>('/blog/posts/:id', async (req, reply) => {
    if (!adminAuthorized(req.headers)) {
      return reply.status(403).send({ error: 'Admin key required' })
    }

    const { id } = req.params
    const parsed = BlogPostSchema.partial().safeParse(req.body)

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid post data', issues: parsed.error.issues })
    }

    const { data } = parsed
    const now = new Date()

    const updateData: Record<string, unknown> = {
      ...data,
      updated_at: now,
    }

    if (data.published !== undefined) {
      updateData.published_at = data.published ? now : undefined
    }

    const result = await collection.updateOne(
      { id },
      { $set: updateData }
    )

    if (result.matchedCount === 0) {
      return reply.status(404).send({ error: 'Post not found' })
    }

    const updated = await collection.findOne({ id })
    return updated
  })

  /**
   * DELETE /blog/posts/:id
   * Deletes a blog post (admin only)
   */
  app.delete<{ Params: { id: string } }>('/blog/posts/:id', async (req, reply) => {
    if (!adminAuthorized(req.headers)) {
      return reply.status(403).send({ error: 'Admin key required' })
    }

    const { id } = req.params
    const result = await collection.deleteOne({ id })

    if (result.deletedCount === 0) {
      return reply.status(404).send({ error: 'Post not found' })
    }

    return { deleted: true }
  })

  /**
   * GET /admin/blog/posts
   * Returns all blog posts including unpublished (admin only)
   */
  app.get('/admin/blog/posts', async (req, reply) => {
    if (!adminAuthorized(req.headers)) {
      return reply.status(403).send({ error: 'Admin key required' })
    }

    const posts = await collection
      .find({})
      .sort({ created_at: -1 })
      .project({ content: 0 })
      .toArray()

    return { posts }
  })
}
