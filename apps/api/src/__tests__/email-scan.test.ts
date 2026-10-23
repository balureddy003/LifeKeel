/**
 * Email scan job — orchestration coverage: dedup by message id, only
 * financial emails create an Inbox item, only allow-listed attachment
 * types get stored as documents, and the UID cursor advances so a repeat
 * scan doesn't reprocess the same mail.
 */

import { EventEmitter } from 'node:events'
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
vi.mock('@lifekeel/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifekeel/platform')>()
  return { ...actual, createLlmRouterFromEnv: () => async () => '{}' }
})

const uploadStreamEnd = vi.fn()
vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: vi.fn().mockImplementation(function FakeGridFSBucket() {
      return {
        // Emits 'finish' after end(), like the real write stream: the
        // storage seam awaits it before inserting the metadata row.
        openUploadStream: vi.fn(() => {
          const stream = new EventEmitter() as EventEmitter & { id: string; end: (b: Buffer) => void }
          stream.id = 'fake-gridfs-id'
          stream.end = (b: Buffer) => {
            uploadStreamEnd(b)
            queueMicrotask(() => stream.emit('finish'))
          }
          return stream
        }),
      }
    }),
  }
})

const { initTestGateway } = await import('./test-gateway.js')
initTestGateway()
const { scanTenantInbox, enqueueConnectedInboxScans, runQueuedInboxScan, EMAIL_SCAN_QUEUE } =
  await import('../jobs/email-scan.js')

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

function makeDb(
  existingMessageIds: string[] = [],
  tenant: Record<string, unknown> | null = { plan: 'starter' },
  initialFailureAttempts: Array<[string, number]> = [],
) {
  const inboxInserts: Record<string, unknown>[] = []
  const documentInserts: Record<string, unknown>[] = []
  const credentialUpdates: Record<string, unknown>[] = []
  const failureAttempts = new Map<string, number>(initialFailureAttempts)

  const collections: Record<string, unknown> = {
    tenants: {
      findOne: vi.fn(async () => (tenant ? { tenant_id: TENANT, ...tenant } : null)),
    },
    inbox_items: {
      findOne: vi.fn(async (filter: { email_message_id: string }) =>
        existingMessageIds.includes(filter.email_message_id) ? { id: 'existing' } : null,
      ),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => {
        inboxInserts.push(doc)
        return { insertedId: doc.id }
      }),
    },
    documents: {
      insertOne: vi.fn(async (doc: Record<string, unknown>) => {
        documentInserts.push(doc)
        return { insertedId: doc.id }
      }),
    },
    email_classify_failures: {
      findOneAndUpdate: vi.fn(async (filter: { email_message_id: string }) => {
        const n = (failureAttempts.get(filter.email_message_id) ?? 0) + 1
        failureAttempts.set(filter.email_message_id, n)
        return { attempts: n }
      }),
    },
    connector_credentials: {
      updateOne: vi.fn(async (_filter: unknown, update: Record<string, unknown>) => {
        credentialUpdates.push(update)
        return {}
      }),
    },
  }

  return {
    collection: (name: string) => collections[name],
    _inboxInserts: inboxInserts,
    _documentInserts: documentInserts,
    _credentialUpdates: credentialUpdates,
    _failureAttempts: failureAttempts,
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

  it('is a no-op for a free tenant — no LLM, OCR, or cursor movement', async () => {
    const db = makeDb([], { plan: 'free' })

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
    expect(classifyEmailMock).not.toHaveBeenCalled()
    expect(processDocumentMock).not.toHaveBeenCalled()
    // The UID cursor must not advance — mail received on the free plan
    // gets backfilled if the tenant upgrades later.
    expect(db._credentialUpdates).toHaveLength(0)
  })

  it('is a no-op when the tenant document is missing (defaults to free)', async () => {
    const db = makeDb([], null)

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
  })

  it('scans for a free tenant whose signup trial is still running', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 1 })
    classifyEmailMock.mockResolvedValue({
      isFinancial: true,
      summary: 's',
      actionLabel: 'a',
      actionType: 'review',
      priority: 'high',
    })
    const db = makeDb([], {
      plan: 'free',
      billing: { trial_ends_at: new Date(Date.now() + 10 * 86_400_000) },
    })

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    // Trial demos the paid product — a free-plan tenant inside the trial
    // window gets the AI inbox.
    expect(result.inboxItemsCreated).toBe(1)
    expect(classifyEmailMock).toHaveBeenCalled()
  })

  it('is a no-op for a free tenant whose trial has ended', async () => {
    const db = makeDb([], {
      plan: 'free',
      billing: { trial_ends_at: new Date(Date.now() - 86_400_000), trial_expired: true },
    })

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
  })

  it('returns zero scan result when credentials are incomplete', async () => {
    const db = makeDb()
    const result = await scanTenantInbox(db, TENANT, {
      tenant_id: TENANT,
      connector_id: 'email',
      auth_type: 'imap',
    } as any)
    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
  })

  it('skips an email already recorded as an inbox item (dedup)', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [makeEmail({ messageId: 'already-seen' })],
      highestUid: 1,
    })
    const db = makeDb(['already-seen'])

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.inboxItemsCreated).toBe(0)
    expect(classifyEmailMock).not.toHaveBeenCalled()
  })

  it('does not create an inbox item for a non-financial email', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 1 })
    classifyEmailMock.mockResolvedValue({
      isFinancial: false,
      summary: '',
      actionLabel: '',
      actionType: 'info',
      priority: 'low',
    })
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
      emails: [
        makeEmail({
          attachments: [
            {
              filename: 'policy.pdf',
              contentType: 'application/pdf',
              content: Buffer.from('%PDF-1.4 fake pdf'),
            },
          ],
        }),
      ],
      highestUid: 1,
    })
    classifyEmailMock.mockResolvedValue({
      isFinancial: true,
      summary: 's',
      actionLabel: 'a',
      actionType: 'review',
      priority: 'high',
    })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.documentsCreated).toBe(1)
    expect(db._documentInserts[0]).toMatchObject({
      filename: 'policy.pdf',
      source: 'email',
      email_message_id: 'msg-1',
    })
    expect(processDocumentMock).toHaveBeenCalledTimes(1)
  })

  it('ignores an attachment type outside the document allowlist', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [
        makeEmail({
          attachments: [
            {
              filename: 'archive.zip',
              contentType: 'application/zip',
              content: Buffer.from('zip'),
            },
          ],
        }),
      ],
      highestUid: 1,
    })
    classifyEmailMock.mockResolvedValue({
      isFinancial: true,
      summary: 's',
      actionLabel: 'a',
      actionType: 'review',
      priority: 'high',
    })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result.documentsCreated).toBe(0)
    expect(processDocumentMock).not.toHaveBeenCalled()
  })

  it('advances the sync cursor to the highest UID seen', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [makeEmail()], highestUid: 42 })
    classifyEmailMock.mockResolvedValue({
      isFinancial: false,
      summary: '',
      actionLabel: '',
      actionType: 'info',
      priority: 'low',
    })
    const db = makeDb()

    await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(db._credentialUpdates[0]).toMatchObject({
      $set: expect.objectContaining({ last_synced_uid: 42 }),
    })
  })

  it('returns early with no writes when there are no new emails', async () => {
    fetchRecentEmailsMock.mockResolvedValue({ emails: [], highestUid: 0 })
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, VALID_CREDENTIAL_DOC as any)

    expect(result).toEqual({ scanned: 0, inboxItemsCreated: 0, documentsCreated: 0 })
    expect(db._credentialUpdates).toHaveLength(0)
  })
})

describe('scanTenantInbox when the classifier fails', () => {
  const ok = {
    isFinancial: false,
    summary: '',
    actionLabel: '',
    actionType: 'info',
    priority: 'low',
  }
  const failed = { ...ok, failed: true }
  const cursorOf = (db: any) =>
    (db._credentialUpdates.at(-1)?.$set as { last_synced_uid?: number }).last_synced_uid

  beforeEach(() => {
    fetchRecentEmailsMock.mockReset()
    classifyEmailMock.mockReset()
  })

  it('holds the cursor before the first unclassified email so it is retried, not skipped', async () => {
    const emails = [1, 2, 3, 4].map((uid) => makeEmail({ uid, messageId: `m${uid}` }))
    fetchRecentEmailsMock.mockResolvedValue({ emails, highestUid: 4 })
    classifyEmailMock
      .mockResolvedValueOnce(ok) // m1
      .mockResolvedValueOnce(failed) // m2
      .mockResolvedValueOnce(ok) // m3
      .mockResolvedValueOnce(ok) // m4
    const db = makeDb()

    const result = await scanTenantInbox(db, TENANT, {
      ...VALID_CREDENTIAL_DOC,
      last_synced_uid: 0,
    } as any)

    expect(cursorOf(db)).toBe(1) // next scan fetches uid 2 onward
    expect(result.classificationRetries).toBe(1)
  })

  it('advances the cursor normally when every email is classified', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [makeEmail({ uid: 7, messageId: 'm7' })],
      highestUid: 7,
    })
    classifyEmailMock.mockResolvedValue(ok)
    const db = makeDb()
    const result = await scanTenantInbox(db, TENANT, {
      ...VALID_CREDENTIAL_DOC,
      last_synced_uid: 3,
    } as any)
    expect(cursorOf(db)).toBe(7)
    expect(result.classificationRetries).toBeUndefined()
  })

  it('stops after repeated failures instead of burning a timeout on every remaining email', async () => {
    const emails = Array.from({ length: 10 }, (_, i) =>
      makeEmail({ uid: i + 1, messageId: `m${i + 1}` }),
    )
    fetchRecentEmailsMock.mockResolvedValue({ emails, highestUid: 10 })
    classifyEmailMock.mockResolvedValue(failed)
    const db = makeDb()

    await scanTenantInbox(db, TENANT, { ...VALID_CREDENTIAL_DOC, last_synced_uid: 0 } as any)

    expect(classifyEmailMock).toHaveBeenCalledTimes(3)
    expect(cursorOf(db)).toBe(0) // nothing consumed; everything is retried
  })

  it('does not count attempts during an outage, so an outage cannot exhaust the retries', async () => {
    fetchRecentEmailsMock.mockResolvedValue({
      emails: [makeEmail({ uid: 1, messageId: 'm1' })],
      highestUid: 1,
    })
    classifyEmailMock.mockResolvedValue(failed)
    const db = makeDb([], { plan: 'starter' }, [['m1', 4]])

    await scanTenantInbox(db, TENANT, { ...VALID_CREDENTIAL_DOC, last_synced_uid: 0 } as any)

    expect(db._failureAttempts.get('m1')).toBe(4) // unchanged: nothing else succeeded
    expect(cursorOf(db)).toBe(0)
  })

  it('gives up on a poison-pill email once others succeed and attempts run out, so it cannot block the mailbox forever', async () => {
    const emails = [
      makeEmail({ uid: 1, messageId: 'bad' }),
      makeEmail({ uid: 2, messageId: 'good' }),
    ]
    fetchRecentEmailsMock.mockResolvedValue({ emails, highestUid: 2 })
    classifyEmailMock.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok)
    const db = makeDb([], { plan: 'starter' }, [['bad', 4]]) // this scan is the 5th failure

    const result = await scanTenantInbox(db, TENANT, {
      ...VALID_CREDENTIAL_DOC,
      last_synced_uid: 0,
    } as any)

    expect(db._failureAttempts.get('bad')).toBe(5)
    expect(cursorOf(db)).toBe(2) // moved past it
    expect(result.classificationRetries).toBeUndefined()
  })

  it('counts an attempt and keeps retrying while a failing email is under the limit and others succeed', async () => {
    const emails = [
      makeEmail({ uid: 1, messageId: 'bad' }),
      makeEmail({ uid: 2, messageId: 'good' }),
    ]
    fetchRecentEmailsMock.mockResolvedValue({ emails, highestUid: 2 })
    classifyEmailMock.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok)
    const db = makeDb()

    await scanTenantInbox(db, TENANT, { ...VALID_CREDENTIAL_DOC, last_synced_uid: 0 } as any)

    expect(db._failureAttempts.get('bad')).toBe(1)
    expect(cursorOf(db)).toBe(0)
  })
})

describe('email scan queue fan-out', () => {
  const NOW = new Date('2026-10-02T12:00:00Z')

  function makeFanoutDb(
    opts: { credentials?: Record<string, unknown>[]; lockHeld?: boolean; tenantPlan?: string } = {},
  ) {
    const credentials = opts.credentials ?? []
    const credentialUpdates: Array<{
      filter: Record<string, unknown>
      update: Record<string, any>
    }> = []
    const lockReleases: unknown[] = []
    let findQuery: Record<string, any> = {}
    const collections: Record<string, any> = {
      connector_credentials: {
        find: vi.fn((q: Record<string, unknown>) => {
          findQuery = q
          return { toArray: async () => credentials }
        }),
        findOne: vi.fn(
          async (q: Record<string, unknown>) =>
            credentials.find((c) => c['tenant_id'] === q['tenant_id']) ?? null,
        ),
        updateOne: vi.fn(async (filter: Record<string, unknown>, update: Record<string, any>) => {
          credentialUpdates.push({ filter, update })
          return {}
        }),
      },
      cron_locks: {
        findOneAndUpdate: vi.fn(async () => (opts.lockHeld ? null : { name: 'x' })),
        deleteOne: vi.fn(async (f: unknown) => {
          lockReleases.push(f)
          return {}
        }),
      },
      tenants: {
        findOne: vi.fn(async () => ({ tenant_id: TENANT, plan: opts.tenantPlan ?? 'starter' })),
      },
    }
    return {
      db: { collection: (n: string) => collections[n] } as any,
      credentialUpdates,
      lockReleases,
      query: () => findQuery,
    }
  }

  beforeEach(() => {
    fetchRecentEmailsMock.mockReset()
    fetchRecentEmailsMock.mockResolvedValue({ emails: [], highestUid: 0 })
  })

  it('enqueues one job per due mailbox carrying only the tenant id, never credentials', async () => {
    const { db, credentialUpdates } = makeFanoutDb({
      credentials: [
        { _id: 'c1', tenant_id: 'a', password: 'secret-1', username: 'a@x.example' },
        { _id: 'c2', tenant_id: 'b', password: 'secret-2', username: 'b@x.example' },
      ],
    })
    const publish = vi.fn(async () => {})

    expect(await enqueueConnectedInboxScans(db, publish, NOW)).toBe(2)

    expect(publish.mock.calls).toEqual([
      [EMAIL_SCAN_QUEUE, { tenant_id: 'a' }],
      [EMAIL_SCAN_QUEUE, { tenant_id: 'b' }],
    ])
    expect(JSON.stringify(publish.mock.calls)).not.toContain('secret')
    expect(credentialUpdates.map((u) => u.update.$set.scan_enqueued_at)).toEqual([NOW, NOW])
  })

  it('does not re-enqueue a mailbox already enqueued within the last 14 minutes', async () => {
    const { db, query } = makeFanoutDb()
    await enqueueConnectedInboxScans(
      db,
      vi.fn(async () => {}),
      NOW,
    )
    const q = query()
    expect(q.connector_id).toBe('email')
    expect(q.$or).toEqual([
      { scan_enqueued_at: { $exists: false } },
      { scan_enqueued_at: { $lt: new Date(NOW.getTime() - 14 * 60_000) } },
    ])
  })

  it('keeps going when one publish fails, and does not mark that mailbox as enqueued', async () => {
    const { db, credentialUpdates } = makeFanoutDb({
      credentials: [
        { _id: 'c1', tenant_id: 'a' },
        { _id: 'c2', tenant_id: 'b' },
      ],
    })
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined)

    expect(await enqueueConnectedInboxScans(db, publish, NOW)).toBe(1)
    expect(credentialUpdates).toHaveLength(1)
    expect(credentialUpdates[0]!.filter).toEqual({ _id: 'c2' })
  })

  it('scans the tenant under a per-tenant lock and releases it afterwards', async () => {
    const { db, lockReleases } = makeFanoutDb({
      credentials: [{ ...VALID_CREDENTIAL_DOC, tenant_id: TENANT }],
    })
    await runQueuedInboxScan(db, { tenant_id: TENANT })
    expect(fetchRecentEmailsMock).toHaveBeenCalledTimes(1)
    expect(lockReleases).toHaveLength(1)
    expect((lockReleases[0] as { name: string }).name).toBe(`email-scan:${TENANT}`)
  })

  it('skips a duplicate job while another worker is scanning the same tenant', async () => {
    const { db, lockReleases } = makeFanoutDb({
      credentials: [{ ...VALID_CREDENTIAL_DOC, tenant_id: TENANT }],
      lockHeld: true,
    })
    await runQueuedInboxScan(db, { tenant_id: TENANT })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
    expect(lockReleases).toHaveLength(0)
  })

  it('ignores a malformed job and a mailbox disconnected after it was enqueued', async () => {
    const { db } = makeFanoutDb({ credentials: [] })
    await runQueuedInboxScan(db, null)
    await runQueuedInboxScan(db, { tenant_id: 42 })
    await runQueuedInboxScan(db, { tenant_id: 'gone' })
    expect(fetchRecentEmailsMock).not.toHaveBeenCalled()
  })

  it('never throws on a failed scan (the queue would retry it at once) and still releases the lock', async () => {
    fetchRecentEmailsMock.mockRejectedValue(new Error('IMAP auth failed'))
    const { db, lockReleases } = makeFanoutDb({
      credentials: [{ ...VALID_CREDENTIAL_DOC, tenant_id: TENANT }],
    })
    await expect(runQueuedInboxScan(db, { tenant_id: TENANT })).resolves.toBeUndefined()
    expect(lockReleases).toHaveLength(1)
  })
})
