/**
 * Staging-only mail sink. In a staging environment, outgoing mail is kept in the
 * staging database instead of being sent, and an automated tester holding the
 * test token can read it back. That lets the confirm-link and approval emails be
 * tested end to end without a real inbox.
 *
 * It must be impossible to switch on anywhere else, so it refuses to start unless
 * the environment is explicitly "staging", a long token is set, and the app
 * address is not a production host. Mail never leaves the database. Only
 * fictional test families belong in staging.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import sgMail, { type MailDataRequired } from '@sendgrid/mail'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'staging-mail-sink', version: '0.0.0' })

const COLLECTION = 'staging_mail'
const KEEP_SECONDS = 7 * 24 * 3600
const MIN_TOKEN_LENGTH = 24
/** Hosts that must never run the sink, whatever the environment label says. */
const PRODUCTION_HOSTS = new Set([
  'lifekeel.co.uk',
  'www.lifekeel.co.uk',
  'app.lifekeel.co.uk',
  'lifekeel.si',
  'www.lifekeel.si',
  'app.lifekeel.si',
])

export interface StagingSinkConfig {
  token: string
}

/** Null when the sink is off. Throws when it is asked for somewhere it must not run. */
export function resolveStagingSink(env: NodeJS.ProcessEnv = process.env): StagingSinkConfig | null {
  if (env['STAGING_MAIL_SINK']?.trim() !== 'on') return null
  if (env['LIFEKEEL_ENVIRONMENT']?.trim() !== 'staging') {
    throw new Error('STAGING_MAIL_SINK may only be on when LIFEKEEL_ENVIRONMENT is "staging"')
  }
  const token = env['STAGING_TEST_TOKEN']?.trim() ?? ''
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`STAGING_TEST_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters`)
  }
  const hosts = [env['LIFEKEEL_URL'], ...(env['LIFEKEEL_APP_HOSTS']?.split(',') ?? [])]
    .map((h) => h?.trim())
    .filter((h): h is string => !!h)
    .map((h) => {
      try {
        return new URL(h.includes('://') ? h : `https://${h}`).hostname.toLowerCase()
      } catch {
        return h.toLowerCase()
      }
    })
  const production = hosts.find((h) => PRODUCTION_HOSTS.has(h))
  if (production) {
    throw new Error(`STAGING_MAIL_SINK refused: ${production} is a production host`)
  }
  return { token }
}

type EmailData = string | { name?: string; email: string }
const addresses = (data: EmailData | EmailData[] | undefined): string[] =>
  (data === undefined ? [] : Array.isArray(data) ? data : [data]).map((d) =>
    (typeof d === 'string' ? d : d.email).trim().toLowerCase(),
  )

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/g
function linksIn(...parts: Array<string | undefined>): string[] {
  const found = parts.flatMap((p) => p?.match(URL_PATTERN) ?? [])
  return [...new Set(found.map((l) => l.replace(/[.,;]+$/, '')))]
}

let indexed = false

/** Replace `sgMail.send` so mail is stored, not sent. Returns false when the sink is off. */
export function installStagingMailSink(
  getDatabase: () => Promise<Db>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!resolveStagingSink(env)) return false
  const send: typeof sgMail.send = async (data) => {
    const db = await getDatabase()
    const col = db.collection(COLLECTION)
    if (!indexed) {
      await col.createIndex({ received_at: 1 }, { expireAfterSeconds: KEEP_SECONDS })
      await col.createIndex({ to: 1, received_at: -1 })
      indexed = true
    }
    for (const m of (Array.isArray(data) ? data : [data]) as MailDataRequired[]) {
      await col.insertOne({
        to: addresses(m.to),
        from: typeof m.from === 'string' ? m.from : m.from.email,
        subject: m.subject ?? '',
        text: m.text ?? '',
        links: linksIn(m.text, m.html),
        received_at: new Date(),
      })
    }
    return [{ statusCode: 202, body: {}, headers: {} }, {}]
  }
  sgMail.send = send
  log.warn({}, 'STAGING mail sink on — outgoing mail is stored in the database, not sent')
  return true
}

const digest = (s: string) => createHash('sha256').update(s).digest()

/** Registers GET /staging/mail only when the sink is on. */
export function registerStagingMailRoutes(
  app: FastifyInstance,
  getDatabase: () => Promise<Db>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = resolveStagingSink(env)
  if (!cfg) return false
  app.get<{ Querystring: { to?: string; since?: string; limit?: string } }>(
    '/staging/mail',
    async (req, reply) => {
      const sent = String(req.headers['x-staging-token'] ?? '')
      if (!timingSafeEqual(digest(sent), digest(cfg.token))) {
        return reply.code(401).send({ error: 'Invalid token' })
      }
      const to = req.query.to?.trim().toLowerCase()
      if (!to) return reply.code(400).send({ error: 'to is required' })
      const since = req.query.since ? new Date(req.query.since) : null
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
      const rows = await (
        await getDatabase()
      )
        .collection(COLLECTION)
        .find({
          to,
          ...(since && !Number.isNaN(since.getTime()) ? { received_at: { $gt: since } } : {}),
        })
        .sort({ received_at: -1 })
        .limit(limit)
        .toArray()
      return {
        messages: rows.map((r) => ({
          id: String(r['_id']),
          to: r['to'],
          from: r['from'],
          subject: r['subject'],
          text: r['text'],
          links: r['links'],
          received_at: r['received_at'],
        })),
      }
    },
  )
  return true
}
