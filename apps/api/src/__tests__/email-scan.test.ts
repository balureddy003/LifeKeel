/**
 * Email scan job — orchestration coverage: dedup by message id, only
 * financial emails create an Inbox item, only allow-listed attachment
 * types get stored as documents, and the UID cursor advances so a repeat
 * scan doesn't reprocess the same mail.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const fetchRecentEmailsMock = vi.fn()
const classifyEmailMock = vi.fn()
const processDocumentMock = vi.fn(async () => {})

vi.mock('../email/imap-client.js', () => ({
  fetchRecentEmails: (...args: unknown[]) => fetchRecentEmailsMock(...args),
}))
vi.mock('../email/classify.js', () => ({
  classifyEmail: (...args: unknown[]) => classifyEmailMock(...args),
}))
vi.mock('../ocr/extract.js', () => ({
  processDocument: (...args: unknown[]) => processDocumentMock(...args),
}))
vi.mock('@agentoak/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentoak/platform')>()
  return { ...actual, createLlmRouterFromEnv: () => async () => '{}' }
})

const uploadStreamEnd = vi.fn()
vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: vi.fn().mockImplementation(function FakeGridFSBucket() {
      return { openUploadStream: vi.fn(() => ({ end: uploadStreamEnd, id: 'fake-gridfs-id' })) }
    }),
  }
})

const { scanTenantInbox } = await import('../jobs/email-scan.js')

const TENANT = 'tenant-scan-test'

function makeEmail(overrides: Record<string, unknown> = {}) {
  return {
    uid: 1,
    messageId: 'msg-1',
    from: 'sender@example.com',
    subject: 'Subject',
    date: new Date('2026-01-01'),
    textSnippet: 'body',
    attachments: [],
    ...overrides,
  }
}

function makeDb(existingMessageIds: string[] = []) {
  const inboxInserts: Record<string, unknown>[] = []
  const documentInserts: Record<string, unknown>[] = []
  const credentialUpdates: Record<string, unknown>[] = []

  const collections: Record<string, unknown> = {
    inbox_items: {
      findOne: vi.fn(async (filter: { email_message_id: string }) =>
        existingMessageIds.includes(filter.email_message_id) ? { id: 'existing' } : null,
      ),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { inboxInserts.push(doc); return { insertedId: doc.id } }),
    },
    documents: {
      insertOne: vi.fn(async (doc: Record<string, unknown>) => { documentInserts.push(doc); return { insertedId: doc.id } }),
    },
    connector_credentials: {
      updateOne: vi.fn(async (_filter: unknown, update: Record<string, unknown>) => { credentialUpdates.push(update); return {} }),
    },
  }

  return {
    collection: (name: string) => collections[name],
    _inboxInserts: inboxInserts,
    _documentInserts: documentInserts,
    _credentialUpdates: credentialUpdates,
  } as any
}

const VALID_CREDENTIAL_DOC = {
  tenant_id: TENANT,
  connector_id: 'email',
  auth_type: 'imap',
  username: 'me@example.com',
  password: 'plaintext-in-test',
  extra: { host: 'imap.example.com', port: 993, use_tls: true },
}

describe('scanTenantInbox', () => {
  beforeEach(() => {
    fetchRecentEmailsMock.mockReset()
    classifyEmailMock.mockReset()
    processDocumentMock.mockClear()
    uploadStreamEnd.mockClear()
  })

  it('returns zero scan result when credentials are incomplete', async () => {
    const db = makeDb()
    const result = await scanTenantInbox(db, TENANT, { tenant_id: TENANT, connector_id: 'email', auth_type: 'imap' } as any)
    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
  })

  it('skips an email already recorded as an inbox item (dedup)', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail({ messageId: 'already-seen' })], highestUid: 1 })
    const db = makeDb(['already-seen'])

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.inboxItemsCreated).toBe(0)
    expect(classifyEmailMock).not.toHaveBeenCalled()
  })

  it('does not create an inbox item for a non-financial email', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 1 })
    classifyEmailMock.mockResolvedValue({ isFinancial: false, summary: '', actionLabel: '', actionType: 'info', priority: 'low' })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.inboxItemsCreated).toBe(0)
    expect(db._inboxInserts).toHaveLength(0)
  })

  it('creates an inbox item for a financial email', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 1 })
    classifyEmailMock.mockResolvedValue({
      isFinancial: true,
      summary: 'Your bill is due',
      actionLabel: 'Pay bill',
      actionType: 'update',
      priority: 'high',
    })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.inboxItemsCreated).toBe(1)
    expect(db._inboxInserts[0]).toMatchObject({
      tenant_id: TENANT,
      subject: 'Subject',
      ai_summary: 'Your bill is due',
      email_message_id: 'msg-1',
    })
  })

  it('stores an allow-listed attachment as a document and runs OCR on it', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [makeEmail({
        attachments: [{ filename: 'policy.pdf', contentType: 'application/pdf', content: Buffer.from('fake pdf') }],
      })],
      highestUid: 1,
    })
    classifyEmailMock.mockResolvedValue({ isFinancial: true, summary: 's', actionLabel: 'a', actionType: 'review', priority: 'high' })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.documentsCreated).toBe(1)
    expect(db._documentInserts[0]).toMatchObject({ filename: 'policy.pdf', source: 'email', email_message_id: 'msg-1' })
    expect(processDocumentMock).toHaveBeenCalledTimes(1)
  })

  it('ignores an attachment type outside the document allowlist', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [makeEmail({
        attachments: [{ filename: 'archive.zip', contentType: 'application/zip', content: Buffer.from('zip') }],
      })],
      highestUid: 1,
    })
    classifyEmailMock.mockResolvedValue({ isFinancial: true, summary: 's', actionLabel: 'a', actionType: 'review', priority: 'high' })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.documentsCreated).toBe(0)
    expect(processDocumentMock).not.toHaveBeenCalled()
  })

  it('advances the sync cursor to the highest UID seen', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 42 })
    classifyEmailMock.mockResolvedValue({ isFinancial: false, summary: '', actionLabel: '', actionType: 'info', priority: 'low' })
    const db = makeDb()

    await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(db._credentialUpdates[0]).toMatchObject({ $set: expect.objectContaining({ last_synced_uid: 42 }) })
  })

  it('returns early with no writes when there are no new emails', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [], highestUid: 0 })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(db._credentialUpdates).toHaveLength(0)
  })
})
