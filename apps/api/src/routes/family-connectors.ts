/**
 * Family Connector Routes — status, generic email (IMAP) connect/scan/
 * disconnect.
 *
 * GET  /connectors/status               — list all family-relevant connectors with connection state
 * POST /connectors/email/credentials    — connect any email provider via IMAP (tests the login first)
 * POST /connectors/email/scan           — trigger an immediate scan of the connected mailbox
 * POST /connectors/:id/disconnect       — revoke connector access
 *
 * Previously this only offered Gmail via OAuth — a per-provider integration
 * that needs its own app registration and consent flow per email service.
 * IMAP is the one protocol virtually every provider (Gmail, Outlook, Yahoo,
 * iCloud, a company's own mail server) speaks the same way, so a single
 * generic connector covers all of them with one code path instead of one
 * per provider.
 *
 * These routes sit alongside the existing /connectors/* routes from
 * connector-credentials.ts but provide a family-app-specific view that
 * returns the connector list in the format the family frontend expects.
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from
 * body. The IMAP password is encrypted at rest (encryptIfNeeded) and never
 * echoed back in any response.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { createLogger, getTenantCollection, encryptIfNeeded } from '@lifekeel/platform'
import { testImapConnection } from '../email/imap-client.js'
import { findProviderPreset } from '../email/providers.js'
import { scanTenantInbox } from '../jobs/email-scan.js'
import {
  ProviderAuthError,
  accountInfoAvailable,
  resolveAccountInfoProvider,
  sandboxAccountInfoAllowed,
} from '../open-banking/providers.js'
import { syncAccountInfo, type ExternalAccountDoc } from '../open-banking/sync.js'

const log = createLogger({ service: 'family-connectors', version: '0.0.0' })

// Trading212/Zerodha deliberately excluded — not offered in the family app.
// Both are wired end-to-end at the platform level (connector-credentials.ts)
// but their sync definitions (connectors/trading-212.yaml, zerodha.yaml) are
// status: planned (Trading212's API is beta and personal-single-tenant-scoped;
// Zerodha needs per-tenant Kite app registration plus a static egress IP for
// order placement) — a trading-vertical concern, not a family net-worth one.
const FAMILY_CONNECTORS = [
  { id: 'email', name: 'Email', category: 'email', comingSoon: false },
  // PRD-133: read-only account-info plumbing is real — sandbox provider in
  // non-production, TrueLayer token mode behind OPEN_BANKING_TOKENS=1 until
  // the AISP OAuth consent flow is onboarded. comingSoon is computed live
  // so a deployed build without a provider keeps the honest label.
  { id: 'open-banking', name: 'Open Banking', category: 'bank', comingSoon: true },
] as const

interface EmailCredentialsBody {
  provider?: string
  host?: string
  port?: number
  useTls?: boolean
  username: string
  password: string
}

export function registerFamilyConnectorRoutes(
  fastify: FastifyInstance,
  db: Db,
): void {
  // ── GET /connectors/status ──────────────────────────────────────────────
  fastify.get('/connectors/status', async (req) => {
    const { tenant_id } = req.authContext

    const credentials = await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id)
      .find()
      .toArray()

    const connectedMap = new Map<string, { connected: boolean; lastSync?: string }>()
    // The Gmail OAuth grant is stored twice (connector 'gmail' by the
    // platform, mirrored as 'email' for the family scanner); the token
    // refresher flags needs_reauth on whichever it tried to refresh.
    const needsReauth = credentials.some(
      (c: Record<string, unknown>) => (c['connector_id'] === 'gmail' || c['connector_id'] === 'email') && c['needs_reauth'] === true,
    )
    for (const cred of credentials) {
      const lastSync = (cred['last_synced_at'] ?? cred['updated_at']) as Date | undefined
      connectedMap.set(cred['connector_id'] as string, {
        connected: true,
        lastSync: lastSync?.toISOString(),
      })
    }

    return {
      connectors: FAMILY_CONNECTORS.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        comingSoon: c.id === 'open-banking' ? !accountInfoAvailable() : c.comingSoon,
        connected: connectedMap.get(c.id)?.connected ?? false,
        lastSync: connectedMap.get(c.id)?.lastSync,
        ...(c.id === 'email' && connectedMap.get(c.id)?.connected && needsReauth ? { needsReauth: true } : {}),
        ...(c.id === 'open-banking' && credentials.some((x: Record<string, unknown>) => x['connector_id'] === 'open-banking' && x['needs_reauth'] === true)
          ? { needsReauth: true }
          : {}),
      })),
    }
  })

  // ── POST /connectors/email/credentials ──────────────────────────────────
  // Connects any IMAP-speaking email provider. Tests the login for real
  // before saving — the same "validate before saving" pattern
  // connector-credentials.ts uses for API-key connectors — so a typo'd
  // password fails immediately with a clear error instead of silently
  // saving a connection that will never sync anything.
  fastify.post<{ Body: EmailCredentialsBody }>('/connectors/email/credentials', async (req, reply) => {
    const { tenant_id } = req.authContext
    const body = req.body

    if (!body.username || !body.password) {
      return reply.status(400).send({ error: 'username and password are required' })
    }

    const preset = findProviderPreset(body.provider)
    const host = body.host || preset?.host
    const port = body.port || preset?.port
    const useTls = body.useTls ?? preset?.useTls ?? true

    if (!host || !port) {
      return reply.status(400).send({ error: 'host and port are required (or pass a known provider id)' })
    }

    const testResult = await testImapConnection({ host, port, useTls, username: body.username, password: body.password })
    if (!testResult.success) {
      return reply.status(422).send({
        error: 'Could not connect with those details — check the host, port, and password.',
        detail: testResult.message,
        code: 'CREDENTIALS_REJECTED',
      })
    }

    const credentialDoc = {
      tenant_id,
      connector_id: 'email',
      auth_type: 'imap',
      username: body.username,
      password: encryptIfNeeded(body.password),
      extra: { host, port, use_tls: useTls, provider: body.provider ?? 'custom' },
      updated_at: new Date(),
    }
    await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id).updateOne(
      { connector_id: 'email' },
      { $set: credentialDoc },
      { upsert: true },
    )

    log.info({ tenant_id, provider: body.provider ?? 'custom' }, 'Email connector connected')

    // Kick off an immediate scan in the background so the Inbox isn't empty
    // until the next 15-minute cron pass — mirrors connector-credentials.ts
    // triggering a backfill right after a connector is saved.
    scanTenantInbox(db, tenant_id, credentialDoc).catch((err) => {
      log.error({ err, tenant_id }, 'Initial email scan failed')
    })

    return { ok: true, connected: true }
  })

  // ── POST /connectors/email/scan ─────────────────────────────────────────
  // Manual "scan now" — also what the initial connect triggers in the
  // background above, exposed here so the user can re-trigger it from the
  // Inbox without waiting for the cron.
  // Optional body { days } runs a one-off targeted look-back for policy
  // mail (capped at 365) instead of the incremental scan.
  fastify.post<{ Body?: { days?: number } }>('/connectors/email/scan', async (req, reply) => {
    const { tenant_id } = req.authContext
    const credentialDoc = await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id).findOne({
      connector_id: 'email',
    })
    if (!credentialDoc) {
      return reply.status(404).send({ error: 'No email connector connected' })
    }

    const days = Number(req.body?.days)
    const lookBackDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 365) : undefined
    const result = await scanTenantInbox(
      db,
      tenant_id,
      credentialDoc as Parameters<typeof scanTenantInbox>[2],
      lookBackDays !== undefined ? { lookBackDays } : {},
    )
    return result
  })

  // ── POST /connectors/open-banking/credentials ──────────────────────────
  // PRD-133: read-only account-info connect. Same validate-before-saving
  // posture as IMAP — the provider's own listAccounts is the test, so a
  // bad token fails here rather than on the first sync. Token encrypted at
  // rest; never echoed back.
  const OpenBankingCredsSchema = z.object({
    provider: z.enum(['sandbox', 'truelayer']),
    accessToken: z.string().max(4096).optional(),
  })

  fastify.post('/connectors/open-banking/credentials', async (req, reply) => {
    const { tenant_id } = req.authContext
    const parsed = OpenBankingCredsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'provider must be "sandbox" or "truelayer"' })
    }
    const { provider: providerId, accessToken } = parsed.data

    if (providerId === 'sandbox' && !sandboxAccountInfoAllowed()) {
      return reply.status(403).send({ error: 'Sandbox banking is not available in this environment' })
    }
    if (providerId === 'truelayer' && process.env['OPEN_BANKING_TOKENS'] !== '1') {
      return reply.status(503).send({ error: 'Bank connections need a regulated partner that is not onboarded yet — add accounts manually in your Financial Profile for now' })
    }

    const provider = resolveAccountInfoProvider(providerId)
    if (!provider) return reply.status(400).send({ error: `Unknown provider "${providerId}"` })

    const credential = { provider: providerId, access_token: accessToken }
    try {
      await provider.listAccounts(credential)
    } catch (err) {
      if (err instanceof ProviderAuthError) {
        return reply.status(422).send({ error: err.message, code: 'CREDENTIALS_REJECTED' })
      }
      return reply.status(502).send({ error: 'The account provider could not be reached — try again in a moment' })
    }

    const credDoc = {
      tenant_id,
      connector_id: 'open-banking',
      auth_type: 'account_info',
      provider: providerId,
      ...(accessToken ? { access_token: encryptIfNeeded(accessToken) } : {}),
      needs_reauth: false,
      updated_at: new Date(),
    }
    await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id).updateOne(
      { connector_id: 'open-banking' },
      { $set: credDoc },
      { upsert: true },
    )

    const sync = await syncAccountInfo(db, tenant_id, credDoc)
    log.info({ tenant_id, provider: providerId, accounts: sync.accounts }, 'Open Banking connector connected')

    return { ok: true, connected: true, accounts: sync.accounts ?? 0 }
  })

  // ── POST /connectors/open-banking/sync ──────────────────────────────────
  fastify.post('/connectors/open-banking/sync', async (req, reply) => {
    const { tenant_id } = req.authContext
    const credDoc = await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id)
      .findOne({ connector_id: 'open-banking' })
    if (!credDoc) return reply.status(404).send({ error: 'No bank connector connected' })

    const result = await syncAccountInfo(db, tenant_id, credDoc)
    if (!result.ok && result.needsReauth) {
      return reply.status(401).send({ error: result.error, code: 'NEEDS_REAUTH' })
    }
    if (!result.ok) return reply.status(502).send({ error: result.error ?? 'Sync failed' })
    return result
  })

  // ── GET /connectors/open-banking/accounts ───────────────────────────────
  // The synced read model — what a real AISP feed would keep current.
  fastify.get('/connectors/open-banking/accounts', async (req) => {
    const { tenant_id } = req.authContext
    const docs = await getTenantCollection<ExternalAccountDoc>(db, 'external_accounts', tenant_id)
      .find({}).toArray()
    return {
      accounts: (docs as ExternalAccountDoc[]).map((a) => ({
        id: a.provider_account_id,
        provider: a.provider,
        name: a.display_name,
        type: a.account_type,
        currency: a.currency,
        balance_minor: a.balance_minor,
        synced_at: a.synced_at instanceof Date ? a.synced_at.toISOString() : a.synced_at,
      })),
    }
  })

  // ── POST /connectors/:id/disconnect ─────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/connectors/:id/disconnect', async (req, reply) => {
    const { tenant_id } = req.authContext
    const connectorId = req.params.id

    const result = await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenant_id).deleteOne({
      connector_id: connectorId,
    }) as { deletedCount?: number }

    if (result.deletedCount === 0) {
      return reply.status(404).send({ error: 'Connector was not connected' })
    }

    log.info({ connectorId, tenant_id }, 'Connector disconnected')

    return { success: true }
  })
}
