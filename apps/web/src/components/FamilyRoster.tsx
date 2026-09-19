'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home as HomeIcon, User, ChevronRight, Maximize2 } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth-context'
import { ROLE_LABELS } from '@/lib/auth-types'
import { getMemberSections, CATEGORY_COLOR } from '@/lib/familySections'
import { fetchFinancialProfile, type FinancialProfilePolicy } from '@/lib/api'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

interface FamilyRosterProps {
  showFullMapLink?: boolean
}

export function FamilyRoster({ showFullMapLink = true }: FamilyRosterProps) {
  const { family } = useAuth()
  const router = useRouter()
  const members = family?.members ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [policies, setPolicies] = useState<FinancialProfilePolicy[]>([])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((profile) => {
      if (!cancelled) setPolicies(profile?.policies ?? [])
    })
    return () => { cancelled = true }
  }, [])

  const selected = members.length === 0
    ? null
    : members.find((m) => m.id === selectedId)
      ?? members.find((m) => m.role === 'organizer')
      ?? members[0]!

  const sections = useMemo(() => {
    if (!selected) return []
    return getMemberSections({
      id: selected.id,
      name: selected.name,
      role: selected.role,
      emoji: selected.emoji,
      relation: selected.role === 'organizer' ? 'owner' : selected.role === 'parent' ? 'spouse' : 'child',
    }, policies)
  }, [selected, policies])

  if (members.length === 0 || !selected) {
    return (
      <div className="glass rounded-3xl p-6 flex flex-col items-center text-center gap-3">
        <HomeIcon size={32} className="text-ink-tertiary" />
        <p className="text-sm text-ink-tertiary leading-relaxed">
          Add family members to see who&apos;s covered.
        </p>
        <Link
          href="/family-setup"
          onClick={() => haptic('light')}
          className="text-sm text-family-400 font-semibold flex items-center gap-1"
        >
          Set up family <ChevronRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div className="glass rounded-3xl p-4">
      {/* Roster row */}
      <div className="flex gap-2 mb-4">
        {members.map((m) => {
          const active = selected.id === m.id
          const initial = initials(m.name)
          return (
            <button
              key={m.id}
              onClick={() => { setSelectedId(m.id); haptic('light') }}
              aria-pressed={active}
              title={m.name}
              className={`flex-1 min-w-0 rounded-2xl px-2 py-3 text-center border transition-colors ${
                active ? 'bg-family-500/10 border-family-500/30' : 'border-tint/[0.06]'
              }`}
            >
              <div className="relative w-9 h-9 mx-auto mb-1.5">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                    active ? 'bg-family-500/20 text-family-400' : 'bg-tint/5 text-ink-tertiary'
                  }`}
                >
                  {initial || <User size={16} />}
                </div>
                {m.status === 'pending' && (
                  <div
                    className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-warning border-2 border-surface-0"
                    title="Invite pending"
                    aria-label="Invite pending"
                  />
                )}
              </div>
              {/* Live-verification finding: with 4 equal-width columns on a
                  375px viewport, a full name ("Nihaan Reddy Palayam") had
                  no room and truncated mid-word ("Ni..."), unreadable at a
                  glance — exactly the case this roster exists to make fast.
                  First name matches the same precedent the empty-state copy
                  just below already uses (selected.name.split(' ')[0]);
                  the full name is still one tap away on the member's own
                  page, and available as a hover title here. */}
              <div className="text-xs font-semibold text-ink-primary truncate">{m.name.split(' ')[0]}</div>
              <div className={`text-caption truncate ${m.status === 'pending' ? 'text-warning font-medium' : 'text-ink-tertiary'}`}>
                {m.status === 'pending' ? 'Pending' : ROLE_LABELS[m.role]}
              </div>
            </button>
          )
        })}
      </div>

      {/* Sections for the selected member */}
      {sections.length === 0 ? (
        <p className="text-sm text-ink-tertiary px-1 py-2">
          Nothing set up for {selected.name.split(' ')[0]} yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {sections.map((s) => {
            const Icon = s.icon
            const color = CATEGORY_COLOR[s.category]
            const isAsset = s.kind === 'asset'
            // Every row here is a drill-down into real data — asset rows
            // into /asset/[id], category rows into the Financial Profile
            // step that edits them — so every row gets the same tappable
            // treatment and chevron instead of some looking identical to
            // others but silently not responding to a tap.
            const dest = isAsset ? `/asset/${s.navId}` : s.href
            return (
              <div
                key={s.id}
                onClick={dest ? () => { haptic('light'); router.push(dest) } : undefined}
                role={dest ? 'button' : undefined}
                tabIndex={dest ? 0 : undefined}
                onKeyDown={dest ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (e.key === ' ') e.preventDefault()
                    haptic('light')
                    router.push(dest)
                  }
                } : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 bg-tint/[0.03] ${dest ? 'active:opacity-70 cursor-pointer' : ''}`}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${color}18` }}
                >
                  <Icon size={15} color={color} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink-primary truncate">{s.label}</div>
                  {s.story && !isAsset && (
                    <div className="text-footnote text-ink-tertiary line-clamp-2">{s.story}</div>
                  )}
                </div>
                {dest && <ChevronRight size={14} className="text-ink-tertiary flex-shrink-0" />}
              </div>
            )
          })}
        </div>
      )}

      {/* View profile + full map */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-tint/5">
        <Link
          href={`/member/${selected.id}`}
          onClick={() => haptic('light')}
          className="text-xs text-family-400 font-semibold flex items-center gap-1"
        >
          View {selected.name.split(' ')[0]}&apos;s profile <ChevronRight size={12} />
        </Link>
        {showFullMapLink && (
          <Link
            href="/map"
            onClick={() => haptic('light')}
            className="flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary transition-colors"
          >
            <Maximize2 size={12} /> Full map
          </Link>
        )}
      </div>
    </div>
  )
}
