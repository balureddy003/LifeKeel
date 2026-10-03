/**
 * PRD-137 §1/§7 — the legacy register: CRUD with reference validation,
 * per-document visibility (adults / organizer / named_roles), audited
 * restricted reads, the member-deletion verification cascade, and the
 * property-legacy sub-document on family_assets.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyLegacyRoutes } from '../family-legacy.js'
import { registerFamilyAssetRoutes } from '../family-assets.js'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { initAuditLogger } from '../../audit/audit-log.js'

const TENANT = 'tenant-legacy-1'

// Caller identities are user_ids; roster entries resolve via id or user_id.
const ORGANIZER = 'u-org'
const ADULT = 'u-adult'
const OTHER_ADULT = 'u-other'
const CHILD = 'u-kid'

function makeFamily() {
  return {
    id: 'fam-1',
    tenant_id: TENANT,
    name: 'Test family',
    invite_code: 'ABC123',
    members: [
      { id: 'm-org', user_id: ORGANIZER, name: 'Organizer', role: 'organizer', status: 'active' },
      { id: 'm-adult', user_id: ADULT, name: 'Adult', role: 'adult', status: 'active' },
      { id: 'm-other', user_id: OTHER_ADULT, name: 'Other', role: 'adult', status: 'active' },
      { id: 'm-kid', user_id: CHILD, name: 'Kid', role: 'child', status: 'active' },
    ],
  }
}

function resolveKey(doc: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = doc
  for (let i = 0; i < parts.length; i++) {
    cur = (cur as Record<string, unknown> | undefined)?.[parts[i]!]
    // 'roles.member_id' must match when ANY array element matches —
    // resolve the remaining path inside each element.
    if (Array.isArray(cur)) {
      return cur.map((item) => resolveKey(item as Record<string, unknown>, parts.slice(i + 1).join('.')))
    }
  }
  return cur
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const val = resolveKey(doc, k)
    if (Array.isArray(val)) return val.includes(v)
    return val === v
  })
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>, inserting: boolean) {
  const set = { ...(inserting ? (update['$setOnInsert'] as Record<string, unknown> | undefined) : {}), ...(update['$set'] as Record<string, unknown> | undefined) }
  for (const [k, v] of Object.entries(set)) {
    if (k.includes('.')) {
      // $set on a dotted path — only 'data.x' style used by the group route.
      const [head, ...rest] = k.split('.')
      const target = doc[head!] as Record<string, unknown>
      if (target && rest.length === 1) target[rest[0]!] = v
    } else {
      doc[k] = v
    }
  }
  for (const key of Object.keys((update['$unset'] as Record<string, unknown> | undefined) ?? {})) delete doc[key]
  if (update['$pull']) {
    for (const [k, cond] of Object.entries(update['$pull'] as Record<string, Record<string, unknown>>)) {
      doc[k] = (doc[k] as Record<string, unknown>[]).filter((item) => !matches(item, cond))
    }
  }
}

function col(store: Record<string, unknown>[]) {
  return {
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => matches(d, filter)) ?? null,
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: async () => store.filter((d) => matches(d, filter)),
    }),
    insertOne: async (doc: Record<string, unknown>) => { store.push(doc); return { insertedId: doc['id'] } },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      const doc = store.find((d) => matches(d, filter))
      if (doc) { applyUpdate(doc, update, false); return { modifiedCount: 1 } }
      if (opts?.upsert) {
        const fresh: Record<string, unknown> = {}
        applyUpdate(fresh, update, true)
        store.push(fresh)
        return { upsertedCount: 1 }
      }
      return { modifiedCount: 0 }
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const i = store.findIndex((d) => matches(d, filter))
      if (i === -1) return { deletedCount: 0 }
      store.splice(i, 1)
      return { deletedCount: 1 }
    },
    createIndex: async () => ({}),
  }
}

let family: ReturnType<typeof makeFamily>
let legacyDocs: Record<string, unknown>[]
let contacts: Record<string, unknown>[]
let notes: Record<string, unknown>[]
let vaultDocs: Record<string, unknown>[]
let assets: Record<string, unknown>[]
let auditEntries: Record<string, unknown>[]

function makeDb() {
  const familyGroups = {
    findOne: async (filter: Record<string, unknown> = {}) =>
      matches(family as unknown as Record<string, unknown>, { tenant_id: TENANT, ...filter }) ? family : null,
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
      applyUpdate(family as unknown as Record<string, unknown>, update, false)
      return family
    },
    createIndex: async () => ({}),
  }
  const stores: Record<string, ReturnType<typeof col>> = {
    legacy_documents: col(legacyDocs),
    legacy_contacts: col(contacts),
    legacy_notes: col(notes),
    documents: col(vaultDocs),
    family_assets: col(assets),
    audit_log: col(auditEntries),
  }
  return {
    collection: (name: string) =>
      name === 'family_groups' ? familyGroups : stores[name] ?? col([]),
  } as never
}

async function build(userId = ORGANIZER) {
  const db = makeDb()
  initAuditLogger(db as never, true)
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyLegacyRoutes(app, db)
  registerFamilyAssetRoutes(app, db)
  registerFamilyGroupRoutes(app, db)
  return { app, db }
}

const willDoc = (over: Record<string, unknown> = {}) => ({
  type: 'will',
  subject_member_id: 'm-org',
  jurisdiction: 'England & Wales',
  roles: [{ role: 'executor', member_id: 'm-adult', verification: 'user_declared' }],
  covers_asset_ids: [],
  verification: 'user_declared',
  ...over,
})

beforeEach(() => {
  family = makeFamily()
  legacyDocs = []
  contacts = []
  notes = []
  vaultDocs = []
  assets = []
  auditEntries = []
})

describe('access control', () => {
  it('403s a child caller', async () => {
    const { app } = await build(CHILD)
    const res = await app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('documents CRUD + reference validation', () => {
  it('round-trips create → list → patch → delete', async () => {
    const { app } = await build()
    const created = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc() })
    expect(created.statusCode).toBe(201)
    const id = created.json().document.id

    const list = await app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(list.json().documents).toHaveLength(1)
    expect(list.json().documents[0].tenant_id).toBeUndefined()

    const patched = await app.inject({ method: 'PATCH', url: `/family/legacy/documents/${id}`, payload: { original_location: 'Solicitor X, Leeds' } })
    expect(patched.json().document.original_location).toBe('Solicitor X, Leeds')

    const del = await app.inject({ method: 'DELETE', url: `/family/legacy/documents/${id}` })
    expect(del.statusCode).toBe(204)
    expect(legacyDocs).toHaveLength(0)
    await app.close()
  })

  it('400s on an unknown member_id in roles or subject', async () => {
    const { app } = await build()
    const badRole = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ roles: [{ role: 'executor', member_id: 'ghost', verification: 'user_declared' }] }) })
    expect(badRole.statusCode).toBe(400)
    const badSubject = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ subject_member_id: 'ghost' }) })
    expect(badSubject.statusCode).toBe(400)
    await app.close()
  })

  it('400s on an unknown contact_id, accepts a real one', async () => {
    const { app } = await build()
    const bad = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ roles: [{ role: 'executor', contact_id: 'nope', verification: 'user_declared' }] }) })
    expect(bad.statusCode).toBe(400)

    contacts.push({ id: 'c1', tenant_id: TENANT, name: 'Solicitor Sam', kind: 'solicitor' })
    const ok = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ roles: [{ role: 'executor', contact_id: 'c1', verification: 'user_declared' }] }) })
    expect(ok.statusCode).toBe(201)
    await app.close()
  })

  it('400s on an unknown vault_document_id; a real one forces verification=document_linked', async () => {
    const { app } = await build()
    const bad = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ vault_document_id: 'nope' }) })
    expect(bad.statusCode).toBe(400)

    vaultDocs.push({ id: 'v1', tenant_id: TENANT, category: 'estate_vault' })
    const res = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ vault_document_id: 'v1', verification: 'user_declared' }) })
    expect(res.statusCode).toBe(201)
    expect(res.json().document.verification).toBe('document_linked')
    await app.close()
  })

  it('rejects a role naming neither a member nor a contact', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ roles: [{ role: 'executor', verification: 'unverified' }] }) })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('visibility (§7)', () => {
  it('hides visibility=organizer documents from a non-organizer adult', async () => {
    const { app } = await build()
    await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ visibility: 'organizer' }) })
    const list = await (await build(ADULT)).app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(list.json().documents).toHaveLength(0)
    await app.close()
  })

  it('visibility=named_roles is visible to a named member (with audit), hidden from another adult', async () => {
    const { app } = await build()
    await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ visibility: 'named_roles' }) })

    const named = await (await build(ADULT)).app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(named.json().documents).toHaveLength(1)
    // The named executor is neither subject nor organizer — the read is audited.
    expect(auditEntries.some((e) => e['action'] === 'legacy.document.read' && e['user_id'] === ADULT)).toBe(true)

    const other = await (await build(OTHER_ADULT)).app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(other.json().documents).toHaveLength(0)
    await app.close()
  })

  it('the subject reads their own named_roles document without an audit entry', async () => {
    const { app } = await build()
    // Subject is the organizer here — make the adult the subject instead.
    await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc({ subject_member_id: 'm-adult', visibility: 'named_roles' }) })
    const res = await (await build(ADULT)).app.inject({ method: 'GET', url: '/family/legacy/documents' })
    expect(res.json().documents).toHaveLength(1)
    expect(auditEntries.some((e) => e['action'] === 'legacy.document.read')).toBe(false)
    await app.close()
  })
})

describe('contacts and notes', () => {
  it('round-trips a contact', async () => {
    const { app } = await build()
    const created = await app.inject({ method: 'POST', url: '/family/legacy/contacts', payload: { name: 'Sam', relationship: 'solicitor', kind: 'solicitor' } })
    expect(created.statusCode).toBe(201)
    const list = await app.inject({ method: 'GET', url: '/family/legacy/contacts' })
    expect(list.json().contacts).toHaveLength(1)
    const del = await app.inject({ method: 'DELETE', url: `/family/legacy/contacts/${created.json().contact.id}` })
    expect(del.statusCode).toBe(204)
    await app.close()
  })

  it('creates a note stamped family_understanding and authored by the caller', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'POST', url: '/family/legacy/notes', payload: { node: { kind: 'member', id: 'm-org' }, text: 'Will is in the study drawer' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().note).toMatchObject({ verification: 'family_understanding', author_user_id: ORGANIZER })
    await app.close()
  })
})

describe('member deletion cascade', () => {
  it('flips roles referencing the removed member to unverified, keeping the role', async () => {
    const { app } = await build()
    await app.inject({ method: 'POST', url: '/family/legacy/documents', payload: willDoc() })

    const del = await app.inject({ method: 'DELETE', url: '/family/members/m-adult' })
    expect(del.statusCode).toBe(200)
    expect(legacyDocs[0]!['roles']).toEqual([{ role: 'executor', member_id: 'm-adult', verification: 'unverified' }])
    await app.close()
  })
})

describe('GET /family/legacy/rehearsal (§6)', () => {
  it('400s without as, and for a child or unknown member', async () => {
    const { app } = await build()
    expect((await app.inject({ method: 'GET', url: '/family/legacy/rehearsal' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=m-kid' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=ghost' })).statusCode).toBe(400)
    await app.close()
  })

  it('403s a child caller', async () => {
    const { app } = await build(CHILD)
    const res = await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=m-adult' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('shows what the chosen adult could find — hidden docs, unlocated docs, only-one-person-knows', async () => {
    const { app } = await build()
    // A will only the organizer can see, with no original location.
    await app.inject({
      method: 'POST',
      url: '/family/legacy/documents',
      payload: willDoc({ visibility: 'organizer', subject_member_id: 'm-org' }),
    })
    // A will adults can see, located — gives findability a numerator.
    await app.inject({
      method: 'POST',
      url: '/family/legacy/documents',
      payload: willDoc({ visibility: 'adults', original_location: 'Study drawer', roles: [{ role: 'executor', member_id: 'm-adult', verification: 'user_declared' }] }),
    })
    // A property whose recorded_owners is empty and has no note.
    assets.push({
      id: 'a-prop', tenant_id: TENANT, kind: 'property', name: 'Cottage',
      value_minor: 30_000_000, created_at: new Date(), updated_at: new Date(),
      legacy: { ownership_basis: 'inherited', jurisdiction: 'England & Wales', recorded_owners: [], claimed_owners: [], verification: 'user_declared' },
    })

    const res = await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=m-adult' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.as).toEqual({ id: 'm-adult', name: 'Adult' })
    // 1 of 2 docs is visible AND located → 50%.
    expect(body.findability_pct).toBe(50)
    expect(body.visible_documents).toHaveLength(1)
    expect(body.hidden_documents).toHaveLength(1)
    expect(body.hidden_documents[0]).toMatchObject({ type: 'will', reason: 'organizer only' })
    expect(body.only_one_person_knows).toHaveLength(2)
    expect(body.only_one_person_knows.map((o: { kind: string }) => o.kind).sort()).toEqual(['asset', 'document'])
    expect(body.properties_without_title).toEqual([{ id: 'a-prop', name: 'Cottage' }])
    // m-adult is named executor on the visible will.
    expect(body.named_roles).toEqual([
      { document_id: body.visible_documents[0].id, type: 'will', role: 'executor' },
    ])
    await app.close()
  })

  it('a note attached to an organizer-only document removes it from only_one_person_knows', async () => {
    const { app } = await build()
    const created = await app.inject({
      method: 'POST',
      url: '/family/legacy/documents',
      payload: willDoc({ visibility: 'organizer' }),
    })
    const docId = created.json().document.id
    await app.inject({
      method: 'POST',
      url: '/family/legacy/notes',
      payload: { node: { kind: 'document', id: docId }, text: 'Spare key is with Sam' },
    })
    const res = await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=m-adult' })
    expect(res.json().only_one_person_knows).toHaveLength(0)
    await app.close()
  })

  it('100 findability when the register is empty', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/family/legacy/rehearsal?as=m-adult' })
    expect(res.json().findability_pct).toBe(100)
    await app.close()
  })
})

describe('PATCH /family/assets/:id/legacy', () => {
  it('400s on a non-property asset; attaches on property', async () => {
    const { app } = await build()
    assets.push({ id: 'a1', tenant_id: TENANT, kind: 'vehicle', name: 'Car', value_minor: 500_000, created_at: new Date(), updated_at: new Date() })
    assets.push({ id: 'a2', tenant_id: TENANT, kind: 'property', name: 'Flat', value_minor: 20_000_000, created_at: new Date(), updated_at: new Date() })

    const legacy = {
      ownership_basis: 'inherited',
      jurisdiction: 'England & Wales',
      recorded_owners: [{ role: 'beneficiary', member_id: 'm-org', share_pct: 100, verification: 'document_linked' }],
      claimed_owners: [],
      verification: 'user_declared',
    }
    const wrong = await app.inject({ method: 'PATCH', url: '/family/assets/a1/legacy', payload: legacy })
    expect(wrong.statusCode).toBe(400)

    const ok = await app.inject({ method: 'PATCH', url: '/family/assets/a2/legacy', payload: legacy })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().asset.legacy.ownership_basis).toBe('inherited')

    const list = await app.inject({ method: 'GET', url: '/family/assets' })
    expect(list.json().assets.find((a: { id: string }) => a.id === 'a2').legacy).toBeTruthy()
    expect(list.json().assets.find((a: { id: string }) => a.id === 'a1').legacy).toBeNull()
    await app.close()
  })
})
