/**
 * Disconnect a mailbox AND delete what was read from it (PRD-146).
 *
 * Disconnecting alone only revokes the stored token; the inbox summaries and
 * any attachments saved as documents stay. This removes them too: the
 * credentials (the Gmail grant is stored under both 'gmail' and 'email'), the
 * sync state, inbox items created from messages, documents saved from
 * attachments with their file blobs, and the classify-failure log. Counts
 * only; nothing here reads message content.
 *
 * Profile details a family saved from a message or attachment are the
 * family's own entries by then and are not touched.
 */
import { GridFSBucket, type Db } from 'mongodb'

export const MAILBOX_CONNECTOR_IDS = ['email', 'gmail'] as const

export const isMailboxConnector = (id: string) =>
  (MAILBOX_CONNECTOR_IDS as readonly string[]).includes(id)

export const MAILBOX_KEPT = [
  'Details you saved to your financial profile from a message or attachment stay there until you change them.',
  'Messages in your own mailbox are untouched: LifeKeel only ever read them.',
]

interface Counted {
  category: string
  count: number
}

export async function deleteMailboxData(
  db: Db,
  tenantId: string,
): Promise<{ removed: Counted[]; residual: Counted[] }> {
  const ids = [...MAILBOX_CONNECTOR_IDS]
  const removed: Counted[] = []

  // Attachments saved as documents: blob first, then the record, so a failure
  // leaves a harmless unreferenced record rather than an unidentifiable blob.
  const docs = (await db
    .collection('documents')
    .find({ tenant_id: tenantId, source: 'email' })
    .project({ _id: 1, id: 1, file_id: 1 })
    .toArray()) as unknown as { _id: unknown; id?: string; file_id?: import('mongodb').ObjectId }[]
  // What was extracted from those attachments (values, snippets) goes with them.
  const candidates = await db
    .collection('extraction_candidates')
    .deleteMany({ tenant_id: tenantId, document_id: { $in: docs.map((d) => String(d.id)) } })
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })
  let blobs = 0
  for (const d of docs) {
    if (!d.file_id) continue
    try {
      await bucket.delete(d.file_id)
      blobs++
    } catch {
      /* blob may already be gone */
    }
  }
  const docResult = await db
    .collection('documents')
    .deleteMany({ tenant_id: tenantId, source: 'email' })
  removed.push({ category: 'documents saved from attachments', count: docResult.deletedCount })
  removed.push({ category: 'attachment files', count: blobs })
  removed.push({ category: 'extracted fields', count: candidates.deletedCount })

  const inbox = await db
    .collection('inbox_items')
    .deleteMany({ tenant_id: tenantId, email_message_id: { $exists: true } })
  removed.push({ category: 'inbox summaries', count: inbox.deletedCount })

  const failures = await db
    .collection('email_classify_failures')
    .deleteMany({ tenant_id: tenantId })
  removed.push({ category: 'scan failure log', count: failures.deletedCount })

  const sync = await db
    .collection('connector_sync_state')
    .deleteMany({ tenant_id: tenantId, connector_id: { $in: ids } })
  removed.push({ category: 'sync state', count: sync.deletedCount })

  const creds = await db
    .collection('connector_credentials')
    .deleteMany({ tenant_id: tenantId, connector_id: { $in: ids } })
  removed.push({ category: 'mailbox connection', count: creds.deletedCount })

  const residual: Counted[] = [
    {
      category: 'documents saved from attachments',
      count: await db
        .collection('documents')
        .countDocuments({ tenant_id: tenantId, source: 'email' }),
    },
    {
      category: 'inbox summaries',
      count: await db
        .collection('inbox_items')
        .countDocuments({ tenant_id: tenantId, email_message_id: { $exists: true } }),
    },
    {
      category: 'scan failure log',
      count: await db.collection('email_classify_failures').countDocuments({ tenant_id: tenantId }),
    },
    {
      category: 'sync state',
      count: await db
        .collection('connector_sync_state')
        .countDocuments({ tenant_id: tenantId, connector_id: { $in: ids } }),
    },
    {
      category: 'mailbox connection',
      count: await db
        .collection('connector_credentials')
        .countDocuments({ tenant_id: tenantId, connector_id: { $in: ids } }),
    },
  ]
  return {
    removed: removed.filter((r) => r.count > 0),
    residual: residual.filter((r) => r.count > 0),
  }
}
