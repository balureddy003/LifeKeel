'use client'

import { FormEvent, useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchOperatorBlogPosts, fetchOperatorBlogPost, createOperatorBlogPost, updateOperatorBlogPost,
  publishBlogPost, unpublishBlogPost,
  type BlogPostInput, type OperatorBlogPost,
} from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

const CATEGORIES: BlogPostInput['category'][] = ['product', 'tutorial', 'case-study', 'news']

type FormState = Omit<BlogPostInput, 'meta_description' | 'cover_image' | 'tags'> & {
  meta_description: string
  cover_image: string
  tagsText: string
}

const EMPTY: FormState = {
  title: '', slug: '', content: '', excerpt: '', category: 'tutorial', author: 'Agent Oak',
  meta_description: '', cover_image: '', tagsText: '',
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function OperatorContentPage() {
  const toast = useToast()
  const [posts, setPosts] = useState<OperatorBlogPost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorBlogPosts()
      setPosts(result.posts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load posts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function startEdit(post: OperatorBlogPost) {
    // The list endpoint strips `content` — fetch the full doc before editing
    // so a save can't blank the body.
    try {
      const { post: full } = await fetchOperatorBlogPost(post.id)
      post = full
    } catch {
      toast({ message: 'Could not load the post body for editing' })
      return
    }
    setEditing(post.id)
    setForm({
      title: post.title, slug: post.slug, content: post.content ?? '', excerpt: post.excerpt,
      category: post.category, author: post.author, tagsText: post.tags.join(', '),
      meta_description: post.meta_description ?? '', cover_image: post.cover_image ?? '',
    })
    setReason('')
    setFormError(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    const { tagsText, meta_description, cover_image, ...rest } = form
    const input: BlogPostInput = {
      ...rest,
      tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      ...(meta_description.trim() ? { meta_description: meta_description.trim() } : {}),
      ...(cover_image.trim() ? { cover_image: cover_image.trim() } : {}),
    }
    try {
      if (editing) {
        await updateOperatorBlogPost(editing, input, reason.trim())
        toast({ message: 'Post updated' })
      } else {
        await createOperatorBlogPost(input, reason.trim())
        toast({ message: 'Draft created' })
      }
      setEditing(null)
      setForm(EMPTY)
      setReason('')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const input = 'glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40'

  return (
    <div>
      <h1 className="text-2xl font-semibold">Content</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Blog posts shown on the public site. Drafts are private until published. Every change is audited.
      </p>

      <GlassCard className="mt-5 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{editing ? 'Edit post' : 'New draft'}</h2>
          {editing && (
            <button onClick={() => { setEditing(null); setForm(EMPTY); setReason('') }} className="text-xs text-ink-tertiary">
              Cancel edit
            </button>
          )}
        </div>
        <form onSubmit={save} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, ...(editing ? {} : { slug: slugify(e.target.value) }) })} placeholder="Title" className={input} required />
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="slug" className={input} required pattern="[a-z0-9-]+" disabled={Boolean(editing)} />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as BlogPostInput['category'] })} className={input}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Author" className={input} required />
          </div>
          <input value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} placeholder="Excerpt (shown on cards)" className={input} required />
          <input value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} placeholder="Meta description for search engines (optional, ≤300 chars)" maxLength={300} className={input} />
          <input value={form.tagsText} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} placeholder="Tags, comma separated" className={input} />
          <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Post body (markdown)" rows={8} className={`${input} resize-y`} required />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" className={input} required minLength={5} />
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <button disabled={busy || reason.trim().length < 5} className="w-full rounded-xl bg-family-500 py-3 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create draft'}
          </button>
        </form>
      </GlassCard>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 space-y-3">
          {posts.map((post) => (
            <GlassCard key={post.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{post.title}</div>
                  <div className="text-xs text-ink-tertiary">/blog/{post.slug}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${post.published ? 'border-success/25 text-success' : 'border-tint/[0.1] text-ink-tertiary'}`}>
                  {post.published ? 'published' : 'draft'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                <span>{post.category}</span>
                <span>{post.author}</span>
                {post.published_at && <span>Published: {new Date(post.published_at).toLocaleDateString()}</span>}
                {!post.meta_description && <span className="text-warning">No meta description</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void startEdit(post)} className="rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary">
                  Edit
                </button>
                {post.published ? (
                  <ReasonAction label="Unpublish" destructive onConfirm={async (r) => { await unpublishBlogPost(post.id, r); toast({ message: 'Unpublished' }); await load() }} />
                ) : (
                  <ReasonAction label="Publish" onConfirm={async (r) => { await publishBlogPost(post.id, r); toast({ message: 'Published' }); await load() }} />
                )}
              </div>
            </GlassCard>
          ))}
          {posts.length === 0 && (
            <GlassCard className="p-4"><p className="text-sm text-ink-secondary">No posts yet — write the first draft above.</p></GlassCard>
          )}
        </div>
      )}
    </div>
  )
}
