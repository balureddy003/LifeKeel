/**
 * SSO routes — OIDC + SAML skeleton.
 * When env vars are missing, routes return helpful config hints.
 *
 * OIDC:  Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI
 *        OIDC_REDIRECT_URI should point to API server: http://localhost:3001/auth/sso/oidc/callback
 * SAML:  Set SAML_IDP_URL, SAML_ENTITY_ID, SAML_CERT
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { AuthService, RoleResolver, type SsoRoleMapping } from '@kairos/platform'

const ENV_OIDC_ISSUER       = process.env['OIDC_ISSUER']       ?? ''
const ENV_OIDC_CLIENT_ID    = process.env['OIDC_CLIENT_ID']    ?? ''
const ENV_OIDC_CLIENT_SECRET= process.env['OIDC_CLIENT_SECRET']?? ''
const ENV_OIDC_REDIRECT_URI = process.env['OIDC_REDIRECT_URI'] ?? ''
const ENV_SAML_IDP_URL      = process.env['SAML_IDP_URL']      ?? ''
const ENV_SAML_ENTITY_ID    = process.env['SAML_ENTITY_ID']    ?? ''
const ENV_SAML_CERT         = process.env['SAML_CERT']        ?? ''

function missingEnv(vars: string[]): string[] {
  return vars.filter(v => !process.env[v])
}

interface SsoSettingsDoc {
  tenant_id: string
  oidc_issuer?: string
  oidc_client_id?: string
  oidc_client_secret_enc?: string
  oidc_redirect_uri?: string
  saml_idp_url?: string
  saml_entity_id?: string
  saml_cert_enc?: string
  enabled: boolean
}

async function getSsoConfig(db: Db | undefined, tenantId: string) {
  const empty = {
    oidcIssuer: ENV_OIDC_ISSUER,
    oidcClientId: ENV_OIDC_CLIENT_ID,
    oidcClientSecret: ENV_OIDC_CLIENT_SECRET,
    oidcRedirectUri: ENV_OIDC_REDIRECT_URI,
    samlIdpUrl: ENV_SAML_IDP_URL,
    samlEntityId: ENV_SAML_ENTITY_ID,
    samlCert: ENV_SAML_CERT,
    enabled: false,
  }
  if (!db) return empty

  const col = db.collection<SsoSettingsDoc>('tenant_sso_settings')
  const doc = await col.findOne({ tenant_id: tenantId })
  if (!doc || !doc.enabled) return empty

  return {
    oidcIssuer: doc.oidc_issuer || ENV_OIDC_ISSUER,
    oidcClientId: doc.oidc_client_id || ENV_OIDC_CLIENT_ID,
    oidcClientSecret: doc.oidc_client_secret_enc || ENV_OIDC_CLIENT_SECRET,
    oidcRedirectUri: doc.oidc_redirect_uri || ENV_OIDC_REDIRECT_URI,
    samlIdpUrl: doc.saml_idp_url || ENV_SAML_IDP_URL,
    samlEntityId: doc.saml_entity_id || ENV_SAML_ENTITY_ID,
    samlCert: doc.saml_cert_enc || ENV_SAML_CERT,
    enabled: doc.enabled,
  }
}

export function registerSsoRoutes(fastify: FastifyInstance, auth: AuthService, db?: Db): void {
  const roleResolver = new RoleResolver()

  // GET /auth/sso/providers — list configured providers
  fastify.get('/auth/sso/providers', async (req) => {
    const tenantId = (req as any).authContext?.tenant_id ?? 'default'
    const cfg = await getSsoConfig(db, tenantId)
    return {
      providers: [
        {
          id: 'oidc',
          name: 'OpenID Connect',
          configured: !!(cfg.oidcIssuer && cfg.oidcClientId),
          login_url: '/auth/sso/oidc/login',
          missing_env: missingEnv(['OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','OIDC_REDIRECT_URI']),
        },
        {
          id: 'saml',
          name: 'SAML 2.0',
          configured: !!(cfg.samlIdpUrl && cfg.samlEntityId),
          login_url: '/auth/sso/saml/login',
          missing_env: missingEnv(['SAML_IDP_URL','SAML_ENTITY_ID','SAML_CERT']),
        },
      ],
    }
  })

  // GET /auth/sso/oidc/login — redirect to OIDC provider
  fastify.get('/auth/sso/oidc/login', async (_req, reply) => {
    if (!ENV_OIDC_ISSUER || !ENV_OIDC_CLIENT_ID) {
      return reply.status(501).send({
        error: 'OIDC SSO not configured',
        hint: 'Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI env vars',
      })
    }

    const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64url')
    const params = new URLSearchParams({
      client_id:     ENV_OIDC_CLIENT_ID,
      redirect_uri:  ENV_OIDC_REDIRECT_URI,
      response_type: 'code',
      scope:         'openid email profile',
      state,
    })

    // Construct OIDC auth URL (standard OpenID Connect)
    const authUrl = `${ENV_OIDC_ISSUER.replace(/\/$/, '')}/authorize?${params}`
    return reply.redirect(authUrl)
  })

  // GET /auth/sso/oidc/callback — exchange code for token, issue Kairos JWT
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string }
  }>('/auth/sso/oidc/callback', async (req, reply) => {
    const { code, error, error_description } = req.query

    if (error) {
      return reply.status(400).send({ error, description: error_description })
    }

    if (!ENV_OIDC_ISSUER || !ENV_OIDC_CLIENT_ID || !ENV_OIDC_CLIENT_SECRET || !ENV_OIDC_REDIRECT_URI) {
      return reply.status(501).send({ error: 'OIDC SSO not configured' })
    }

    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' })
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(`${ENV_OIDC_ISSUER.replace(/\/$/, '')}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  ENV_OIDC_REDIRECT_URI,
          client_id:     ENV_OIDC_CLIENT_ID,
          client_secret: ENV_OIDC_CLIENT_SECRET,
        }),
      })

      if (!tokenRes.ok) {
        return reply.status(400).send({ error: 'Token exchange failed', status: tokenRes.status })
      }

      const tokenData = await tokenRes.json() as {
        access_token: string; id_token?: string; token_type: string
      }

      // Decode id_token (JWT) to get user claims — no verification for now
      // In production: verify signature against OIDC provider's JWKS
      let userId = 'sso_user'
      let tenantId = 'sso_tenant'
      let email = ''
      let groups: string[] = []

      if (tokenData.id_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(tokenData.id_token.split('.')[1]!, 'base64url').toString()
          ) as { sub?: string; email?: string; tenant_id?: string; org_id?: string; groups?: string[]; kairos_roles?: string[] }
          userId = payload.sub ?? userId
          email = payload.email ?? ''
          tenantId = payload.tenant_id ?? payload.org_id ?? tenantId
          groups = payload.kairos_roles ?? payload.groups ?? []
        } catch { /* use defaults */ }
      }

      const tenant = db ? await db.collection('tenants').findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] }) : null
      const user = db ? await db.collection('users').findOne({ tenant_id: tenantId, id: userId }) : null
      const roles = roleResolver.resolve({
        ...(user?.['override_role'] ? { override_role: user['override_role'] } : {}),
        idp_claim_values: groups,
        ...(tenant?.['sso_role_mapping'] ? { mapping: tenant['sso_role_mapping'] as SsoRoleMapping } : {}),
      })
      if (db) {
        await db.collection('users').updateOne(
          { tenant_id: tenantId, id: userId },
          { $set: { tenant_id: tenantId, id: userId, email, roles, status: 'active', identity_source: 'oidc', updated_at: new Date() } },
          { upsert: true },
        )
      }
      const kairosToken = await auth.sign({
        sub: userId,
        tenant_id: tenantId,
        roles,
        ...(email ? { email } : {}),
      }, '1h')

      // Redirect to Studio with token in URL fragment (Studio reads from fragment)
      const studioUrl = process.env['STUDIO_URL'] ?? 'http://localhost:3000'
      return reply.redirect(`${studioUrl}/auth/callback#token=${kairosToken}&tenant=${tenantId}`)
    } catch (err) {
      return reply.status(500).send({ error: 'OIDC callback failed', detail: String(err) })
    }
  })

  // GET /auth/sso/saml/login — redirect to SAML IdP
  fastify.get('/auth/sso/saml/login', async (_req, reply) => {
    if (!ENV_SAML_IDP_URL || !ENV_SAML_ENTITY_ID) {
      return reply.status(501).send({
        error: 'SAML SSO not configured',
        hint: 'Set SAML_IDP_URL, SAML_ENTITY_ID, SAML_CERT env vars',
      })
    }

    // Minimal SAML AuthRequest redirect (unsigned for skeleton)
    const id = `_kairos_${Date.now()}`
    const issueInstant = new Date().toISOString()
    const authnRequest = `
<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${id}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  AssertionConsumerServiceURL="${process.env['SAML_ACS_URL'] ?? 'http://localhost:3001/auth/sso/saml/callback'}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${ENV_SAML_ENTITY_ID}</saml:Issuer>
</samlp:AuthnRequest>`.trim()

    const encoded = Buffer.from(authnRequest).toString('base64')
    const params = new URLSearchParams({ SAMLRequest: encoded })
    return reply.redirect(`${ENV_SAML_IDP_URL}?${params}`)
  })

  // POST /auth/sso/saml/callback — consume SAML assertion
  fastify.post<{ Body: { SAMLResponse?: string } }>(
    '/auth/sso/saml/callback', async (req, reply) => {
      if (!req.body?.SAMLResponse) {
        return reply.status(400).send({ error: 'Missing SAMLResponse' })
      }

      try {
        // Decode (in production: verify XML signature with SAML_CERT)
        const xml = Buffer.from(req.body.SAMLResponse, 'base64').toString('utf8')

        // Extract NameID and attributes from assertion (minimal regex-based parse)
        const nameIdMatch = xml.match(/<(?:saml:)?NameID[^>]*>([^<]+)</)
        const emailMatch  = xml.match(/Name="email"[^>]*>\s*<[^>]+Value>([^<]+)/)
        const tenantMatch = xml.match(/Name="tenant_id"[^>]*>\s*<[^>]+Value>([^<]+)/)

        const userId   = nameIdMatch?.[1] ?? 'saml_user'
        const email    = emailMatch?.[1] ?? ''
        const tenantId = tenantMatch?.[1] ?? 'saml_tenant'
        const tenant = db ? await db.collection('tenants').findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] }) : null
        const user = db ? await db.collection('users').findOne({ tenant_id: tenantId, id: userId }) : null
        const groupValues = [...xml.matchAll(/Name="groups"[^>]*>\s*<[^>]+Value>([^<]+)/g)].map(match => match[1]!)
        const roles = roleResolver.resolve({
          ...(user?.['override_role'] ? { override_role: user['override_role'] } : {}),
          idp_claim_values: groupValues,
          ...(tenant?.['sso_role_mapping'] ? { mapping: tenant['sso_role_mapping'] as SsoRoleMapping } : {}),
        })

        const kairosToken = await auth.sign({
          sub: userId,
          tenant_id: tenantId,
          roles,
          ...(email ? { email } : {}),
        }, '1h')

        const studioUrl = process.env['STUDIO_URL'] ?? 'http://localhost:3000'
        return reply.redirect(`${studioUrl}/auth/callback#token=${kairosToken}&tenant=${tenantId}`)
      } catch (err) {
        return reply.status(500).send({ error: 'SAML callback failed', detail: String(err) })
      }
    }
  )
}
