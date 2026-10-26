'use client'

/**
 * /legacy (PRD-137 §8) — the family legacy register surface: documents
 * grouped by who they're about, property legacy details, and the Family
 * map (the §5 graph as plain SVG — no graph library; layered columns like
 * ScenarioTimeline's layout math).
 *
 * Every claim is a family declaration: verification badges ride every
 * record (document linked · user declared · family understanding ·
 * unverified) and the estate score carries the "not legal validity"
 * caption. Adult-only — the API 403s children and the page shows the
 * same "Adults only" state the vault uses.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageHeader, GlassCard, EmptyState, Skeleton } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import {
  fetchLegacyDocuments,
  createLegacyDocument,
  updateLegacyDocument,
  deleteLegacyDocument,
  fetchLegacyContacts,
  createLegacyContact,
  fetchLegacyNotes,
  createLegacyNote,
  fetchLegacyGraph,
  fetchFamilyAssets,
  fetchFamilyGroup,
  fetchFamilyReadiness,
  fetchVaultDocuments,
  updateAssetLegacy,
  type LegacyDocument,
  type LegacyDocumentInput,
  type LegacyContact,
  type LegacyContactInput,
  type LegacyNote,
  type LegacyRole,
  type LegacyVerification,
  type LegacyGraph,
  type FamilyAsset,
  type ApiFamilyMember,
  type ReadinessComponent,
  type VaultDocument,
  type PropertyLegacy,
} from '@/lib/api'
import {
  Landmark,
  Loader2,
  Lock,
  Map as MapIcon,
  ScrollText,
  UserPlus,
  X,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'

const DOC_TYPES: LegacyDocument['type'][] = [
  'will',
  'codicil',
  'power_of_attorney',
  'advance_directive',
  'trust_deed',
  'letter_of_wishes',
  'guardianship_nomination',
  'funeral_wishes',
  'probate_record',
  'civil_certificate',
]
const ROLE_TYPES: LegacyRole['role'][] = [
  'executor',
  'trustee',
  'attorney',
  'guardian',
  'beneficiary',
  'witness',
  'caretaker',
  'successor_intended',
]
const VISIBILITIES: LegacyDocument['visibility'][] = ['adults', 'organizer', 'named_roles']
const OWNERSHIP_BASIS: PropertyLegacy['ownership_basis'][] = [
  'purchase',
  'inherited',
  'gift',
  'trust',
  'customary_succession',
  'unknown',
]
const DISPUTES: PropertyLegacy['dispute'][] = ['none', 'possible', 'active', 'unknown']
const INSURED: PropertyLegacy['insured'][] = ['yes', 'no', 'unknown']
const CONTACT_KINDS: LegacyContact['kind'][] = [
  'family',
  'solicitor',
  'notary',
  'accountant',
  'land_agent',
  'other',
]

const MEDICAL_HELPER =
  "Please don't include medical details — this register isn't the place for health information."
const CAPTION = "Completeness and freshness of what's recorded — not legal validity."

const VERIFICATION_STYLES: Record<LegacyVerification, { label: string; cls: string }> = {
  document_linked: { label: 'document linked', cls: 'bg-success/15 text-success' },
  user_declared: { label: 'user declared', cls: 'bg-tint/10 text-ink-secondary' },
  family_understanding: { label: 'family understanding', cls: 'bg-warning/15 text-warning' },
  unverified: { label: 'unverified', cls: 'bg-danger/15 text-danger' },
}

function VBadge({ v }: { v?: LegacyVerification | undefined }) {
  if (!v) return null
  const s = VERIFICATION_STYLES[v]
  return (
    <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${s.cls}`}>{s.label}</span>
  )
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString() : null)

/** "Review due" when review_due_on is within 90 days, or the last
 *  review/signature is >36 months old. Undated docs are unknown, not due. */
function reviewDue(d: LegacyDocument, now = Date.now()): boolean {
  if (d.review_due_on) return new Date(d.review_due_on).getTime() - now <= 90 * 86_400_000
  const base = d.last_reviewed_on ?? d.signed_on
  return base !== undefined && now - new Date(base).getTime() > 36 * 30.44 * 86_400_000
}

const inputCls =
  'glass-input w-full rounded-xl px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40'
const labelCls = 'text-xs text-ink-tertiary'
const selectCls =
  'rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2 py-1.5 text-xs text-ink-primary'

// ── Document edit sheet ─────────────────────────────────────────────────

interface DocDraft {
  type: LegacyDocument['type']
  subject_member_id: string
  jurisdiction: string
  signed_on: string
  last_reviewed_on: string
  original_location: string
  vault_document_id: string
  roles: LegacyRole[]
  covers_asset_ids: string[]
  visibility: LegacyDocument['visibility']
  notes: string
}

function emptyDraft(subjectId: string): DocDraft {
  return {
    type: 'will',
    subject_member_id: subjectId,
    jurisdiction: '',
    signed_on: '',
    last_reviewed_on: '',
    original_location: '',
    vault_document_id: '',
    roles: [],
    covers_asset_ids: [],
    visibility: 'adults',
    notes: '',
  }
}

function DocSheet({
  draft,
  members,
  contacts,
  vaultDocs,
  propertyAssets,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: DocDraft
  members: ApiFamilyMember[]
  contacts: LegacyContact[]
  vaultDocs: VaultDocument[]
  propertyAssets: FamilyAsset[]
  saving: boolean
  onChange: (d: DocDraft) => void
  onClose: () => void
  onSave: () => void
}) {
  const set = (patch: Partial<DocDraft>) => onChange({ ...draft, ...patch })
  const setRole = (i: number, patch: Partial<LegacyRole>) =>
    set({ roles: draft.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  return (
    <div
      className="fixed inset-0 z-modal bg-black/70 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl p-4 max-w-lg w-full space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Legacy document</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            Type
            <select
              value={draft.type}
              onChange={(e) => set({ type: e.target.value as DocDraft['type'] })}
              className={`${selectCls} mt-1 w-full`}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            About whom
            <select
              value={draft.subject_member_id}
              onChange={(e) => set({ subject_member_id: e.target.value })}
              className={`${selectCls} mt-1 w-full`}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={`${labelCls} block`}>
          Jurisdiction
          <input
            value={draft.jurisdiction}
            onChange={(e) => set({ jurisdiction: e.target.value })}
            placeholder="England & Wales"
            aria-label="Jurisdiction"
            className={`${inputCls} mt-1`}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            Signed on
            <input
              type="date"
              value={draft.signed_on}
              onChange={(e) => set({ signed_on: e.target.value })}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Last reviewed
            <input
              type="date"
              value={draft.last_reviewed_on}
              onChange={(e) => set({ last_reviewed_on: e.target.value })}
              className={`${inputCls} mt-1`}
            />
          </label>
        </div>
        <label className={`${labelCls} block`}>
          Where the original lives
          <input
            value={draft.original_location}
            onChange={(e) => set({ original_location: e.target.value })}
            placeholder="e.g. Solicitor X, Leeds"
            aria-label="Where the original is kept"
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className={`${labelCls} block`}>
          Linked vault document
          <select
            value={draft.vault_document_id}
            onChange={(e) => set({ vault_document_id: e.target.value })}
            className={`${selectCls} mt-1 w-full`}
          >
            <option value="">None</option>
            {vaultDocs.map((v) => (
              <option key={v.id} value={v.id}>
                {v.filename}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={labelCls}>People named in it</span>
            <button
              type="button"
              onClick={() =>
                set({
                  roles: [
                    ...draft.roles,
                    {
                      role: 'executor',
                      ...(members[0] ? { member_id: members[0].id } : {}),
                      verification: 'user_declared',
                    },
                  ],
                })
              }
              className="text-xs text-family-400 font-semibold flex items-center gap-1"
            >
              <Plus size={12} /> Add role
            </button>
          </div>
          <div className="space-y-2">
            {draft.roles.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={r.role}
                  onChange={(e) => setRole(i, { role: e.target.value as LegacyRole['role'] })}
                  className={selectCls}
                >
                  {ROLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={r.member_id ? `m:${r.member_id}` : r.contact_id ? `c:${r.contact_id}` : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    const next: LegacyRole = { role: r.role, verification: r.verification }
                    if (r.share_pct !== undefined) next.share_pct = r.share_pct
                    if (v.startsWith('m:')) next.member_id = v.slice(2)
                    else if (v.startsWith('c:')) next.contact_id = v.slice(2)
                    set({ roles: draft.roles.map((x, j) => (j === i ? next : x)) })
                  }}
                  className={selectCls}
                >
                  <option value="">Pick…</option>
                  {members.map((m) => (
                    <option key={m.id} value={`m:${m.id}`}>
                      {m.name}
                    </option>
                  ))}
                  {contacts.map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name} (contact)
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="%"
                  value={r.share_pct ?? ''}
                  onChange={(e) => {
                    const next: LegacyRole = { ...r }
                    if (e.target.value === '') delete next.share_pct
                    else next.share_pct = Number(e.target.value)
                    set({ roles: draft.roles.map((x, j) => (j === i ? next : x)) })
                  }}
                  className={`${inputCls} w-16`}
                  aria-label="Share percent"
                />
                <button
                  aria-label="Remove role"
                  onClick={() => set({ roles: draft.roles.filter((_, j) => j !== i) })}
                  className="text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {propertyAssets.length > 0 && (
          <div>
            <div className={`${labelCls} mb-1.5`}>Covers these properties</div>
            <div className="flex flex-wrap gap-1.5">
              {propertyAssets.map((a) => {
                const on = draft.covers_asset_ids.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() =>
                      set({
                        covers_asset_ids: on
                          ? draft.covers_asset_ids.filter((x) => x !== a.id)
                          : [...draft.covers_asset_ids, a.id],
                      })
                    }
                    className={`rounded-full px-2.5 py-1 text-xs ${on ? 'bg-family-500/20 text-family-300 border border-family-500/30' : 'bg-tint/[0.04] text-ink-tertiary border border-tint/[0.08]'}`}
                  >
                    {a.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <label className={`${labelCls} block`}>
          Who can see this record
          <select
            value={draft.visibility}
            onChange={(e) => set({ visibility: e.target.value as DocDraft['visibility'] })}
            className={`${selectCls} mt-1 w-full`}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v === 'adults'
                  ? 'All adults'
                  : v === 'organizer'
                    ? 'Organizer only'
                    : 'Named people only'}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelCls} block`}>
          Notes
          <textarea
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={2}
            className={`${inputCls} mt-1`}
          />
          <span className="block text-[11px] text-ink-tertiary mt-1">{MEDICAL_HELPER}</span>
        </label>

        <button
          type="button"
          onClick={onSave}
          disabled={saving || !draft.jurisdiction.trim() || !draft.subject_member_id}
          className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-family-500/80 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving && <Loader2 size={14} className="animate-spin" />} Save record
        </button>
      </div>
    </div>
  )
}

// ── Property legacy sheet (minimal but complete) ─────────────────────────

function PropertySheet({
  asset,
  members,
  contacts,
  saving,
  onClose,
  onSave,
}: {
  asset: FamilyAsset
  members: ApiFamilyMember[]
  contacts: LegacyContact[]
  saving: boolean
  onClose: () => void
  onSave: (legacy: PropertyLegacy) => void
}) {
  const [legacy, setLegacy] = useState<PropertyLegacy>(
    asset.legacy ?? {
      ownership_basis: 'unknown',
      jurisdiction: '',
      recorded_owners: [],
      claimed_owners: [],
      insured: 'unknown',
      dispute: 'unknown',
      verification: 'user_declared',
    },
  )
  // exactOptionalPropertyTypes: optional fields must be deleted, never
  // assigned undefined.
  const setOpt = (
    key: 'title_reference' | 'occupants' | 'professional_contact_id',
    value: string,
  ) =>
    setLegacy((l) => {
      const next = { ...l }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  const ownerRow = (list: 'recorded_owners' | 'claimed_owners') => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={labelCls}>
          {list === 'recorded_owners' ? 'Recorded owners' : 'Claimed owners'}
        </span>
        <button
          type="button"
          onClick={() =>
            setLegacy({
              ...legacy,
              [list]: [
                ...legacy[list],
                {
                  role: 'beneficiary',
                  ...(members[0] ? { member_id: members[0].id } : {}),
                  verification: 'user_declared',
                },
              ],
            })
          }
          className="text-xs text-family-400 font-semibold flex items-center gap-1"
        >
          <Plus size={12} /> Add
        </button>
      </div>
      {legacy[list].map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1.5">
          <select
            value={r.member_id ? `m:${r.member_id}` : r.contact_id ? `c:${r.contact_id}` : ''}
            onChange={(e) => {
              const v = e.target.value
              const nr: LegacyRole = { role: r.role, verification: r.verification }
              if (r.share_pct !== undefined) nr.share_pct = r.share_pct
              if (v.startsWith('m:')) nr.member_id = v.slice(2)
              else if (v.startsWith('c:')) nr.contact_id = v.slice(2)
              const next = [...legacy[list]]
              next[i] = nr
              setLegacy({ ...legacy, [list]: next })
            }}
            className={selectCls}
          >
            <option value="">Pick…</option>
            {members.map((m) => (
              <option key={m.id} value={`m:${m.id}`}>
                {m.name}
              </option>
            ))}
            {contacts.map((c) => (
              <option key={c.id} value={`c:${c.id}`}>
                {c.name} (contact)
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="%"
            value={r.share_pct ?? ''}
            onChange={(e) => {
              const next = [...legacy[list]]
              const nr: LegacyRole = { ...r }
              if (e.target.value === '') delete nr.share_pct
              else nr.share_pct = Number(e.target.value)
              next[i] = nr
              setLegacy({ ...legacy, [list]: next })
            }}
            className={`${inputCls} w-16`}
            aria-label="Share percent"
          />
          <select
            value={r.verification}
            onChange={(e) => {
              const next = [...legacy[list]]
              next[i] = { ...r, verification: e.target.value as LegacyVerification }
              setLegacy({ ...legacy, [list]: next })
            }}
            className={selectCls}
          >
            {(Object.keys(VERIFICATION_STYLES) as LegacyVerification[]).map((v) => (
              <option key={v} value={v}>
                {v.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            aria-label="Remove owner"
            onClick={() => setLegacy({ ...legacy, [list]: legacy[list].filter((_, j) => j !== i) })}
            className="text-danger"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-modal bg-black/70 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl p-4 max-w-lg w-full space-y-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Legacy details — {asset.name}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            Ownership basis
            <select
              value={legacy.ownership_basis}
              onChange={(e) =>
                setLegacy({
                  ...legacy,
                  ownership_basis: e.target.value as PropertyLegacy['ownership_basis'],
                })
              }
              className={`${selectCls} mt-1 w-full`}
            >
              {OWNERSHIP_BASIS.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Jurisdiction
            <input
              value={legacy.jurisdiction}
              onChange={(e) => setLegacy({ ...legacy, jurisdiction: e.target.value })}
              className={`${inputCls} mt-1`}
            />
          </label>
        </div>
        {ownerRow('recorded_owners')}
        {ownerRow('claimed_owners')}
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            Title reference
            <input
              value={legacy.title_reference ?? ''}
              onChange={(e) => setOpt('title_reference', e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Occupants
            <input
              value={legacy.occupants ?? ''}
              onChange={(e) => setOpt('occupants', e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Insured
            <select
              value={legacy.insured}
              onChange={(e) =>
                setLegacy({ ...legacy, insured: e.target.value as PropertyLegacy['insured'] })
              }
              className={`${selectCls} mt-1 w-full`}
            >
              {INSURED.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Dispute
            <select
              value={legacy.dispute}
              onChange={(e) =>
                setLegacy({ ...legacy, dispute: e.target.value as PropertyLegacy['dispute'] })
              }
              className={`${selectCls} mt-1 w-full`}
            >
              {DISPUTES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={`${labelCls} block`}>
          Local professional
          <select
            value={legacy.professional_contact_id ?? ''}
            onChange={(e) => setOpt('professional_contact_id', e.target.value)}
            className={`${selectCls} mt-1 w-full`}
          >
            <option value="">None recorded</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onSave(legacy)}
          disabled={saving}
          className="w-full rounded-xl py-2.5 text-sm font-semibold text-white bg-family-500/80 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving && <Loader2 size={14} className="animate-spin" />} Save legacy details
        </button>
      </div>
    </div>
  )
}

// ── Family map (plain SVG layered layout) ────────────────────────────────

const NODE_W = 200
const NODE_H = 66
const COL_X = { member: 20, document: 260, policy: 260, asset: 520, contact: 520 }
const COL_ORDER: LegacyGraph['nodes'][number]['kind'][] = [
  'member',
  'document',
  'policy',
  'asset',
  'contact',
]

function LegacyMap({
  graph,
  onNodeClick,
}: {
  graph: LegacyGraph
  onNodeClick: (node: LegacyGraph['nodes'][number]) => void
}) {
  const positions = useMemo(() => {
    const cols = new Map<string, number>()
    const pos = new Map<string, { x: number; y: number }>()
    for (const kind of COL_ORDER) cols.set(kind, 0)
    for (const n of graph.nodes) {
      const col = n.kind === 'policy' ? 'document' : n.kind === 'contact' ? 'asset' : n.kind
      const count = cols.get(n.kind) ?? 0
      cols.set(n.kind, count + 1)
      pos.set(n.id, { x: COL_X[col as keyof typeof COL_X], y: 20 + count * (NODE_H + 24) })
    }
    return pos
  }, [graph])

  const [hoverEdge, setHoverEdge] = useState<number | null>(null)
  const height = Math.max(...[...positions.values()].map((p) => p.y), 0) + NODE_H + 40

  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Scrollable family legacy map"
    >
      <svg
        viewBox={`0 0 720 ${Math.max(height, 120)}`}
        className="w-full"
        style={{ minWidth: 720 }}
        role="img"
        aria-label="Family legacy map"
      >
        {graph.edges.map((e, i) => {
          const a = positions.get(e.from)
          const b = positions.get(e.to)
          if (!a || !b) return null
          return (
            <g
              key={i}
              onMouseEnter={() => setHoverEdge(i)}
              onMouseLeave={() => setHoverEdge(null)}
              onClick={() => setHoverEdge(i)}
            >
              <line
                x1={a.x + NODE_W}
                y1={a.y + NODE_H / 2}
                x2={b.x}
                y2={b.y + NODE_H / 2}
                stroke={hoverEdge === i ? '#8763aa' : 'rgba(211,184,245,0.35)'}
                strokeWidth={hoverEdge === i ? 2 : 1}
              />
              {hoverEdge === i && (
                <text
                  x={(a.x + NODE_W + b.x) / 2}
                  y={(a.y + b.y) / 2 + NODE_H / 2 - 4}
                  textAnchor="middle"
                  fontSize="16"
                  fill="#8763aa"
                >
                  {e.kind.replace(/_/g, ' ')}
                  {e.label ? ` — ${e.label}` : ''}
                </text>
              )}
            </g>
          )
        })}
        {graph.nodes.map((n) => {
          const p = positions.get(n.id)!
          const detail = [n.kind, n.verification?.replace(/_/g, ' '), n.sublabel]
            .filter(Boolean)
            .join(' · ')
          return (
            <g key={n.id} onClick={() => onNodeClick(n)} className="cursor-pointer">
              <title>
                {n.label}: {detail}
              </title>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={12}
                fill="rgba(211,184,245,0.08)"
                stroke="rgba(211,184,245,0.25)"
              />
              <text
                x={p.x + 10}
                y={p.y + 24}
                fontSize="16"
                fill="currentColor"
                className="text-ink-primary"
                fontWeight={600}
              >
                {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
              </text>
              <text x={p.x + 10} y={p.y + 50} fontSize="16" fill="#8763aa">
                {detail.length > 22 ? `${detail.slice(0, 21)}…` : detail}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

type Tab = 'documents' | 'property' | 'map'

export default function LegacyClient() {
  const toast = useToast()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('documents')
  const [loaded, setLoaded] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [docs, setDocs] = useState<LegacyDocument[]>([])
  const [contacts, setContacts] = useState<LegacyContact[]>([])
  const [notes, setNotes] = useState<LegacyNote[]>([])
  const [assets, setAssets] = useState<FamilyAsset[]>([])
  const [members, setMembers] = useState<ApiFamilyMember[]>([])
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([])
  const [graph, setGraph] = useState<LegacyGraph | null>(null)
  const [estate, setEstate] = useState<ReadinessComponent | null>(null)
  const [sheet, setSheet] = useState<DocDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [propSheet, setPropSheet] = useState<FamilyAsset | null>(null)
  const [selectedNode, setSelectedNode] = useState<LegacyGraph['nodes'][number] | null>(null)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [contactDraft, setContactDraft] = useState({
    name: '',
    relationship: '',
    kind: 'family' as LegacyContact['kind'],
  })

  const memberName = useCallback(
    (id?: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone',
    [members],
  )
  const roleTargetName = useCallback(
    (r: LegacyRole) =>
      r.member_id
        ? memberName(r.member_id)
        : (contacts.find((c) => c.id === r.contact_id)?.name ?? 'a recorded contact'),
    [memberName, contacts],
  )

  const load = useCallback(async () => {
    const [d, c, n, a, g, r, v] = await Promise.all([
      fetchLegacyDocuments(),
      fetchLegacyContacts(),
      fetchLegacyNotes(),
      fetchFamilyAssets(),
      fetchFamilyGroup(),
      fetchFamilyReadiness(),
      fetchVaultDocuments(),
    ])
    setDocs(d)
    setContacts(c)
    setNotes(n)
    setAssets(a.assets)
    setMembers((g?.members ?? []).filter((m) => m.status === 'active'))
    setEstate(r?.components.find((cp) => cp.key === 'estate') ?? null)
    setVaultDocs(v.documents)
    // Adults-only surface: a child roster role hides everything (the API
    // 403s too — this is just the friendly version of the same boundary).
    const me = g?.members.find((m) => m.id === user?.id || m.userId === user?.id)
    if (me?.role === 'child') setForbidden(true)
    setLoaded(true)
  }, [user?.id])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (tab === 'map' && !graph) void fetchLegacyGraph().then(setGraph)
  }, [tab, graph])

  const saveDoc = async () => {
    if (!sheet) return
    setSaving(true)
    const input: LegacyDocumentInput = {
      type: sheet.type,
      subject_member_id: sheet.subject_member_id,
      jurisdiction: sheet.jurisdiction.trim(),
      ...(sheet.signed_on ? { signed_on: sheet.signed_on } : {}),
      ...(sheet.last_reviewed_on ? { last_reviewed_on: sheet.last_reviewed_on } : {}),
      ...(sheet.original_location.trim()
        ? { original_location: sheet.original_location.trim() }
        : {}),
      ...(sheet.vault_document_id ? { vault_document_id: sheet.vault_document_id } : {}),
      roles: sheet.roles.filter((r) => r.member_id || r.contact_id),
      covers_asset_ids: sheet.covers_asset_ids,
      verification: 'user_declared',
      ...(sheet.notes.trim() ? { notes: sheet.notes.trim() } : {}),
      visibility: sheet.visibility,
    }
    const res = editingId
      ? await updateLegacyDocument(editingId, input)
      : await createLegacyDocument(input)
    setSaving(false)
    if (!res) {
      haptic('warning')
      toast({ message: "Couldn't save that record — try again", variant: 'error' })
      return
    }
    haptic('success')
    setSheet(null)
    setEditingId(null)
    await load()
  }

  const savePropertyLegacy = async (legacy: PropertyLegacy) => {
    if (!propSheet) return
    setSaving(true)
    const ok = await updateAssetLegacy(propSheet.id, legacy)
    setSaving(false)
    if (!ok) {
      toast({ message: "Couldn't save legacy details — try again", variant: 'error' })
      return
    }
    haptic('success')
    setPropSheet(null)
    await load()
  }

  const addNote = async () => {
    if (!selectedNode || !noteText.trim()) return
    const [kind, id] = selectedNode.id.split(':') as [LegacyNote['node']['kind'], string]
    const created = await createLegacyNote({ node: { kind, id }, text: noteText.trim() })
    if (created) {
      haptic('success')
      setNotes((prev) => [...prev, created])
      setNoteText('')
    } else {
      toast({ message: "Couldn't save that note — try again", variant: 'error' })
    }
  }

  const addContact = async () => {
    if (!contactDraft.name.trim()) return
    const input: LegacyContactInput = {
      name: contactDraft.name.trim(),
      relationship: contactDraft.relationship.trim() || contactDraft.kind,
      kind: contactDraft.kind,
    }
    const created = await createLegacyContact(input)
    if (created) {
      haptic('success')
      setContacts((prev) => [...prev, created])
      setContactDraft({ name: '', relationship: '', kind: 'family' })
    } else {
      toast({ message: "Couldn't add that contact — try again", variant: 'error' })
    }
  }

  const propertyAssets = assets.filter((a) => a.kind === 'property')
  const docsBySubject = useMemo(() => {
    const map = new Map<string, LegacyDocument[]>()
    for (const d of docs) {
      const list = map.get(d.subject_member_id) ?? []
      list.push(d)
      map.set(d.subject_member_id, list)
    }
    return [...map.entries()]
  }, [docs])

  const selectedNotes = selectedNode
    ? notes.filter((n) => n.node.id === selectedNode.id.split(':')[1])
    : []

  return (
    <div className="px-5 pt-2 pb-10 space-y-4">
      <PageHeader title="Legacy register" backHref="/" />

      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <Landmark size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          What the family has recorded about wills, authority documents, property and the people
          named in them. Every entry is a family declaration — the badge says how sure it is, not
          whether it's legally true.
        </p>
      </div>

      {estate && estate.score !== null && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Estate readiness</span>
            <span className="text-lg font-bold text-family-400">{estate.score}</span>
          </div>
          <p className="text-footnote text-ink-tertiary mt-1">{estate.caption ?? CAPTION}</p>
        </GlassCard>
      )}

      <a
        href="/vault"
        className="flex items-center gap-2 rounded-2xl bg-tint/[0.04] border border-tint/[0.08] px-4 py-3 active:opacity-70"
      >
        <Users size={15} className="text-family-400" />
        <span className="text-xs font-medium text-ink-secondary">
          Rehearse: could someone else find this?
        </span>
      </a>

      {!loaded ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : forbidden ? (
        <GlassCard>
          <EmptyState
            icon={Lock}
            title="Adults only"
            description="The legacy register is visible to adult family members."
          />
        </GlassCard>
      ) : (
        <>
          <div className="flex gap-1.5">
            {(['documents', 'property', 'map'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  haptic('light')
                  setTab(t)
                }}
                className={`flex-1 rounded-xl py-2 text-xs font-semibold ${tab === t ? 'bg-family-500/20 text-family-300 border border-family-500/30' : 'bg-tint/[0.04] text-ink-tertiary border border-tint/[0.08]'}`}
              >
                {t === 'documents'
                  ? 'Documents'
                  : t === 'property'
                    ? 'Property & land'
                    : 'Family map'}
              </button>
            ))}
          </div>

          {tab === 'documents' && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setEditingId(null)
                  setSheet(emptyDraft(members[0]?.id ?? ''))
                }}
                className="w-full rounded-2xl py-3 text-sm font-semibold text-family-400 bg-family-500/10 border border-family-500/20 flex items-center justify-center gap-1.5"
              >
                <Plus size={16} /> Record a document
              </button>

              {docsBySubject.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={ScrollText}
                    title="Nothing recorded yet"
                    description="Record a will, power of attorney, or guardianship nomination — with a verification label, so nobody mistakes it for a legal fact."
                  />
                </GlassCard>
              ) : (
                docsBySubject.map(([subjectId, subjectDocs]) => (
                  <div key={subjectId} className="space-y-2">
                    <div className="text-sm font-semibold text-ink-secondary px-1">
                      {memberName(subjectId)}
                    </div>
                    {subjectDocs.map((d) => (
                      <GlassCard key={d.id} className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold flex-1 capitalize">
                            {d.type.replace(/_/g, ' ')}
                          </span>
                          <VBadge v={d.verification} />
                          <span className="rounded-full bg-tint/10 text-ink-tertiary px-1.5 py-px text-[10px]">
                            {d.visibility === 'adults'
                              ? 'all adults'
                              : d.visibility === 'organizer'
                                ? 'organizer only'
                                : 'named people'}
                          </span>
                          {reviewDue(d) && (
                            <span className="rounded-full bg-warning/15 text-warning px-1.5 py-px text-[10px] font-medium">
                              Review due
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-tertiary space-y-0.5">
                          <div>
                            {d.jurisdiction}
                            {d.signed_on ? ` · signed ${fmt(d.signed_on)}` : ''}
                            {d.last_reviewed_on ? ` · reviewed ${fmt(d.last_reviewed_on)}` : ''}
                          </div>
                          <div>
                            {d.original_location
                              ? `Original: ${d.original_location}`
                              : 'Original location not recorded'}
                          </div>
                          {d.vault_document_id && (
                            <div className="flex items-center gap-1">
                              <Lock size={10} className="text-family-400" /> Copy sealed in the
                              vault
                            </div>
                          )}
                        </div>
                        {d.roles.length > 0 && (
                          <div className="space-y-1">
                            {d.roles.map((r, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="text-ink-secondary flex-1">
                                  {roleTargetName(r)} — {r.role.replace(/_/g, ' ')}
                                  {r.share_pct !== undefined ? ` · ${r.share_pct}%` : ''}
                                </span>
                                <VBadge v={r.verification} />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              setEditingId(d.id)
                              setSheet({
                                type: d.type,
                                subject_member_id: d.subject_member_id,
                                jurisdiction: d.jurisdiction,
                                signed_on: d.signed_on ?? '',
                                last_reviewed_on: d.last_reviewed_on ?? '',
                                original_location: d.original_location ?? '',
                                vault_document_id: d.vault_document_id ?? '',
                                roles: d.roles,
                                covers_asset_ids: d.covers_asset_ids,
                                visibility: d.visibility,
                                notes: d.notes ?? '',
                              })
                            }}
                            className="text-xs text-family-400 font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (await deleteLegacyDocument(d.id)) {
                                haptic('success')
                                await load()
                              } else
                                toast({ message: "Couldn't delete that record", variant: 'error' })
                            }}
                            className="text-xs text-danger font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      </GlassCard>
                    ))}
                  </div>
                ))
              )}

              {/* Contacts */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-ink-secondary px-1 flex items-center gap-1.5">
                  <UserPlus size={14} /> People outside the family
                </div>
                {contacts.map((c) => (
                  <GlassCard key={c.id} className="p-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-xs text-ink-tertiary">
                        {c.relationship}
                        {c.firm ? ` · ${c.firm}` : ''}
                        {c.email ? ` · ${c.email}` : ''}
                      </div>
                    </div>
                    <span className="rounded-full bg-tint/10 text-ink-tertiary px-1.5 py-px text-[10px]">
                      {c.kind.replace(/_/g, ' ')}
                    </span>
                  </GlassCard>
                ))}
                <GlassCard className="p-3.5 space-y-2">
                  <div className="flex gap-2">
                    <input
                      placeholder="Name"
                      aria-label="Name"
                      value={contactDraft.name}
                      onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
                      className={inputCls}
                    />
                    <select
                      value={contactDraft.kind}
                      onChange={(e) =>
                        setContactDraft({
                          ...contactDraft,
                          kind: e.target.value as LegacyContact['kind'],
                        })
                      }
                      className={selectCls}
                    >
                      {CONTACT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Relationship (e.g. family solicitor)"
                      aria-label="Relationship"
                      value={contactDraft.relationship}
                      onChange={(e) =>
                        setContactDraft({ ...contactDraft, relationship: e.target.value })
                      }
                      className={inputCls}
                    />
                    <button
                      onClick={() => void addContact()}
                      disabled={!contactDraft.name.trim()}
                      className="rounded-xl px-4 text-xs font-semibold text-white bg-family-500/80 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </GlassCard>
              </div>
            </div>
          )}

          {tab === 'property' && (
            <div className="space-y-2">
              {propertyAssets.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={MapIcon}
                    title="No properties recorded"
                    description="Add a property on the Assets page first, then record its legacy details here."
                  />
                </GlassCard>
              ) : (
                propertyAssets.map((a) => (
                  <GlassCard key={a.id} className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold flex-1">{a.name}</span>
                      {a.legacy && <VBadge v={a.legacy.verification} />}
                    </div>
                    {a.legacy ? (
                      <>
                        <div className="text-xs text-ink-tertiary">
                          {a.legacy.jurisdiction} · {a.legacy.ownership_basis.replace(/_/g, ' ')}
                          {a.legacy.title_reference
                            ? ` · title ref ${a.legacy.title_reference}`
                            : ' · no title evidence recorded'}
                          {a.legacy.occupants ? ` · occupied by ${a.legacy.occupants}` : ''}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span
                            className={`rounded-full px-1.5 py-px text-[10px] ${a.legacy.insured === 'yes' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
                          >
                            insured: {a.legacy.insured}
                          </span>
                          {a.legacy.dispute !== 'none' && a.legacy.dispute !== 'unknown' && (
                            <span className="rounded-full bg-danger/15 text-danger px-1.5 py-px text-[10px]">
                              dispute {a.legacy.dispute}
                            </span>
                          )}
                        </div>
                        {[
                          { label: 'Recorded owners', list: a.legacy.recorded_owners },
                          { label: 'Claimed owners', list: a.legacy.claimed_owners },
                        ].map(
                          ({ label, list }) =>
                            list.length > 0 && (
                              <div key={label} className="space-y-1">
                                <div className="text-[11px] text-ink-tertiary">{label}</div>
                                {list.map((r, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs">
                                    <span className="text-ink-secondary flex-1">
                                      {roleTargetName(r)}
                                      {r.share_pct !== undefined ? ` · ${r.share_pct}%` : ''}
                                    </span>
                                    <VBadge v={r.verification} />
                                  </div>
                                ))}
                              </div>
                            ),
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-ink-tertiary">
                        No legacy details recorded — who holds title, whether it's disputed, whether
                        it's insured.
                      </p>
                    )}
                    <button
                      onClick={() => setPropSheet(a)}
                      className="text-xs text-family-400 font-semibold"
                    >
                      {a.legacy ? 'Edit legacy details' : 'Add legacy details'}
                    </button>
                  </GlassCard>
                ))
              )}
            </div>
          )}

          {tab === 'map' && (
            <div className="space-y-3">
              {!graph ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : graph.nodes.length === 0 ? (
                <GlassCard>
                  <EmptyState
                    icon={MapIcon}
                    title="Nothing to map yet"
                    description="Record documents and property details first — the map draws itself from those."
                  />
                </GlassCard>
              ) : (
                <GlassCard className="p-2 overflow-x-auto">
                  <LegacyMap graph={graph} onNodeClick={setSelectedNode} />
                </GlassCard>
              )}
            </div>
          )}
        </>
      )}

      {/* Node detail side panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            className="fixed right-0 top-0 bottom-0 z-modal w-72 glass border-l border-tint/10 p-4 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">{selectedNode.label}</span>
              <button
                onClick={() => setSelectedNode(null)}
                aria-label="Close"
                className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary"
              >
                <X size={16} />
              </button>
            </div>
            <div className="text-xs text-ink-tertiary mb-2 flex items-center gap-1.5">
              {selectedNode.kind}
              {selectedNode.sublabel ? ` · ${selectedNode.sublabel}` : ''}{' '}
              <VBadge v={selectedNode.verification} />
            </div>
            {selectedNode.meta && (
              <div className="text-xs text-ink-secondary space-y-1 mb-3">
                {Object.entries(selectedNode.meta).map(([k, v]) =>
                  v ? (
                    <div key={k}>
                      <span className="text-ink-tertiary">{k.replace(/_/g, ' ')}:</span> {String(v)}
                    </div>
                  ) : null,
                )}
              </div>
            )}
            <div className="text-xs font-medium text-ink-secondary mb-1.5">Notes</div>
            {selectedNotes.length === 0 && (
              <p className="text-[11px] text-ink-tertiary mb-2">No notes yet.</p>
            )}
            {selectedNotes.map((n) => (
              <div key={n.id} className="rounded-xl bg-tint/[0.04] p-2.5 mb-1.5">
                <p className="text-xs text-ink-secondary">{n.text}</p>
                <span className="rounded-full bg-warning/15 text-warning px-1.5 py-px text-[10px] font-medium mt-1 inline-block">
                  family understanding
                </span>
              </div>
            ))}
            {/* Policy nodes are financial-profile entries, not legacy
             *  register records — notes attach to the other four kinds. */}
            {selectedNode.kind !== 'policy' && (
              <>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={2}
                  placeholder="Something only you know…"
                  aria-label="Note"
                  className={`${inputCls} mt-1`}
                />
                <span className="block text-[11px] text-ink-tertiary mt-1 mb-2">
                  {MEDICAL_HELPER}
                </span>
                <button
                  onClick={() => void addNote()}
                  disabled={!noteText.trim()}
                  className="w-full rounded-xl py-2 text-xs font-semibold text-white bg-family-500/80 disabled:opacity-50"
                >
                  Add a note
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet && (
          <DocSheet
            draft={sheet}
            members={members}
            contacts={contacts}
            vaultDocs={vaultDocs}
            propertyAssets={propertyAssets}
            saving={saving}
            onChange={setSheet}
            onClose={() => {
              setSheet(null)
              setEditingId(null)
            }}
            onSave={() => void saveDoc()}
          />
        )}
        {propSheet && (
          <PropertySheet
            asset={propSheet}
            members={members}
            contacts={contacts}
            saving={saving}
            onClose={() => setPropSheet(null)}
            onSave={(l) => void savePropertyLegacy(l)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
