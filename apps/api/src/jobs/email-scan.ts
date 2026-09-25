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
import { createLogger, getTenantCollection, createLlmRouterFromEnv, encryptIfNeeded, decryptIfNeeded } from '@agentoak/platform'
import { fetchRecentEmails, searchPolicyEmails, type ImapCredentials } from '../email/imap-client.js'
import { refreshGoogleAccessToken } from '../email/gmail-oauth.js'
import { classifyEmail } from '../email/classify.js'
import { processDocument } from '../ocr/extract.js'
import type { InboxItemDoc } from '../routes/family-inbox.js'

const log = createLogger({ service: 'email-scan', version: '0.0.0' })

const DOCUMENT_MIME_ALLOWLIST = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

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
async function resolveOAuthAccessToken(db: Db, doc: EmailConnectorCredentialDoc): Promise<string | null> {
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

  await getTenantCollection<EmailConnectorCredentialDoc>(db, 'connector_credentials', doc.tenant_id).updateOne(
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

async function toImapCredentials(db: Db, doc: EmailConnectorCredentialDoc): Promise<ImapCredentials | null> {
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
  const creds = await toImapCredentials(db, credentialDoc)
  if (!creds) {
    return { scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 }
  }

  // A look-back is a one-off targeted search for policy mail; it must not
  // move the incremental cursor, or mail newer than the search window's
  // newest hit but older than the cursor's next scan would be skipped.
  const lookBack = opts.lookBackDays !== undefined
  const { emails, highestUid } = lookBack
    ? { emails: await searchPolicyEmails(creds, { sinceDays: opts.lookBackDays! }), highestUid: undefined }
    : await fetchRecentEmails(creds, { sinceUid: credentialDoc.last_synced_uid, limit: 25 })

  const result: ScanResult = { scanned: emails.length, inboxItemsCreated: 0, documentsCreated: 0 }
  if (emails.length === 0) return result

  const llm = createLlmRouterFromEnv()
  const inboxItems = db.collection<InboxItemDoc>('inbox_items')
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })
  const documents = getTenantCollection<Record<string, unknown>>(db, 'documents', tenantId)

  for (const email of emails) {
    const existing = await inboxItems.findOne({ tenant_id: tenantId, email_message_id: email.messageId })
    if (existing) continue

    const classification = await classifyEmail(llm, email)
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
        metadata: { tenant_id: tenantId, document_id: documentId, mime_type: attachment.contentType, uploaded_at: new Date() },
      })
      uploadStream.end(attachment.content)
      const fileId = uploadStream.id

      await documents.insertOne({
        id: documentId,
        filename: attachment.filename,
        mime_type: attachment.contentType,
        size: attachment.content.length,
        category: 'other',
        status: 'uploaded',
        uploaded_at: new Date(),
        file_id: fileId,
        source: 'email',
        email_message_id: email.messageId,
      })
      result.documentsCreated += 1

      // Awaited (not fire-and-forget like the upload route) — there's no
      // HTTP response waiting on this, and awaiting keeps attachments
      // processed one at a time rather than bursting many concurrent
      // vision calls at the OCR provider.
      await processDocument(db, documentId, tenantId, attachment.content, attachment.contentType, attachment.filename).catch((err) => {
        log.error({ err, documentId, tenantId }, 'OCR processing of email attachment failed')
      })
    }
  }

  await getTenantCollection<EmailConnectorCredentialDoc>(db, 'connector_credentials', tenantId).updateOne(
    { connector_id: credentialDoc.connector_id },
    { $set: { ...(highestUid !== undefined ? { last_synced_uid: highestUid } : {}), last_synced_at: new Date() } },
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
