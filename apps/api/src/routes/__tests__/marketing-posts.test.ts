/**
 * /marketing/posts — the Postiz publish path and its earned-trust gate.
 * A draft only auto-publishes when the channel's marketing_social scope is
 * at threshold AND the tenant opted in; otherwise a human approve dispatches
 * (and earns the trust), a reject kills it, and a Postiz failure lands in
 * publish_failed — never silently.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerMarketingPostRoutes, publishDueMarketingPosts, generateDailyMarketingDrafts, pollMarketingEngagement } from '../marketing-posts.js'
import { AUTO_EXECUTE_TRUST_THRESHOLD } from '../../jobs/auto-execute-trusted.js'

const TENANT = 'tenant-1'
const USER = 'user-1'

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return ((cond as { $in: unknown[] }).$in).includes(doc[key])
    }
    return doc[key] === cond
  })
}

function applySet(doc: Record<string, unknown>, set: Record<string, unknown>) {
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith('automation.')) continue // nested path — handled by settings fake
    doc[key] = value
  }
}

function makeDb() {
  const posts: Record<string, unknown>[] = []
  const settingsDocs: Record<string, unknown>[] = []
  const systemEvents: Record<string, unknown>[] = []
  const connections: Record<string, unknown>[] = []
  const postsCol = {
    createIndex: vi.fn(async () => ({})),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => { posts.push(doc) }),
    findOne: vi.fn(async (filter: Record<string, unknown>) => posts.find((d) => matchesFilter(d, filter)) ?? null),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      const doc = posts.find((d) => matchesFilter(d, filter))
      if (doc) applySet(doc, update.$set)
      return { modifiedCount: doc ? 1 : 0 }
    }),
    findOneAndUpdate: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        const doc = posts.find((d) => matchesFilter(d, filter))
        if (!doc) return null
        if (update.$set) applySet(doc, update.$set)
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key]
        return doc
      },
    ),
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => posts.filter((d) => matchesFilter(d, filter)),
      sort: () => ({ limit: () => ({ toArray: async () => posts.filter((d) => matchesFilter(d, filter)) }) }),
    }),
  }
  const settingsCol = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => settingsDocs.find((d) => matchesFilter(d, filter)) ?? null),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      let doc = settingsDocs.find((d) => matchesFilter(d, filter))
      if (!doc) {
        doc = { ...filter }
        settingsDocs.push(doc)
      }
      for (const [key, value] of Object.entries(update.$set)) {
        const parts = key.split('.')
        let target: Record<string, unknown> = doc
        for (const p of parts.slice(0, -1)) {
          target[p] = (target[p] ?? {}) as Record<string, unknown>
          target = target[p] as Record<string, unknown>
        }
        target[parts[parts.length - 1] as string] = value
      }
      return { modifiedCount: 1 }
    }),
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => settingsDocs.filter((d) => matchesFilter(d, filter)),
    }),
  }
  const eventsCol = { insertOne: vi.fn(async (doc: Record<string, unknown>) => { systemEvents.push(doc) }) }
  // platform_config read by the global marketing_paused switch in publishPost
  const configCol = { findOne: vi.fn(async () => null) }
  const connectionsCol = {
    createIndex: vi.fn(async () => ({})),
    findOne: vi.fn(async (filter: Record<string, unknown>) => connections.find((d) => matchesFilter(d, filter)) ?? null),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }) => {
      let doc = connections.find((d) => matchesFilter(d, filter))
      if (!doc) {
        doc = { ...filter, ...(update.$setOnInsert ?? {}) }
        connections.push(doc)
      }
      applySet(doc, update.$set)
      return { modifiedCount: 1 }
    }),
    deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
      const idx = connections.findIndex((d) => matchesFilter(d, filter))
      if (idx === -1) return { deletedCount: 0 }
      connections.splice(idx, 1)
      return { deletedCount: 1 }
    }),
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => connections.filter((d) => matchesFilter(d, filter)),
    }),
  }
  const blogPosts: Record<string, unknown>[] = []
  const blogCol = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => blogPosts.find((d) => matchesFilter(d, filter)) ?? null),
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => blogPosts.filter((d) => matchesFilter(d, filter)),
      sort: () => ({ limit: () => ({ toArray: async () => blogPosts.filter((d) => matchesFilter(d, filter)) }) }),
    }),
  }
  const users: Record<string, unknown>[] = []
  const leads: Record<string, unknown>[] = []
  const growthEvents: Record<string, unknown>[] = []
  const connectorCredentials: Record<string, unknown>[] = []
  const credsCol = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => connectorCredentials.find((d) => matchesFilter(d, filter)) ?? null),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      const doc = connectorCredentials.find((d) => matchesFilter(d, filter))
      if (doc) {
        for (const [k, v] of Object.entries(update.$set)) {
          const parts = k.split('.')
          let target = doc
          for (const p of parts.slice(0, -1)) target = (target[p] ??= {}) as Record<string, unknown>
          target[parts[parts.length - 1]!] = v
        }
      }
      return { modifiedCount: doc ? 1 : 0 }
    }),
    deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
      const idx = connectorCredentials.findIndex((d) => matchesFilter(d, filter))
      if (idx === -1) return { deletedCount: 0 }
      connectorCredentials.splice(idx, 1)
      return { deletedCount: 1 }
    }),
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => connectorCredentials.filter((d) => matchesFilter(d, filter)),
    }),
  }
  const listCol = (docs: Record<string, unknown>[]) => ({
    find: (filter: Record<string, unknown>) => ({ toArray: async () => docs.filter((d) => matchesFilter(d, filter)) }),
  })
  const collections: Record<string, unknown> = {
    marketing_posts: postsCol,
    tenant_settings: settingsCol,
    system_events: eventsCol,
    platform_config: configCol,
    social_connections: connectionsCol,
    connector_credentials: credsCol,
    blog_posts: blogCol,
    users: listCol(users),
    leads: listCol(leads),
    growth_events: listCol(growthEvents),
  }
  return { db: { collection: (name: string) => collections[name] } as any, posts, settingsDocs, systemEvents, postsCol, settingsCol, connections, connectionsCol, blogPosts, users, leads, growthEvents, connectorCredentials }
}

function fakePostiz(overrides: Record<string, unknown> = {}) {
  return {
    listIntegrations: vi.fn(async () => [{ id: 'int-1', name: 'Oak on X', identifier: 'x' }]),
    createPost: vi.fn(async () => [{ id: 'postiz-1' }]),
    ...overrides,
  } as any
}

async function buildApp(opts: {
  postiz?: any
  settings?: Record<string, unknown>
  tenant?: string
  operatorTenants?: string[]
  llm?: (system: string, prompt: string, model?: string) => Promise<string>
} = {}) {
  const { db, posts, settingsDocs, systemEvents, postsCol, connections, blogPosts, users, leads, growthEvents, connectorCredentials } = makeDb()
  const tenant = opts.tenant ?? TENANT
  if (opts.settings) settingsDocs.push({ tenant_id: tenant, automation: opts.settings })
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as never as Record<string, unknown>)['authContext'] = { tenant_id: tenant, user_id: USER }
  })
  registerMarketingPostRoutes(app, db, 'postiz' in opts ? opts.postiz : fakePostiz(), {
    operatorTenants: 'operatorTenants' in opts ? opts.operatorTenants! : [TENANT],
    llm: opts.llm ?? (async () => 'generated post text'),
  })
  await app.ready()
  const postiz = 'postiz' in opts ? opts.postiz : null
  return { app, db, posts, settingsDocs, systemEvents, postsCol, postiz, connections, blogPosts, users, leads, growthEvents, connectorCredentials }
}

const DRAFT = { integration_id: 'int-1', channel: 'x', content: 'A thing worth posting' }
const TRUSTED = { auto_execute_enabled: true, trust_level_by_workflow: { 'marketing_social:x': AUTO_EXECUTE_TRUST_THRESHOLD } }

describe('/marketing/posts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a draft without publishing when the channel has no earned trust', async () => {
    const postiz = fakePostiz()
    const { app } = await buildApp({ postiz })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(res.statusCode).toBe(201)
    expect(res.json().post.state).toBe('draft')
    expect(postiz.createPost).not.toHaveBeenCalled()
  })

  it('auto-publishes a new draft when the channel is trusted and the tenant opted in', async () => {
    const postiz = fakePostiz()
    const { app } = await buildApp({ postiz, settings: TRUSTED })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(res.statusCode).toBe(201)
    const post = res.json().post
    expect(post.state).toBe('published')
    expect(post.auto_published).toBe(true)
    expect(postiz.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int-1', content: DRAFT.content, channel: 'x', type: 'now' }),
    )
  })

  it('stays a draft at full trust when auto_execute_enabled is off', async () => {
    const postiz = fakePostiz()
    const { app } = await buildApp({ postiz, settings: { ...TRUSTED, auto_execute_enabled: false } })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(res.json().post.state).toBe('draft')
    expect(postiz.createPost).not.toHaveBeenCalled()
  })

  it('approve publishes via Postiz and earns one channel-trust increment', async () => {
    const postiz = fakePostiz()
    const { app, settingsDocs, posts } = await buildApp({ postiz })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string

    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(res.statusCode).toBe(200)
    expect(res.json().post.state).toBe('published')
    expect(postiz.createPost).toHaveBeenCalledTimes(1)

    const automation = settingsDocs[0]?.['automation'] as Record<string, unknown>
    expect((automation['trust_level_by_workflow'] as Record<string, number>)['marketing_social:x']).toBe(1)
  })

  it('stays approved without dispatching when scheduled_at is still future, then the sweep publishes it when due', async () => {
    const postiz = fakePostiz()
    const { app, db, posts } = await buildApp({ postiz, settings: TRUSTED })
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: { ...DRAFT, scheduled_at: future } })
    // Channels can't hold a schedule — the post waits as 'approved' until
    // the cron sweep dispatches it at due time.
    expect(res.json().post.state).toBe('approved')
    expect(postiz.createPost).not.toHaveBeenCalled()

    // Due time arrives — the sweep dispatches.
    posts[0]!['scheduled_at'] = new Date(Date.now() - 1000)
    const n = await publishDueMarketingPosts(db, postiz)
    expect(n).toBe(1)
    expect(postiz.createPost).toHaveBeenCalledWith(expect.objectContaining({ channel: 'x', type: 'now' }))
    expect(posts[0]!['state']).toBe('published')
  })

  it('a Postiz failure lands in publish_failed with the error kept — and earns no trust', async () => {
    const postiz = fakePostiz({ createPost: vi.fn(async () => { throw new Error('Postiz 401 unauthorized') }) })
    const { app, posts, settingsDocs } = await buildApp({ postiz })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string

    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(res.statusCode).toBe(502)
    const doc = posts.find((p) => p['id'] === id)!
    expect(doc['state']).toBe('publish_failed')
    expect(String(doc['publish_error'])).toContain('Postiz 401')
    expect(settingsDocs.find((d) => d['automation'])).toBeUndefined()

    // Retry through the same route once Postiz is healthy again.
    postiz.createPost.mockImplementation(async () => [{ id: 'ok' }])
    const retry = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(retry.json().post.state).toBe('published')
  })

  it('a second approve on a published post 404s — no double dispatch', async () => {
    const postiz = fakePostiz()
    const { app, posts } = await buildApp({ postiz })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string
    await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(res.statusCode).toBe(404)
    expect(postiz.createPost).toHaveBeenCalledTimes(1)
  })

  it('reject kills a queued draft and it cannot be approved afterwards', async () => {
    const { app, posts } = await buildApp()
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string
    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/reject` })
    expect(res.json().post.state).toBe('rejected')
    const approve = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(approve.statusCode).toBe(404)
  })

  it('a scheduled approved post can be cancelled before the sweep dispatches it', async () => {
    const postiz = fakePostiz()
    const { app, db, posts } = await buildApp({ postiz, settings: TRUSTED })
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: { ...DRAFT, scheduled_at: future } })
    expect(posts[0]!['state']).toBe('approved')

    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${posts[0]!['id']}/reject` })
    expect(res.statusCode).toBe(200)
    expect(res.json().post.state).toBe('rejected')

    // Due time arrives — the sweep skips the cancelled post.
    posts[0]!['scheduled_at'] = new Date(Date.now() - 1000)
    expect(await publishDueMarketingPosts(db, postiz)).toBe(0)
    expect(postiz.createPost).not.toHaveBeenCalled()
  })

  it('PATCH edits a draft content and schedule; approved posts are not editable', async () => {
    const { app, posts } = await buildApp()
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string

    const future = new Date(Date.now() + 3_600_000).toISOString()
    const res = await app.inject({
      method: 'PATCH',
      url: `/marketing/posts/${id}`,
      payload: { content: 'edited body', scheduled_at: future },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().post.content).toBe('edited body')
    expect(res.json().post.scheduled_at).toBe(future)

    // Clearing the schedule unsets the field.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/marketing/posts/${id}`,
      payload: { scheduled_at: '' },
    })
    expect(cleared.json().post.scheduled_at).toBeUndefined()

    // Approved posts are claimed for dispatch — edits bounce with 404.
    await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    const blocked = await app.inject({
      method: 'PATCH',
      url: `/marketing/posts/${id}`,
      payload: { content: 'too late' },
    })
    expect(blocked.statusCode).toBe(404)
  })

  it('stores the channel response external id/url on a successful publish', async () => {
    const postiz = fakePostiz({
      createPost: vi.fn(async () => ({ external_id: 'at://did:plc:1/app.bsky.feed.post/3k1', url: 'https://bsky.app/profile/oak/post/3k1' })),
    })
    const { app, posts } = await buildApp({ postiz })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: { ...DRAFT, channel: 'bluesky' } })
    await app.inject({ method: 'POST', url: `/marketing/posts/${posts[0]!['id']}/approve` })
    expect(posts[0]!['external_id']).toBe('at://did:plc:1/app.bsky.feed.post/3k1')
    expect(posts[0]!['external_url']).toBe('https://bsky.app/profile/oak/post/3k1')
  })

  it('dry_run_mode flips state without a Postiz call; the human review still earns trust', async () => {
    const postiz = fakePostiz()
    const { app, posts, settingsDocs } = await buildApp({ postiz, settings: { dry_run_mode: true } })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    const id = posts[0]!['id'] as string
    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${id}/approve` })
    expect(res.json().post.state).toBe('published')
    expect(res.json().post.dry_run).toBe(true)
    expect(postiz.createPost).not.toHaveBeenCalled()
    const automation = settingsDocs[0]?.['automation'] as Record<string, unknown>
    expect((automation['trust_level_by_workflow'] as Record<string, number>)['marketing_social:x']).toBe(1)
  })

  it('without a Postiz client, drafts still queue and approve lands publish_failed', async () => {
    const { app, posts } = await buildApp({ postiz: null })
    await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(posts[0]!['state']).toBe('draft')
    const res = await app.inject({ method: 'POST', url: `/marketing/posts/${posts[0]!['id']}/approve` })
    expect(res.statusCode).toBe(502)
    expect(posts[0]!['publish_error']).toBe('publisher_not_configured')
  })

  it('GET /marketing/integrations 503s when unconfigured, lists channels otherwise', async () => {
    const noKey = await buildApp({ postiz: null })
    expect((await noKey.app.inject({ method: 'GET', url: '/marketing/integrations' })).statusCode).toBe(503)

    const withKey = await buildApp()
    const res = await withKey.app.inject({ method: 'GET', url: '/marketing/integrations' })
    expect(res.statusCode).toBe(200)
    expect(res.json().integrations[0].id).toBe('int-1')
  })

  it('operator gate: a non-operator tenant gets 403 and writes nothing', async () => {
    const postiz = fakePostiz()
    const { app, posts } = await buildApp({ postiz, tenant: 'tenant-2' })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(res.statusCode).toBe(403)
    expect(posts).toHaveLength(0)
    const list = await app.inject({ method: 'GET', url: '/marketing/posts' })
    expect(list.statusCode).toBe(403)
    expect(postiz.createPost).not.toHaveBeenCalled()
  })

  it('operator gate: an empty allowlist turns the feature off with 503', async () => {
    const { app, posts } = await buildApp({ operatorTenants: [] })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: DRAFT })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toBe('marketing_not_configured')
    expect(posts).toHaveLength(0)
  })

  it('400s on invalid create payloads', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/marketing/posts', payload: { channel: 'x' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('/marketing/connections', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  function stubSession(ok: boolean) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ok
          ? new Response(JSON.stringify({ accessJwt: 'tok', did: 'did:plc:abc' }), { status: 200 })
          : new Response('{"error":"AuthenticationRequired"}', { status: 401 }),
      ),
    )
  }

  it('verifies the app password with Bluesky, then stores it encrypted', async () => {
    stubSession(true)
    const { app, connections } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/connections/bluesky',
      payload: { handle: '@Oak.Bsky.Social', app_password: 'abcd-efgh-ijkl-mnop' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().connection.handle).toBe('oak.bsky.social')
    expect(connections).toHaveLength(1)
    const stored = connections[0]!
    // Credential is AES-256-GCM'd at rest — the raw password must not appear.
    const creds = stored['credentials'] as Record<string, string>
    expect(creds['app_password']).not.toBe('abcd-efgh-ijkl-mnop')
    expect(JSON.stringify(stored)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('rejects a bad app password with 502 and stores nothing', async () => {
    stubSession(false)
    const { app, connections } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/connections/bluesky',
      payload: { handle: 'oak.bsky.social', app_password: 'wrong' },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('bluesky_auth_failed')
    expect(connections).toHaveLength(0)
  })

  it('GET lists connections without credentials; DELETE removes the row', async () => {
    stubSession(true)
    const { app } = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/marketing/connections/bluesky',
      payload: { handle: 'oak.bsky.social', app_password: 'abcd-efgh-ijkl-mnop' },
    })
    const list = await app.inject({ method: 'GET', url: '/marketing/connections' })
    expect(list.statusCode).toBe(200)
    const conn = list.json().connections[0]
    expect(conn.handle).toBe('oak.bsky.social')
    expect(conn.credentials).toBeUndefined()

    const del = await app.inject({ method: 'DELETE', url: '/marketing/connections/bluesky' })
    expect(del.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/marketing/connections' })).json().connections).toHaveLength(0)
    expect((await app.inject({ method: 'DELETE', url: '/marketing/connections/bluesky' })).statusCode).toBe(404)
  })

  it('a stored connection shows up as a composer channel and shadows env for that channel', async () => {
    stubSession(true)
    const { app, db } = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/marketing/connections/bluesky',
      payload: { handle: 'oak.bsky.social', app_password: 'abcd-efgh-ijkl-mnop' },
    })
    // Rebuild the default client path the same way the route does when no
    // publisher is injected — DbSocialPublisher over env + db.
    const { DbSocialPublisher } = await import('../../marketing/social-publisher.js')
    const pub = new DbSocialPublisher(db, null)
    const integrations = await pub.listIntegrations(TENANT)
    expect(integrations).toEqual([
      expect.objectContaining({ identifier: 'bluesky', source: 'connection' }),
    ])
    // Another tenant sees nothing.
    expect(await pub.listIntegrations('other-tenant')).toEqual([])
  })
})

describe('/marketing/posts/generate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  const GEN = { integration_id: 'int-1', channel: 'x', topic: 'why families underinsure' }

  it('LLM-drafts a post that lands as draft — AI content is review-first even at full trust', async () => {
    const llm = vi.fn(async () => 'fresh generated copy')
    const { app, posts } = await buildApp({ settings: TRUSTED, llm })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.statusCode).toBe(201)
    const post = res.json().post
    expect(post.state).toBe('draft')
    expect(post.generated).toBe('llm')
    expect(post.content).toBe('fresh generated copy')
    expect(posts[0]!['state']).toBe('draft')
    expect(llm).toHaveBeenCalledWith(expect.stringContaining('Informational'), expect.stringContaining('underinsure'), 'tier:fast')
  })

  it('promotes a published blog post — prompt carries title, excerpt and verbatim link', async () => {
    vi.stubEnv('AGENT_OAK_URL', 'https://oak.example')
    const seen: string[] = []
    const llm = async (_s: string, prompt: string) => {
      seen.push(prompt)
      return 'Read this https://oak.example/blog/cover-gap'
    }
    const { app, blogPosts } = await buildApp({ llm })
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'The cover gap', excerpt: 'Most families miss it.' })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/posts/generate',
      payload: { integration_id: 'i', channel: 'bluesky', blog_slug: 'cover-gap' },
    })
    expect(res.statusCode).toBe(201)
    expect(seen[0]).toContain('The cover gap')
    expect(seen[0]).toContain('Most families miss it.')
    expect(seen[0]).toContain(
      'Link to include verbatim: https://oak.example/blog/cover-gap?utm_source=bluesky&utm_medium=social&utm_campaign=oak_social&utm_content=cover-gap',
    )
  })

  it('falls back to a template draft when the LLM fails — feature stays usable', async () => {
    const llm = async () => {
      throw new Error('OPENAI_API_KEY not set')
    }
    const { app, blogPosts } = await buildApp({ llm })
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'The cover gap', excerpt: 'Most families miss it.' })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/posts/generate',
      payload: { integration_id: 'i', channel: 'x', blog_slug: 'cover-gap' },
    })
    const post = res.json().post
    expect(post.state).toBe('draft')
    expect(post.generated).toBe('template')
    expect(post.content).toContain('The cover gap')
    expect(post.content).toContain('Most families miss it.')
  })

  it('clamps output to the channel limit — x caps at 280', async () => {
    const llm = async () => 'word '.repeat(100)
    const { app } = await buildApp({ llm })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.json().post.content.length).toBeLessThanOrEqual(280)
  })

  it('reserves room for the link — a full-length body cannot push it past the clamp', async () => {
    vi.stubEnv('AGENT_OAK_URL', 'https://oak.example')
    const { app, blogPosts } = await buildApp({ llm: async () => 'word '.repeat(100) })
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'The cover gap', excerpt: 'Most families miss it.' })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/posts/generate',
      payload: { integration_id: 'i', channel: 'x', blog_slug: 'cover-gap' },
    })
    const post = res.json().post
    expect(post.content).toContain(
      'https://oak.example/blog/cover-gap?utm_source=x&utm_medium=social&utm_campaign=oak_social&utm_content=cover-gap',
    )
    expect(post.content.length).toBeLessThanOrEqual(280)
  })

  it('free-topic drafts carry a UTM link to the readiness check', async () => {
    vi.stubEnv('AGENT_OAK_URL', 'https://oak.example')
    const { app } = await buildApp({ llm: async () => 'A family safety net starts with one question.' })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    const post = res.json().post
    expect(post.content).toContain('https://oak.example/readiness?utm_source=x')
    expect(post.content).toContain('utm_content=topic')
  })

  it('preview mode returns variants without persisting — the operator picks one', async () => {
    const llm = vi.fn(async (_system: string, _prompt: string, _tier?: string) => 'hook one\n---\nhook two\n---\nhook three')
    const { app, posts } = await buildApp({ llm })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/posts/generate',
      payload: { ...GEN, preview: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().drafts).toEqual(['hook one', 'hook two', 'hook three'])
    expect(posts).toHaveLength(0)
    expect(llm.mock.calls[0]![1]).toContain('variants')
  })

  it('posts carry their campaign into the UTM link and the doc', async () => {
    vi.stubEnv('AGENT_OAK_URL', 'https://oak.example')
    const llm = async () => 'campaign post'
    const { app, posts } = await buildApp({ llm })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/posts/generate',
      payload: { ...GEN, campaign: 'autumn_push' },
    })
    expect(res.statusCode).toBe(201)
    expect(posts[0]!['campaign']).toBe('autumn_push')
    expect(posts[0]!['content']).toContain('utm_campaign=autumn_push')
  })

  it('400s with neither topic nor blog_slug, 404s on an unknown slug', async () => {
    const { app } = await buildApp()
    expect(
      (await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: { integration_id: 'i', channel: 'x' } })).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/marketing/posts/generate',
          payload: { integration_id: 'i', channel: 'x', blog_slug: 'nope' },
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('generateDailyMarketingDrafts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('queues a review-first draft for an opted-in tenant with a connection and an unpromoted post', async () => {
    const { db, settingsDocs, connections, blogPosts, posts } = await buildApp()
    settingsDocs.push({ tenant_id: TENANT, automation: { daily_marketing_drafts_enabled: true } })
    connections.push({ tenant_id: TENANT, channel: 'bluesky', status: 'active', handle: 'oak.bsky.social', credentials: {} })
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'The cover gap', excerpt: 'Most families miss it.' })
    const n = await generateDailyMarketingDrafts(db, async () => 'morning draft')
    expect(n).toBe(1)
    const post = posts[0]!
    expect(post['state']).toBe('draft')
    expect(post['generated']).toBe('llm')
    expect(post['source_blog_slug']).toBe('cover-gap')
    expect(post['channel']).toBe('bluesky')
    expect(post['created_by']).toBe('daily-generator')
  })

  it('skips tenants that never opted in and tenants without an active connection', async () => {
    const { db, settingsDocs, connections, blogPosts, posts } = await buildApp()
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'T', excerpt: 'E' })
    // Not opted in — nothing.
    settingsDocs.push({ tenant_id: 'tenant-off', automation: { daily_marketing_drafts_enabled: false } })
    connections.push({ tenant_id: 'tenant-off', channel: 'bluesky', status: 'active', credentials: {} })
    // Opted in but no connection — nothing.
    settingsDocs.push({ tenant_id: 'tenant-noconn', automation: { daily_marketing_drafts_enabled: true } })
    const n = await generateDailyMarketingDrafts(db, async () => 'x')
    expect(n).toBe(0)
    expect(posts).toHaveLength(0)
  })

  it('skips the day when every published post was already promoted (source_blog_slug dedupe)', async () => {
    const { db, settingsDocs, connections, blogPosts, posts } = await buildApp()
    settingsDocs.push({ tenant_id: TENANT, automation: { daily_marketing_drafts_enabled: true } })
    connections.push({ tenant_id: TENANT, channel: 'bluesky', status: 'active', credentials: {} })
    blogPosts.push({ slug: 'cover-gap', published: true, title: 'T', excerpt: 'E' })
    posts.push({ id: 'p1', tenant_id: TENANT, channel: 'bluesky', state: 'published', source_blog_slug: 'cover-gap' })
    expect(await generateDailyMarketingDrafts(db, async () => 'x')).toBe(0)
    // A new post lands → next sweep picks it up.
    blogPosts.push({ slug: 'new-post', published: true, title: 'N', excerpt: 'E2' })
    expect(await generateDailyMarketingDrafts(db, async () => 'fresh')).toBe(1)
    expect(posts.find((p) => p['source_blog_slug'] === 'new-post')).toBeTruthy()
  })
})

describe('/marketing/performance', () => {
  it('rolls views, CTA clicks, attributed signups and leads up per promoted post and channel', async () => {
    const { app, growthEvents, users, leads, blogPosts } = await buildApp()
    blogPosts.push({ slug: 'cover-gap', title: 'The cover gap', published: true })
    growthEvents.push(
      { event: 'blog_view', path: '/blog/cover-gap', meta: { utm_source: 'bluesky', utm_campaign: 'oak_social' } },
      { event: 'blog_view', path: '/blog/cover-gap', meta: { utm_source: 'bluesky' } },
      { event: 'blog_view', path: '/blog/cover-gap', meta: { utm_source: 'x' } },
      { event: 'blog_view', path: '/blog/other-post' },                    // no utm — view counts, channel doesn't
      { event: 'blog_cta_click', path: '/blog/cover-gap' },
      { event: 'blog_cta_click', path: '/blog/cover-gap', meta: { utm_source: 'bluesky' } }, // channel-level CTA
      { event: 'landing_view', path: '/' },                                // unrelated event — ignored
      { event: 'blog_view', path: '/settings' },                           // non-blog path — ignored
    )
    users.push(
      { attribution: { utm_source: 'bluesky', utm_medium: 'social', utm_campaign: 'oak_social', utm_content: 'cover-gap' } },
      { attribution: { utm_source: 'bluesky', utm_medium: 'social', utm_campaign: 'autumn_push', utm_content: 'cover-gap' } },
      { attribution: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ads', utm_content: 'cover-gap' } }, // non-social medium — excluded
      { attribution: { utm_source: 'x', utm_medium: 'social', utm_campaign: 'oak_social' } },                      // campaign but no slug — channel only
    )
    leads.push({ attribution: { utm_source: 'x', utm_medium: 'social', utm_campaign: 'oak_social', utm_content: 'cover-gap' } })

    const res = await app.inject({ method: 'GET', url: '/marketing/performance' })
    expect(res.statusCode).toBe(200)
    const { posts, channels, campaigns, totals } = res.json() as {
      posts: { slug: string; views: number; cta_clicks: number; signups: number; leads: number; title?: string }[]
      channels: { channel: string; views: number; cta_clicks: number; leads: number; signups: number }[]
      campaigns: { campaign: string; views: number; signups: number; leads: number }[]
      totals: { views: number; signups: number; leads: number }
    }

    const gap = posts.find((p) => p.slug === 'cover-gap')!
    expect(gap).toMatchObject({ views: 3, cta_clicks: 2, signups: 2, leads: 1, title: 'The cover gap' })
    const other = posts.find((p) => p.slug === 'other-post')!
    expect(other.views).toBe(1)
    // Totals are the sum of per-post rows — a campaign signup without
    // utm_content counts in channels but not in posts totals.
    expect(totals).toMatchObject({ views: 4, signups: 2, leads: 1 })

    const bsky = channels.find((c) => c.channel === 'bluesky')!
    expect(bsky).toMatchObject({ views: 2, cta_clicks: 1, leads: 0, signups: 2 })
    const x = channels.find((c) => c.channel === 'x')!
    expect(x).toMatchObject({ views: 1, cta_clicks: 0, leads: 1, signups: 1 })
    expect(channels.find((c) => c.channel === 'google')).toBeUndefined()

    // Campaign rollup — named pushes bucket separately from the default.
    const oakSocial = campaigns.find((c) => c.campaign === 'oak_social')!
    expect(oakSocial).toMatchObject({ views: 1, signups: 2, leads: 1 })
    expect(campaigns.find((c) => c.campaign === 'autumn_push')).toMatchObject({ signups: 1 })
    expect(campaigns.find((c) => c.campaign === 'ads')).toBeUndefined()
  })

  it('returns an empty rollup when nothing has been promoted yet', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/marketing/performance' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ posts: [], channels: [], campaigns: [], totals: { views: 0, cta_clicks: 0, signups: 0, leads: 0 } })
  })
})

describe('pollMarketingEngagement', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes like/repost/reply counts onto published bluesky posts; skips dry-runs and other channels', async () => {
    const { db, posts } = await buildApp()
    posts.push(
      { id: 'p1', tenant_id: TENANT, channel: 'bluesky', state: 'published', external_id: 'at://did:plc:1/app.bsky.feed.post/3k1', published_at: new Date() },
      { id: 'p2', tenant_id: TENANT, channel: 'x', state: 'published', external_id: 'tw-1', published_at: new Date() },
      { id: 'p3', tenant_id: TENANT, channel: 'bluesky', state: 'published', dry_run: true, external_id: 'at://did/dry', published_at: new Date() },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ posts: [{ uri: 'at://did:plc:1/app.bsky.feed.post/3k1', likeCount: 7, repostCount: 2, replyCount: 1 }] }),
          { status: 200 },
        ),
      ),
    )
    const n = await pollMarketingEngagement(db)
    expect(n).toBe(1)
    expect(posts[0]!['metrics']).toEqual({ likes: 7, reposts: 2, replies: 1 })
    expect(posts[1]!['metrics']).toBeUndefined()
    expect(posts[2]!['metrics']).toBeUndefined()
  })

  it('survives a transient Bluesky failure without touching metrics', async () => {
    const { db, posts } = await buildApp()
    posts.push({ id: 'p1', tenant_id: TENANT, channel: 'bluesky', state: 'published', external_id: 'at://did/1', published_at: new Date() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 503 })))
    expect(await pollMarketingEngagement(db)).toBe(0)
    expect(posts[0]!['metrics']).toBeUndefined()
  })
})

describe('X OAuth connection (connector_credentials)', () => {
  const xCred = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    tenant_id: TENANT,
    connector_id: 'twitter_x',
    auth_type: 'oauth2',
    access_token: 'x-access-1',
    refresh_token: 'x-refresh-1',
    token_expires_at: new Date(Date.now() + 3600_000),
    token_type: 'Bearer',
    extra: { username: 'agent_oak' },
    updated_at: new Date(),
    ...over,
  })

  it('GET /marketing/connections merges the twitter_x credential row without tokens', async () => {
    const { app, connectorCredentials } = await buildApp()
    connectorCredentials.push(xCred())
    const res = await app.inject({ method: 'GET', url: '/marketing/connections' })
    expect(res.statusCode).toBe(200)
    const conns = res.json().connections
    const x = conns.find((c: Record<string, unknown>) => c.channel === 'x')
    expect(x).toMatchObject({ channel: 'x', handle: 'agent_oak', status: 'active' })
    expect(x.access_token).toBeUndefined()
    expect(x.refresh_token).toBeUndefined()
  })

  it('needs_reauth credentials surface as status error with a reconnect hint', async () => {
    const { app, connectorCredentials } = await buildApp()
    connectorCredentials.push(xCred({ needs_reauth: true }))
    const res = await app.inject({ method: 'GET', url: '/marketing/connections' })
    const x = res.json().connections.find((c: Record<string, unknown>) => c.channel === 'x')
    expect(x.status).toBe('error')
    expect(String(x.last_error)).toContain('reconnect')
  })

  it('DELETE /marketing/connections/x removes the connector credential', async () => {
    const { app, connectorCredentials } = await buildApp()
    connectorCredentials.push(xCred())
    const del = await app.inject({ method: 'DELETE', url: '/marketing/connections/x' })
    expect(del.statusCode).toBe(200)
    expect(connectorCredentials).toHaveLength(0)
    expect((await app.inject({ method: 'DELETE', url: '/marketing/connections/x' })).statusCode).toBe(404)
  })

  it('engagement poller reads public_metrics for X posts via the connector token', async () => {
    const { db, posts, connectorCredentials } = await buildApp()
    connectorCredentials.push(xCred())
    posts.push(
      { id: 'p1', tenant_id: TENANT, channel: 'x', state: 'published', external_id: 'tw-55', published_at: new Date() },
      { id: 'p2', tenant_id: TENANT, channel: 'x', state: 'published', external_id: 'tw-56', published_at: new Date() },
    )
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/2/tweets/tw-55')) {
        return new Response(
          JSON.stringify({ data: { id: 'tw-55', public_metrics: { like_count: 9, repost_count: 3, reply_count: 2 } } }),
          { status: 200 },
        )
      }
      return new Response('rate limited', { status: 429 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const n = await pollMarketingEngagement(db)
    expect(n).toBe(1)
    expect(posts[0]!['metrics']).toEqual({ likes: 9, reposts: 3, replies: 2 })
    expect(posts[1]!['metrics']).toBeUndefined() // 429 → keeps previous state
  })

  it('poller skips X posts entirely when the tenant has no credential', async () => {
    const { db, posts } = await buildApp()
    posts.push({ id: 'p1', tenant_id: TENANT, channel: 'x', state: 'published', external_id: 'tw-1', published_at: new Date() })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await pollMarketingEngagement(db)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('learning loop — performance-informed generation', () => {
  beforeEach(() => vi.unstubAllEnvs())

  const GEN = { integration_id: 'int-1', channel: 'x', topic: 'why families underinsure' }
  const pubPost = (over: Record<string, unknown>) => ({
    id: 'p', tenant_id: TENANT, channel: 'x', integration_id: 'i',
    content: 'post text', state: 'published',
    created_by: 'u', created_at: new Date(), published_at: new Date(),
    ...over,
  })

  it('injects measured winners and flops into the generation prompt', async () => {
    const seen: string[] = []
    const llm = async (_s: string, prompt: string) => {
      seen.push(prompt)
      return 'fresh draft'
    }
    const { app, posts } = await buildApp({ llm })
    posts.push(
      pubPost({ id: 'w1', content: 'What happens to the mortgage if paychecks stop tomorrow?', metrics: { likes: 12, reposts: 3, replies: 2 }, metrics_at: new Date() }),
      pubPost({ id: 'f1', content: 'Generic brand broadcast copy', metrics: { likes: 0, reposts: 0, replies: 0 }, metrics_at: new Date() }),
    )
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.statusCode).toBe(201)
    expect(seen[0]).toContain('WINNER')
    expect(seen[0]).toContain('paychecks stop tomorrow')
    expect(seen[0]).toContain('12 likes')
    expect(seen[0]).toContain('FLOP')
    expect(seen[0]).toContain('Generic brand broadcast copy')
    // Still review-first — learning never loosens the gate.
    expect(res.json().post.state).toBe('draft')
  })

  it('credits signups attributed to the promoted slug into the winner line', async () => {
    const seen: string[] = []
    const llm = async (_s: string, prompt: string) => {
      seen.push(prompt)
      return 'fresh draft'
    }
    const { app, posts, users } = await buildApp({ llm })
    posts.push(
      pubPost({ id: 'w1', source_blog_slug: 'cover-gap', content: 'The cover gap nobody checks', metrics: { likes: 2 }, metrics_at: new Date() }),
      pubPost({ id: 'w2', source_blog_slug: 'other-post', content: 'Second promoted post', metrics: { likes: 1 }, metrics_at: new Date() }),
    )
    users.push({ attribution: { utm_medium: 'social', utm_source: 'x', utm_content: 'cover-gap' } })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.statusCode).toBe(201)
    expect(seen[0]).toContain('cover gap nobody checks')
    expect(seen[0]).toContain('1 signups/leads')
  })

  it('never leaks another tenant\'s published posts into the prompt', async () => {
    const seen: string[] = []
    const llm = async (_s: string, prompt: string) => {
      seen.push(prompt)
      return 'fresh draft'
    }
    const { app, posts } = await buildApp({ llm })
    posts.push(
      pubPost({ id: 'w1', content: 'Tenant one winner', metrics: { likes: 5 }, metrics_at: new Date() }),
      pubPost({ id: 'w2', content: 'Tenant one runner-up', metrics: { likes: 2 }, metrics_at: new Date() }),
      pubPost({ id: 'other', tenant_id: 'tenant-2', content: 'SECRET_OTHER_TENANT_WINNER', metrics: { likes: 999 }, metrics_at: new Date() }),
    )
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.statusCode).toBe(201)
    expect(seen[0]).toContain('Tenant one winner')
    expect(seen[0]).not.toContain('SECRET_OTHER_TENANT_WINNER')
  })

  it('generates normally when there is no performance history', async () => {
    const seen: string[] = []
    const llm = async (_s: string, prompt: string) => {
      seen.push(prompt)
      return 'fresh draft'
    }
    const { app } = await buildApp({ llm })
    const res = await app.inject({ method: 'POST', url: '/marketing/posts/generate', payload: GEN })
    expect(res.statusCode).toBe(201)
    expect(seen[0]).not.toContain('WINNER')
    expect(seen[0]).not.toContain('FLOP')
    expect(res.json().post.content).toBe('fresh draft')
  })
})
