/**
 * Social Login OAuth Routes — Google & GitHub
 *
 * Google OAuth 2.0:
 * GET  /auth/google/login  — redirect to Google OAuth consent screen
 * GET  /auth/google/callback — handle OAuth callback, create/update user, issue JWT
 *
 * GitHub OAuth 2.0:
 * GET  /auth/github/login  — redirect to GitHub OAuth consent screen
 * GET  /auth/github/callback — handle OAuth callback, create/update user, issue JWT
 *
 * Environment Variables:
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (shared with connectors)
 * GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * STUDIO_URL (for callback redirect)
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import crypto from 'node:crypto'
import { AuthService, createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'auth-social', version: '0.0.0' })

function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const secret = process.env['JWT_SECRET'] ?? 'change-me-in-production'
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyOAuthState(state: string): { provider: string; exp?: number; app?: string } {
  const [body, sig] = state.split('.')
  if (!body || !sig) throw new Error('Malformed OAuth state')
  const secret = process.env['JWT_SECRET'] ?? 'change-me-in-production'
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  if (sig.length !== expected.length) throw new Error('Invalid OAuth state signature')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid OAuth state signature')
  }
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
    provider?: string
    exp?: number
    app?: string
  }
  if (!parsed.provider) throw new Error('OAuth state missing provider')
  if (parsed.exp && Date.now() > parsed.exp) throw new Error('OAuth state expired')
  return { provider: parsed.provider, exp: parsed.exp, app: parsed.app }
}

/**
 * Best-effort `app` extraction for the provider-error redirect path, which
 * fires before the state is otherwise parsed/verified. Not a trust boundary —
 * getCallbackUrl only ever picks from a fixed set of known app destinations,
 * so a forged/garbled state can at worst mis-route to the wrong (still
 * trusted) app, never to an attacker-controlled URL.
 */
function peekApp(state: string | undefined): string | undefined {
  if (!state) return undefined
  try {
    const [body] = state.split('.')
    if (!body) return undefined
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as { app?: string }
    return parsed.app
  } catch {
    return undefined
  }
}

export async function registerSocialAuthRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  db: Db | null,
): Promise<void> {
  if (!db) {
    log.warn({}, 'Social auth routes not registered: database not available')
    return
  }
  const studioUrl = process.env['STUDIO_URL'] ?? 'http://localhost:3000'
  const agentOakUrl = process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002'
  const kairosUrl = process.env['KAIROS_URL'] ?? 'http://localhost:3003'

  // Remove trailing slashes
  const cleanStudioUrl = studioUrl.replace(/\/$/, '')
  const cleanAgentOakUrl = agentOakUrl.replace(/\/$/, '')
  const cleanKairosUrl = kairosUrl.replace(/\/$/, '')

  // The redirect URI is always the API's own callback endpoint — Google
  // redirects back to the API, which then redirects to the appropriate app.
  const apiBaseUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
  const cleanApiBaseUrl = apiBaseUrl.replace(/\/$/, '')
  const googleRedirectUri = process.env['GOOGLE_SOCIAL_REDIRECT_URI'] ?? `${cleanApiBaseUrl}/auth/google/callback`
  const githubRedirectUri = process.env['GITHUB_REDIRECT_URI'] ?? `${cleanApiBaseUrl}/auth/github/callback`

  /**
   * Where the token/tenant fragment (success) or ?error= (failure) lands,
   * keyed by which app initiated the flow (see `app` in the signed OAuth
   * state). kairos-mobile has no web page to land on — expo-web-browser's
   * openAuthSessionAsync watches for a redirect to the app's registered
   * custom scheme (apps/kairos-mobile/app.config.js's `scheme: 'kairos'`)
   * and hands control back to the app with the full URL, fragment included.
   */
  function getCallbackUrl(app?: string): string {
    if (app === 'family') return `${cleanAgentOakUrl}/auth/callback`
    if (app === 'kairos-web') return `${cleanKairosUrl}/auth/callback`
    if (app === 'kairos-mobile') return 'kairos://oauth-callback'
    return `${cleanStudioUrl}/auth/callback`
  }

  /** Same app-keyed resolution as getCallbackUrl, but for the pre-token error path (?error=... instead of #token=...). */
  function getLoginErrorUrl(app: string | undefined, error: string): string {
    if (app === 'kairos-mobile') return `kairos://oauth-callback?error=${error}`
    const base = app === 'family' ? cleanAgentOakUrl : app === 'kairos-web' ? cleanKairosUrl : cleanStudioUrl
    return `${base}/login?error=${error}`
  }

  log.info({ studio_url: studioUrl }, 'STUDIO_URL')
  log.info({ clean_studio_url: cleanStudioUrl }, 'Clean STUDIO_URL')
  log.info({ google_redirect_uri: googleRedirectUri }, 'Google redirect URI')
  log.info({ github_redirect_uri: githubRedirectUri }, 'GitHub redirect URI')

  // ── Google OAuth ─────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { app?: string } }>('/auth/google/login', async (req, reply) => {
    const clientId = process.env['GOOGLE_CLIENT_ID']
    if (!clientId) {
      return reply.status(500).send({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID env var.' })
    }

    const state = signOAuthState({
      provider: 'google',
      exp: Date.now() + 10 * 60 * 1000, // 10 minutes
      app: req.query.app ?? 'studio',
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(googleRedirectUri)}&` +
      `response_type=code&` +
      `scope=openid email profile&` +
      `state=${state}`

    log.info({ google_redirect_uri: googleRedirectUri }, 'Google OAuth redirect URI')
    log.info({ auth_url: authUrl }, 'Google OAuth auth URL')
    return reply.redirect(authUrl)
  })

  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string }
  }>('/auth/google/callback', async (req, reply) => {
    const { code, state, error } = req.query

    if (error) {
      return reply.redirect(getLoginErrorUrl(peekApp(state), error))
    }

    if (!code || !state) {
      return reply.redirect(getLoginErrorUrl(peekApp(state), 'missing_oauth_params'))
    }

    let appRedirectUrl: string
    let app: string | undefined
    try {
      const stateData = verifyOAuthState(state)
      if (stateData.provider !== 'google') {
        return reply.redirect(getLoginErrorUrl(stateData.app, 'invalid_oauth_provider'))
      }
      app = stateData.app
      appRedirectUrl = getCallbackUrl(app)
    } catch (err) {
      return reply.redirect(getLoginErrorUrl(peekApp(state), 'invalid_oauth_state'))
    }

    const clientId = process.env['GOOGLE_CLIENT_ID']
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET']

    if (!clientId || !clientSecret) {
      return reply.redirect(getLoginErrorUrl(app, 'google_oauth_not_configured'))
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: googleRedirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      if (!tokenRes.ok) {
        throw new Error('Google token exchange failed')
      }

      const tokenData = await tokenRes.json() as {
        access_token: string
        id_token?: string
      }

      // Get user info from Google
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userRes.ok) {
        throw new Error('Failed to fetch Google user info')
      }

      const googleUser = await userRes.json() as {
        id: string
        email: string
        name: string
        picture?: string
      }

      // Find or create user
      const usersCol = db.collection('users')
      let user: any = await usersCol.findOne({ 
        $or: [
          { email: googleUser.email.toLowerCase() },
          { external_id: googleUser.id, external_provider: 'google' }
        ]
      })

      if (!user) {
        const tenantId = googleUser.email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '-')

        // OAK-001: without this check, anyone whose OAuth email's local-part
        // happens to collide with an already-claimed tenant slug (e.g. any
        // "sarah@<any domain>" after tenant_id "sarah" is taken) was silently
        // admitted as a brand-new admin of that existing tenant — full
        // read/write on someone else's family. Mirrors the guard
        // auth-users.ts's password-signup path already has (409 "workspace
        // taken") — the OAuth path just never got it. This is a check-then-
        // insert, not a DB-level unique constraint (tenants.tenant_id has no
        // unique index today — see migrate.ts's first migration, which fails
        // on a pre-existing non-unique index of the same auto-generated
        // name), so it's the same level of protection auth-users.ts itself
        // relies on, not stronger.
        const existingTenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
        if (existingTenant) {
          return reply.redirect(getLoginErrorUrl(app, 'workspace_taken'))
        }

        // Create new user
        const userId = crypto.randomBytes(8).toString('hex')

        user = {
          id: userId,
          email: googleUser.email.toLowerCase(),
          name: googleUser.name,
          tenant_id: tenantId,
          password_hash: '',
          salt: '',
          created_at: new Date(),
          avatar_color: '#4285F4', // Google blue
          roles: ['admin'],
          status: 'active',
          failed_login_attempts: 0,
          locked_until: null,
          external_id: googleUser.id,
          external_provider: 'google' as const,
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
          password_reset_token: null,
          password_reset_expires: null,
          updated_at: new Date(),
        }

        await usersCol.insertOne(user)

        await db.collection('tenants').insertOne({
          tenant_id: tenantId,
          name: googleUser.name,
          plan: 'free',
          quotas: {
            events_per_month: 10_000,
            workflows_per_month: 3,
            detectors_max: 10,
            connectors_max: 1,
            users_max: 1,
            llm_tokens_per_month: 100_000,
          },
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
      } else {
        // Update existing user with Google info if needed
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              external_id: googleUser.id,
              external_provider: 'google',
              email_verified: true,
              updated_at: new Date(),
            }
          }
        )
      }

      // Issue JWT token. OAuth sign-in has no "remember me" checkbox, so it
      // gets the same long-lived duration password login gets when the user
      // checks that box — otherwise Google-authenticated sessions would
      // silently expire in 1h while password sessions last 7-30d.
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles,
      }, '30d')

      // Redirect to the appropriate app with token — appRedirectUrl already
      // is the full callback destination (getCallbackUrl), not a bare app
      // base URL, so the fragment appends directly.
      //
      // When the studio is not deployed (STUDIO_URL points to the API itself
      // or localhost), redirect to the API's own Studio home page with the
      // token in the URL fragment. The home page reads the fragment and
      // presents a dashboard instead of a raw token copy page.
      const isStudioDeployed = cleanStudioUrl !== cleanApiBaseUrl
        && !cleanStudioUrl.startsWith('http://localhost')
      if (app === 'studio' && !isStudioDeployed) {
        return reply.redirect(`${cleanApiBaseUrl}/#token=${token}&tenant=${user.tenant_id}`)
      }
      return reply.redirect(`${appRedirectUrl}#token=${token}&tenant=${user.tenant_id}`)
    } catch (err) {
      log.error({ err }, 'Google OAuth error')
      return reply.redirect(getLoginErrorUrl(app, 'oauth_failed'))
    }
  })

  // POST /auth/google/exchange — exchange code for token (called from frontend)
  fastify.post<{ Body: { code: string; state: string } }>('/auth/google/exchange', async (req, reply) => {
    const { code, state } = req.body

    if (!code || !state) {
      return reply.status(400).send({ error: 'Missing code or state' })
    }

    try {
      const stateData = verifyOAuthState(state)
      if (stateData.provider !== 'google') {
        return reply.status(400).send({ error: 'Invalid OAuth provider' })
      }
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid OAuth state' })
    }

    const clientId = process.env['GOOGLE_CLIENT_ID']
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET']

    if (!clientId || !clientSecret) {
      return reply.status(500).send({ error: 'Google OAuth not configured' })
    }

    try {
      // Exchange code for tokens
      log.info({ redirect_uri: googleRedirectUri }, 'Google token exchange - redirectUri')
      log.info({ client_id: clientId }, 'Google token exchange - clientId')
      log.info({ has_client_secret: !!clientSecret }, 'Google token exchange - has clientSecret')

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: googleRedirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      log.info({ status: tokenRes.status }, 'Google token exchange - response status')

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text()
        log.error({ status: tokenRes.status, error: errorText }, 'Google token exchange - error response')
        return reply.status(400).send({ error: 'Google token exchange failed', detail: `${tokenRes.status}: ${errorText}` })
      }

      const tokenData = await tokenRes.json() as {
        access_token: string
        id_token?: string
      }

      // Get user info from Google
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userRes.ok) {
        const errorText = await userRes.text()
        log.error({ status: userRes.status, error: errorText }, 'Google user info fetch - error response')
        return reply.status(400).send({ error: 'Failed to fetch Google user info', detail: `${userRes.status}: ${errorText}` })
      }

      const googleUser = await userRes.json() as {
        id: string
        email: string
        name: string
        picture?: string
      }

      // Find or create user
      const usersCol = db.collection('users')
      let user: any = await usersCol.findOne({ 
        $or: [
          { email: googleUser.email.toLowerCase() },
          { external_id: googleUser.id, external_provider: 'google' }
        ]
      })

      if (!user) {
        const tenantId = googleUser.email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '-')

        // OAK-001 — see the same guard in GET /auth/google/callback above
        // for the full explanation. This route is JSON-only (called
        // directly by the frontend, no browser redirect), so it rejects
        // with the same 409 shape auth-users.ts's password signup uses.
        const existingTenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
        if (existingTenant) {
          return reply.status(409).send({ error: 'That workspace name is already taken. Choose another.' })
        }

        // Create new user
        const userId = crypto.randomBytes(8).toString('hex')

        user = {
          id: userId,
          email: googleUser.email.toLowerCase(),
          name: googleUser.name,
          tenant_id: tenantId,
          password_hash: '',
          salt: '',
          created_at: new Date(),
          avatar_color: '#4285F4', // Google blue
          roles: ['admin'],
          status: 'active',
          failed_login_attempts: 0,
          locked_until: null,
          external_id: googleUser.id,
          external_provider: 'google' as const,
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
          password_reset_token: null,
          password_reset_expires: null,
          updated_at: new Date(),
        }

        await usersCol.insertOne(user)

        await db.collection('tenants').insertOne({
          tenant_id: tenantId,
          name: googleUser.name,
          plan: 'free',
          quotas: {
            events_per_month: 10_000,
            workflows_per_month: 3,
            detectors_max: 10,
            connectors_max: 1,
            users_max: 1,
            llm_tokens_per_month: 100_000,
          },
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
      } else {
        // Update existing user with Google info if needed
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: { 
              external_id: googleUser.id,
              external_provider: 'google',
              email_verified: true,
              updated_at: new Date(),
            } 
          }
        )
      }

      // Issue JWT token. Same long-lived duration as the redirect-flow
      // callback above — see comment there.
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles,
      }, '30d')

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenant_id: user.tenant_id,
          avatar_color: user.avatar_color || '#4285F4',
          active_vertical: user.active_vertical ?? null,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err }, 'Google OAuth exchange error')
      return reply.status(500).send({ error: 'OAuth exchange failed', detail: message })
    }
  })

  // ── GitHub OAuth ────────────────────────────────────────────────────────────

  fastify.get('/auth/github/login', async (_req, reply) => {
    const clientId = process.env['GITHUB_CLIENT_ID']
    if (!clientId) {
      return reply.status(500).send({ error: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID env var.' })
    }

    const state = signOAuthState({
      provider: 'github',
      exp: Date.now() + 10 * 60 * 1000, // 10 minutes
    })

    const authUrl = `https://github.com/login/oauth/authorize?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(githubRedirectUri)}&` +
      `scope=user:email&` +
      `state=${state}`

    return reply.redirect(authUrl)
  })

  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string }
  }>('/auth/github/callback', async (req, reply) => {
    const { code, state, error } = req.query

    if (error) {
      return reply.redirect(`${studioUrl}/login?error=${error}`)
    }

    if (!code || !state) {
      return reply.redirect(`${studioUrl}/login?error=missing_oauth_params`)
    }

    try {
      const stateData = verifyOAuthState(state)
      if (stateData.provider !== 'github') {
        return reply.redirect(`${studioUrl}/login?error=invalid_oauth_provider`)
      }
    } catch (err) {
      return reply.redirect(`${studioUrl}/login?error=invalid_oauth_state`)
    }

    const clientId = process.env['GITHUB_CLIENT_ID']
    const clientSecret = process.env['GITHUB_CLIENT_SECRET']

    if (!clientId || !clientSecret) {
      return reply.redirect(`${studioUrl}/login?error=github_oauth_not_configured`)
    }

    try {
      // Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: githubRedirectUri,
        }),
      })

      if (!tokenRes.ok) {
        throw new Error('GitHub token exchange failed')
      }

      const tokenData = await tokenRes.json() as {
        access_token: string
      }

      // Get user info from GitHub
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      if (!userRes.ok) {
        throw new Error('Failed to fetch GitHub user info')
      }

      const githubUser = await userRes.json() as {
        id: number
        email: string | null
        login: string
        name: string | null
        avatar_url?: string
      }

      // Get primary email if not provided
      let email = githubUser.email
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        if (emailsRes.ok) {
          const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
          const primaryEmail = emails.find(e => e.primary && e.verified)
          email = primaryEmail?.email || `${githubUser.login}@users.noreply.github.com`
        }
      }

      // Find or create user
      const usersCol = db.collection('users')
      let user: any = await usersCol.findOne({ 
        $or: [
          { email: email!.toLowerCase() },
          { external_id: String(githubUser.id), external_provider: 'github' }
        ]
      })

      if (!user) {
        const tenantId = email!.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '-')

        // OAK-001 — see the matching Google guard earlier in this file for
        // the full explanation. This callback redirects the browser, so it
        // rejects via redirect (a JSON body here would just render as text
        // mid redirect chain), matching this handler's existing
        // `${studioUrl}/login?error=...` convention (GitHub's callback has
        // no multi-app `app` param support, unlike Google's).
        const existingTenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
        if (existingTenant) {
          return reply.redirect(`${studioUrl}/login?error=workspace_taken`)
        }

        // Create new user
        const userId = crypto.randomBytes(8).toString('hex')

        user = {
          id: userId,
          email: email!.toLowerCase(),
          name: githubUser.name || githubUser.login,
          tenant_id: tenantId,
          password_hash: '',
          salt: '',
          created_at: new Date(),
          avatar_color: '#24292e', // GitHub dark
          roles: ['admin'],
          status: 'active',
          failed_login_attempts: 0,
          locked_until: null,
          external_id: String(githubUser.id),
          external_provider: 'github' as const,
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
          password_reset_token: null,
          password_reset_expires: null,
          updated_at: new Date(),
        }

        await usersCol.insertOne(user)

        await db.collection('tenants').insertOne({
          tenant_id: tenantId,
          name: githubUser.name || githubUser.login,
          plan: 'free',
          quotas: {
            events_per_month: 10_000,
            workflows_per_month: 3,
            detectors_max: 10,
            connectors_max: 1,
            users_max: 1,
            llm_tokens_per_month: 100_000,
          },
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
      } else {
        // Update existing user with GitHub info if needed
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              external_id: String(githubUser.id),
              external_provider: 'github',
              email_verified: true,
              updated_at: new Date(),
            }
          }
        )
      }

      // Issue JWT token
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles,
      }, '1h')

      // Redirect to Studio with token
      return reply.redirect(`${studioUrl}/auth/callback#token=${token}&tenant=${user.tenant_id}`)
    } catch (err) {
      log.error({ err }, 'GitHub OAuth error')
      return reply.redirect(`${studioUrl}/login?error=oauth_failed`)
    }
  })

  // POST /auth/github/exchange — exchange code for token (called from frontend)
  fastify.post<{ Body: { code: string; state: string } }>('/auth/github/exchange', async (req, reply) => {
    const { code, state } = req.body

    if (!code || !state) {
      return reply.status(400).send({ error: 'Missing code or state' })
    }

    try {
      const stateData = verifyOAuthState(state)
      if (stateData.provider !== 'github') {
        return reply.status(400).send({ error: 'Invalid OAuth provider' })
      }
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid OAuth state' })
    }

    const clientId = process.env['GITHUB_CLIENT_ID']
    const clientSecret = process.env['GITHUB_CLIENT_SECRET']

    if (!clientId || !clientSecret) {
      return reply.status(500).send({ error: 'GitHub OAuth not configured' })
    }

    try {
      // Exchange code for access token
      log.info({ redirect_uri: githubRedirectUri }, 'GitHub token exchange - redirectUri')
      log.info({ client_id: clientId }, 'GitHub token exchange - clientId')
      log.info({ has_client_secret: !!clientSecret }, 'GitHub token exchange - has clientSecret')

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: githubRedirectUri,
        }),
      })

      log.info({ status: tokenRes.status }, 'GitHub token exchange - response status')

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text()
        log.error({ status: tokenRes.status, error: errorText }, 'GitHub token exchange - error response')
        return reply.status(400).send({ error: 'GitHub token exchange failed', detail: `${tokenRes.status}: ${errorText}` })
      }

      const tokenData = await tokenRes.json() as {
        access_token: string
      }

      // Get user info from GitHub
      log.info({ access_token_length: tokenData.access_token.length }, 'GitHub user info fetch - access_token length')
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })

      log.info({ status: userRes.status }, 'GitHub user info fetch - response status')

      if (!userRes.ok) {
        const errorText = await userRes.text()
        log.error({ status: userRes.status, error: errorText }, 'GitHub user info fetch - error response')
        return reply.status(400).send({ error: 'Failed to fetch GitHub user info', detail: `${userRes.status}: ${errorText}` })
      }

      const githubUser = await userRes.json() as {
        id: number
        email: string | null
        login: string
        name: string | null
        avatar_url?: string
      }

      // Get primary email if not provided
      let email = githubUser.email
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        if (emailsRes.ok) {
          const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
          const primaryEmail = emails.find(e => e.primary && e.verified)
          email = primaryEmail?.email || `${githubUser.login}@users.noreply.github.com`
        }
      }

      // Find or create user
      const usersCol = db.collection('users')
      let user: any = await usersCol.findOne({ 
        $or: [
          { email: email!.toLowerCase() },
          { external_id: String(githubUser.id), external_provider: 'github' }
        ]
      })

      if (!user) {
        const tenantId = email!.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '-')

        // OAK-001 — see the matching Google guard earlier in this file for
        // the full explanation. This route is JSON-only (called directly by
        // the frontend, no browser redirect), so it rejects with the same
        // 409 shape auth-users.ts's password signup uses.
        const existingTenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
        if (existingTenant) {
          return reply.status(409).send({ error: 'That workspace name is already taken. Choose another.' })
        }

        // Create new user
        const userId = crypto.randomBytes(8).toString('hex')

        user = {
          id: userId,
          email: email!.toLowerCase(),
          name: githubUser.name || githubUser.login,
          tenant_id: tenantId,
          password_hash: '',
          salt: '',
          created_at: new Date(),
          avatar_color: '#24292e', // GitHub dark
          roles: ['admin'],
          status: 'active',
          failed_login_attempts: 0,
          locked_until: null,
          external_id: String(githubUser.id),
          external_provider: 'github' as const,
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
          password_reset_token: null,
          password_reset_expires: null,
          updated_at: new Date(),
        }

        await usersCol.insertOne(user)

        await db.collection('tenants').insertOne({
          tenant_id: tenantId,
          name: githubUser.name || githubUser.login,
          plan: 'free',
          quotas: {
            events_per_month: 10_000,
            workflows_per_month: 3,
            detectors_max: 10,
            connectors_max: 1,
            users_max: 1,
            llm_tokens_per_month: 100_000,
          },
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
      } else {
        // Update existing user with GitHub info if needed
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              external_id: String(githubUser.id),
              external_provider: 'github',
              email_verified: true,
              updated_at: new Date(),
            }
          }
        )
      }

      // Issue JWT token
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles,
      }, '1h')

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenant_id: user.tenant_id,
          avatar_color: user.avatar_color || '#24292e',
          active_vertical: user.active_vertical ?? null,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err }, 'GitHub OAuth exchange error')
      return reply.status(500).send({ error: 'OAuth exchange failed', detail: message })
    }
  })
}
