/**
 * Email scanning pipeline — the piece family-inbox.ts's own comment
 * described ("gmail connector → classify → summarize → create inbox item")
 * but that never actually existed. Runs against any IMAP-connected mailbox
 * (see email/imap-client.ts) on a schedule and on-demand right after connect.
 *
 * For each new message: classify it (financial vs not), and if financial,
 * create an Inbox item. If it's financial AND carries a document-like
 * attachment (PDF/image), store that attachment through the exact same
 * GridFS + OCR pipeline document uploads use (documents.ts / ocr/extract.ts)
 * — so an insurance renewal emailed as a PDF gets the same "Apply to
 * Financial Profile" suggestion flow a manually uploaded document does.
 */

import { randomUUID } from 'node:crypto'
import { GridFSBucket, type Db } from 'mongodb'
import {
  createLogger,
  getTenantCollection,
  encryptIfNeeded,
  decryptIfNeeded,
} from '@lifekeel/platform'
import {
  fetchRecentEmails,
  searchPolicyEmails,
  type ImapCredentials,
} from '../email/imap-client.js'
import { refreshGoogleAccessToken } from '../email/gmail-oauth.js'
import { classifyEmail } from '../email/classify.js'
import { localDecisionFromEnv, emailEncoderFromEnv } from '../local-model.js'
import { taskLlm, taskDecide } from '../ai/task-gateway.js'
import { recordEmailClassifyFailure, recordEmailEncoderOutcome } from '../routes/metrics.js'
import { acquireCronLock, releaseCronLock } from './cron-lock.js'
import { processDocument } from '../ocr/extract.js'
import { effectivePlan, hasFeature } from '../entitlements.js'
import type { InboxItemDoc } from '../routes/family-inbox.js'

const log = createLogger({ service: 'email-scan', version: '0.0.0' })

const DOCUMENT_MIME_ALLOWLIST = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

type EmailConnectorCredentialDoc = Record<string, unknown> & {
  tenant_id: string
  connector_id: string
  auth_type: string
  username?: string
  password?: string
  extra?: {
    host?: string
    port?: number
    use_tls?: boolean
    access_token?: string
    refresh_token?: string
    token_expires_at?: Date | string
  }
  last_synced_uid?: number
  /** When the queue fan-out last enqueued this mailbox (see enqueueConnectedInboxScans). */
  scan_enqueued_at?: Date
  last_synced_at?: Date
}

// Refresh a bit early rather than right at expiry — avoids a scan starting
// mid-connection with a token that goes stale a few seconds into the IMAP
// session.
const TOKEN_REFRESH_SKEW_MS = 60_000

/** For `auth_type: 'oauth'` (currently Gmail only), refreshes the access
 * token when it's expired or close to it, and persists the new token so
 * the next scan doesn't have to refresh again. Returns null (same as a
 * missing password) if there's no usable refresh_token — the connector
 * was connected but Google never issued one, or it's been revoked. */
async function resolveOAuthAccessToken(
  db: Db,
  doc: EmailConnectorCredentialDoc,
): Promise<string | null> {
  const accessToken = decryptIfNeeded(doc.extra?.access_token)
  const expiresAt = doc.extra?.token_expires_at ? new Date(doc.extra.token_expires_at) : null
  if (accessToken && expiresAt && expiresAt.getTime() - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return accessToken
  }

  const refreshToken = decryptIfNeeded(doc.extra?.refresh_token)
  const clientId = process.env['GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET']
  if (!refreshToken || !clientId || !clientSecret) return null

  const refreshed = await refreshGoogleAccessToken(refreshToken, clientId, clientSecret)
  if (!refreshed) return null

  await getTenantCollection<EmailConnectorCredentialDoc>(
    db,
    'connector_credentials',
    doc.tenant_id,
  ).updateOne(
    { connector_id: doc.connector_id },
    {
      $set: {
        'extra.access_token': encryptIfNeeded(refreshed.accessToken),
        'extra.token_expires_at': new Date(Date.now() + refreshed.expiresIn * 1000),
      },
    },
  )
  return refreshed.accessToken
}

async function toImapCredentials(
  db: Db,
  doc: EmailConnectorCredentialDoc,
): Promise<ImapCredentials | null> {
  const host = doc.extra?.host
  const port = doc.extra?.port
  if (!host || !port || !doc.username) return null

  if (doc.auth_type === 'oauth') {
    const accessToken = await resolveOAuthAccessToken(db, doc)
    if (!accessToken) return null
    return { host, port, useTls: doc.extra?.use_tls ?? true, username: doc.username, accessToken }
  }

  const password = decryptIfNeeded(doc.password)
  if (!password) return null
  return { host, port, useTls: doc.extra?.use_tls ?? true, username: doc.username, password }
}

export interface ScanResult {
  scanned: number
  inboxItemsCreated: number
  documentsCreated: number
  /** Emails the model could not classify this scan; the cursor is held so they are retried. */
  classificationRetries?: number
}

/** Stop a scan after this many failures in a row: the model is down, so each further email would only burn a full timeout. */
const MAX_CONSECUTIVE_CLASSIFY_FAILURES = 3
/** An email that fails this many scans while others succeed is a poison pill, not an outage: give up so it cannot hold the cursor forever. */
const MAX_CLASSIFY_ATTEMPTS = 5

/**
 * Counts one failed attempt for a message and returns the new total. Only called
 * when other emails in the same scan succeeded, which is what tells a poison
 * pill apart from a model outage (an outage must never use up the retries).
 */
async function recordClassifyFailure(db: Db, tenantId: string, messageId: string): Promise<number> {
  const doc = await db
    .collection('email_classify_failures')
    .findOneAndUpdate(
      { tenant_id: tenantId, email_message_id: messageId },
      { $inc: { attempts: 1 }, $set: { last_failed_at: new Date() } },
      { upsert: true, returnDocument: 'after' },
    )
  return (doc?.['attempts'] as number | undefined) ?? 1
}

/**
 * Scans one tenant's connected mailbox. Safe to call repeatedly — dedupes
 * inbox items by email_message_id and advances the UID cursor so a repeat
 * scan only processes genuinely new mail.
 */
export async function scanTenantInbox(
  db: Db,
  tenantId: string,
  credentialDoc: EmailConnectorCredentialDoc,
  opts: { lookBackDays?: number } = {},
): Promise<ScanResult> {
  // Plan gate: classifyEmail's LLM call produces ai_summary — the
  // email_ai_summary entitlement — and attachment OCR is
  // document_ai_extraction. Connecting the mailbox stays free on every
  // plan, but the AI-powered inbox is paid, so a free tenant's scan is a
  // no-op: no LLM/vision spend, and the UID cursor is left untouched so
  // upgrading later backfills the mail received while on the free plan
  // (dedup by email_message_id makes that backfill safe).
  const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
  const plan = effectivePlan(tenant)
  if (!hasFeature('email_ai_summary', plan)) {
    return { scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 }
  }
  const docExtractionEnabled = hasFeature('document_ai_extraction', plan)

  const creds = await toImapCredentials(db, credentialDoc)
  if (!creds) {
    return { scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 }
  }

  // A look-back is a one-off targeted search for policy mail; it must not
  // move the incremental cursor, or mail newer than the search window's
  // newest hit but older than the cursor's next scan would be skipped.
  const lookBack = opts.lookBackDays !== undefined
  const { emails, highestUid } = lookBack
    ? {
        emails: await searchPolicyEmails(creds, { sinceDays: opts.lookBackDays! }),
        highestUid: undefined,
      }
    : await fetchRecentEmails(creds, { sinceUid: credentialDoc.last_synced_uid, limit: 25 })

  const result: ScanResult = { scanned: emails.length, inboxItemsCreated: 0, documentsCreated: 0 }
  if (emails.length === 0) return result

  // Governed paths (intent 01): the cloud text call and the self-hosted
  // classifiers all resolve email.policy_relevance.v1 / document.extract.v1
  // — model allowlist, input ceiling, deadline, breaker, guards.
  const llm = taskLlm('email.policy_relevance.v1', tenantId)
  const decide = taskDecide(
    'email.policy_relevance.v1',
    tenantId,
    localDecisionFromEnv('classifier'),
  )
  const ocrDecide = taskDecide('document.extract.v1', tenantId, localDecisionFromEnv('ocr'))
  const encoderCfg = emailEncoderFromEnv()
  const encoder = encoderCfg ? { ...encoderCfg, onOutcome: recordEmailEncoderOutcome } : undefined
  const inboxItems = db.collection<InboxItemDoc>('inbox_items')
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })
  const documents = getTenantCollection<Record<string, unknown>>(db, 'documents', tenantId)

  // Emails the model could not classify. The cursor is held just before the
  // earliest of them so the next scan retries it instead of skipping it forever.
  const failedEmails: Array<{ uid: number; messageId: string }> = []
  let classifiedOk = 0
  let consecutiveFailures = 0

  for (const email of emails) {
    const existing = await inboxItems.findOne({
      tenant_id: tenantId,
      email_message_id: email.messageId,
    })
    if (existing) continue

    const classification = await classifyEmail(llm, email, { decide, prefilter: true, encoder })
    if (classification.failed) {
      recordEmailClassifyFailure()
      failedEmails.push({ uid: email.uid, messageId: email.messageId })
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_CLASSIFY_FAILURES) {
        log.warn(
          { tenantId, consecutiveFailures },
          'Classifier failing repeatedly — stopping scan early; remaining mail is retried next scan',
        )
        break
      }
      continue
    }
    consecutiveFailures = 0
    classifiedOk += 1
    if (!classification.isFinancial) continue

    const itemId = randomUUID()
    // The findOne check above isn't atomic with this insert — two scans
    // running close together (e.g. the automatic post-connect scan and a
    // manual "Scan now" click moments later) can both pass it for the same
    // message before either has inserted, since classifyEmail's LLM call in
    // between is slow enough to open a real window. Found this happening
    // live: a fresh Gmail OAuth connect produced duplicate inbox items for
    // the same message. The unique index (migrate.ts) turns the loser of
    // that race into a caught duplicate-key error instead of a duplicate row.
    try {
      await inboxItems.insertOne({
        id: itemId,
        tenant_id: tenantId,
        source: email.from,
        subject: email.subject,
        ai_summary: classification.summary,
        action_label: classification.actionLabel,
        action_type: classification.actionType,
        priority: classification.priority,
        date: email.date.toISOString(),
        read: false,
        dismissed: false,
        created_at: new Date(),
        email_message_id: email.messageId,
        connector_id: credentialDoc.connector_id,
        ...(classification.policy ? { policy_details: classification.policy } : {}),
      })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue // lost the race — the other scan owns this message
      throw err
    }
    result.inboxItemsCreated += 1

    for (const attachment of email.attachments) {
      if (!DOCUMENT_MIME_ALLOWLIST.has(attachment.contentType)) continue

      const documentId = randomUUID()
      const uploadStream = bucket.openUploadStream(attachment.filename, {
        metadata: {
          tenant_id: tenantId,
          document_id: documentId,
          mime_type: attachment.contentType,
          uploaded_at: new Date(),
        },
      })
      uploadStream.end(attachment.content)
      const fileId = uploadStream.id

      await documents.insertOne({
        id: documentId,
        filename: attachment.filename,
        mime_type: attachment.contentType,
        size: attachment.content.length,
        category: 'other',
        // Same free/paid split as the upload route (documents.ts): the
        // stored blob is always kept, the vision OCR is the paid step.
        status: docExtractionEnabled ? 'uploaded' : 'stored',
        uploaded_at: new Date(),
        file_id: fileId,
        source: 'email',
        email_message_id: email.messageId,
      })
      result.documentsCreated += 1

      if (docExtractionEnabled) {
        // Awaited (not fire-and-forget like the upload route) — there's no
        // HTTP response waiting on this, and awaiting keeps attachments
        // processed one at a time rather than bursting many concurrent
        // vision calls at the OCR provider.
        await processDocument(
          db,
          documentId,
          tenantId,
          attachment.content,
          attachment.contentType,
          attachment.filename,
          ocrDecide,
        ).catch((err) => {
          log.error({ err, documentId, tenantId }, 'OCR processing of email attachment failed')
        })
      }
    }
  }

  // Hold the cursor before the earliest email still awaiting a retry. If other
  // emails succeeded this scan the failure is specific to that email, so count an
  // attempt and give up on it after MAX_CLASSIFY_ATTEMPTS (a poison pill must not
  // block the mailbox forever). If nothing succeeded it is an outage: count nothing.
  let cursor = highestUid
  const stillRetrying: number[] = []
  for (const failed of failedEmails) {
    if (classifiedOk > 0) {
      const attempts = await recordClassifyFailure(db, tenantId, failed.messageId)
      if (attempts >= MAX_CLASSIFY_ATTEMPTS) {
        log.error(
          { tenantId, messageId: failed.messageId, attempts },
          'Giving up classifying email after repeated failures',
        )
        continue
      }
    }
    stillRetrying.push(failed.uid)
  }
  if (stillRetrying.length > 0 && highestUid !== undefined) {
    cursor = Math.max(credentialDoc.last_synced_uid ?? 0, Math.min(...stillRetrying) - 1)
    result.classificationRetries = stillRetrying.length
    log.warn(
      { tenantId, retrying: stillRetrying.length, cursor },
      'Holding email cursor so unclassified mail is retried',
    )
  }

  await getTenantCollection<EmailConnectorCredentialDoc>(
    db,
    'connector_credentials',
    tenantId,
  ).updateOne(
    { connector_id: credentialDoc.connector_id },
    {
      $set: {
        ...(cursor !== undefined ? { last_synced_uid: cursor } : {}),
        last_synced_at: new Date(),
      },
    },
  )

  log.info({ tenantId, ...result }, 'Email scan complete')
  return result
}

/**
 * Scans every tenant with a connected email connector — the cron entry
 * point. Per-tenant errors are logged and skipped, never fail the batch
 * (mirrors syncEngine.pollAll's pattern in server.ts for other connectors).
 */
export async function scanAllConnectedInboxes(db: Db): Promise<void> {
  const credentialDocs = await db
    .collection<EmailConnectorCredentialDoc>('connector_credentials')
    .find({ connector_id: 'email', auth_type: { $in: ['imap', 'oauth'] } })
    .toArray()

  for (const doc of credentialDocs) {
    try {
      await scanTenantInbox(db, doc.tenant_id, doc)
    } catch (err) {
      log.error({ err, tenantId: doc.tenant_id }, 'Email scan failed for tenant')
    }
  }
}

// ── Queue fan-out ─────────────────────────────────────────────────────────────
// scanAllConnectedInboxes walks tenants one after another inside a single cron
// run. With a CPU-served model at ~15-20s per email that cannot finish a large
// customer base inside the 15-minute window, and the cron's no-overlap rule then
// skips runs and builds a backlog. Fan-out turns each tenant scan into a queue job
// so several workers (and several model instances behind them) run in parallel.
// Off unless EMAIL_SCAN_FANOUT=true (see server.ts). Jobs carry only a tenant id,
// never credentials: the worker reloads the credential document itself.

export const EMAIL_SCAN_QUEUE = 'email-scan'
/** Just under the 15-minute cron period, so each cron tick enqueues a tenant at most once. */
const ENQUEUE_INTERVAL_MS = 14 * 60_000
/** A scan that outlives this lock is presumed dead (see cron-lock.ts); a new one may start. */
const TENANT_SCAN_LOCK_TTL_MS = 30 * 60_000

const CONNECTED_EMAIL_FILTER = { connector_id: 'email', auth_type: { $in: ['imap', 'oauth'] } }

type Publish = (queue: string, payload: unknown) => Promise<void>

/**
 * Enqueues one scan job per connected mailbox that has not been enqueued within
 * the last ENQUEUE_INTERVAL_MS, so a slow queue cannot accumulate duplicate jobs
 * for the same tenant. Returns how many jobs were enqueued.
 */
export async function enqueueConnectedInboxScans(
  db: Db,
  publish: Publish,
  now = new Date(),
): Promise<number> {
  const credentials = db.collection<EmailConnectorCredentialDoc>('connector_credentials')
  const due = await credentials
    .find({
      ...CONNECTED_EMAIL_FILTER,
      $or: [
        { scan_enqueued_at: { $exists: false } },
        { scan_enqueued_at: { $lt: new Date(now.getTime() - ENQUEUE_INTERVAL_MS) } },
      ],
    })
    .toArray()

  let enqueued = 0
  for (const doc of due) {
    try {
      await publish(EMAIL_SCAN_QUEUE, { tenant_id: doc.tenant_id })
      await credentials.updateOne({ _id: (doc as { _id?: unknown })['_id'] } as never, {
        $set: { scan_enqueued_at: now },
      })
      enqueued += 1
    } catch (err) {
      log.error({ err, tenantId: doc.tenant_id }, 'Could not enqueue email scan')
    }
  }
  return enqueued
}

/**
 * Queue handler: scans one tenant. Never throws: the queue would re-run a failed
 * job immediately (up to its attempt cap), which only hammers an unhealthy IMAP
 * host or model; the next cron tick retries instead, as the sequential path does.
 * A per-tenant lock stops two workers scanning the same mailbox at once.
 */
export async function runQueuedInboxScan(db: Db, payload: unknown): Promise<void> {
  const tenantId = (payload as { tenant_id?: unknown } | null)?.tenant_id
  if (typeof tenantId !== 'string' || !tenantId) {
    log.error({ payload }, 'Ignoring email scan job without a tenant_id')
    return
  }
  const lockName = `email-scan:${tenantId}`
  const owner = await acquireCronLock(db, lockName, TENANT_SCAN_LOCK_TTL_MS)
  if (!owner) {
    log.info({ tenantId }, 'Email scan already running for tenant — skipping duplicate job')
    return
  }
  try {
    const doc = await db
      .collection<EmailConnectorCredentialDoc>('connector_credentials')
      .findOne({ ...CONNECTED_EMAIL_FILTER, tenant_id: tenantId })
    if (!doc) return // disconnected since it was enqueued
    await scanTenantInbox(db, tenantId, doc)
  } catch (err) {
    log.error({ err, tenantId }, 'Queued email scan failed')
  } finally {
    await releaseCronLock(db, lockName, owner)
  }
}
