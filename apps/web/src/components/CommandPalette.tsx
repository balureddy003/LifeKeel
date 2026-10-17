'use client'

import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Home, Inbox, Users, AlertTriangle, Settings, Bot, Siren, Crown, Shield, Baby, Accessibility, Search, CornerDownLeft, ArrowUpDown, User, Heart, Wallet, Target, PiggyBank, Map, Upload, Plug, Landmark } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { useMode } from '@/lib/mode-context'
import { haptic } from '@/lib/haptics'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { LIFE_EVENTS } from '@/lib/life-data'
import { useAuth } from '@/lib/auth-context'

interface Command {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  action: () => void
  section: 'navigate' | 'actions' | 'mode' | 'content'
}

export function CommandPalette() {
  const { cmdkOpen, setCmdkOpen } = useAppStore()
  const { setMode, activateEmergency } = useMode()
  const { family } = useAuth()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const containerRef = useFocusTrap<HTMLDivElement>(cmdkOpen)

  const contentCommands: Command[] = useMemo(() => [
    ...(family?.members ?? []).map((m) => ({
      id: `member-${m.id}`,
      label: m.name,
      icon: User,
      section: 'content' as const,
      action: () => router.push(`/member/${m.id}`),
    })),
    ...LIFE_EVENTS.map((e) => ({
      id: `event-${e.id}`,
      label: e.label,
      icon: AlertTriangle,
      section: 'content' as const,
      action: () => router.push(`/events/${e.id}`),
    })),
    { id: 'health-protection', label: 'Health: Protection', icon: Heart, section: 'content' as const, action: () => router.push('/health/protection') },
    { id: 'health-wealth', label: 'Health: Wealth', icon: Wallet, section: 'content' as const, action: () => router.push('/health/wealth') },
    { id: 'health-goals', label: 'Health: Goals', icon: Target, section: 'content' as const, action: () => router.push('/health/goals') },
    { id: 'health-savings', label: 'Health: Savings', icon: PiggyBank, section: 'content' as const, action: () => router.push('/health/savings') },
  ], [router, family?.members])

  const commands: Command[] = [
    { id: 'home', label: 'Go to Home', icon: Home, shortcut: 'G H', section: 'navigate', action: () => router.push('/') },
    { id: 'inbox', label: 'Open Inbox', icon: Inbox, shortcut: 'G I', section: 'navigate', action: () => router.push('/inbox') },
    { id: 'family', label: 'View Family', icon: Users, shortcut: 'G F', section: 'navigate', action: () => router.push('/family') },
    { id: 'events', label: 'What If Scenarios', icon: AlertTriangle, shortcut: 'G E', section: 'navigate', action: () => router.push('/events') },
    { id: 'settings', label: 'Settings', icon: Settings, shortcut: 'G S', section: 'navigate', action: () => router.push('/settings') },
    { id: 'assistant', label: 'Ask AI', icon: Bot, shortcut: 'G A', section: 'navigate', action: () => router.push('/assistant') },
    { id: 'map', label: 'Family Map', icon: Map, shortcut: 'G M', section: 'navigate', action: () => router.push('/map') },
    { id: 'legacy', label: 'Legacy Register', icon: Landmark, shortcut: 'G L', section: 'navigate', action: () => router.push('/legacy') },
    { id: 'upload', label: 'Upload Documents', icon: Upload, shortcut: 'G U', section: 'navigate', action: () => router.push('/upload') },
    { id: 'connect', label: 'Connect Services', icon: Plug, shortcut: 'G C', section: 'navigate', action: () => router.push('/connect') },
    { id: 'emergency', label: 'Emergency Mode', icon: Siren, shortcut: 'E', section: 'actions', action: () => { activateEmergency(); setCmdkOpen(false) } },
    { id: 'mode-organizer', label: 'Switch to Organizer Mode', icon: Crown, section: 'mode', action: () => { setMode('organizer'); haptic('success') } },
    { id: 'mode-parent', label: 'Switch to Parent Mode', icon: Shield, section: 'mode', action: () => { setMode('parent'); haptic('success') } },
    { id: 'mode-child', label: 'Switch to Child Mode', icon: Baby, section: 'mode', action: () => { setMode('child'); haptic('success') } },
    { id: 'mode-elderly', label: 'Switch to Elderly Mode', icon: Accessibility, section: 'mode', action: () => { setMode('elderly'); haptic('success') } },
  ]

  const allCommands = [...commands, ...contentCommands]
  const filtered = allCommands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdkOpen(!cmdkOpen)
      }
      if (e.key === 'Escape' && cmdkOpen) {
        setCmdkOpen(false)
      }
      if (cmdkOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
        }
        if (e.key === 'Enter' && filtered[selectedIndex]) {
          e.preventDefault()
          filtered[selectedIndex].action()
          setCmdkOpen(false)
          setQuery('')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cmdkOpen, setCmdkOpen, filtered, selectedIndex])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const sections = ['navigate', 'content', 'actions', 'mode'] as const
  const sectionLabels = { navigate: 'Navigate', content: 'Family & Assets', actions: 'Quick Actions', mode: 'Switch Mode' }

  return (
    <AnimatePresence>
      {cmdkOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-modal flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setCmdkOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            ref={containerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative w-full max-w-lg glass-strong rounded-3xl overflow-hidden shadow-2xl outline-none"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-tint/5">
              <Search size={18} className="text-ink-tertiary" />
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                role="combobox"
                aria-expanded={filtered.length > 0}
                aria-controls="cmdk-listbox"
                aria-autocomplete="list"
                aria-activedescendant={filtered[selectedIndex] ? `cmdk-option-${filtered[selectedIndex].id}` : undefined}
                className="flex-1 bg-transparent text-base text-ink-primary placeholder:text-ink-tertiary outline-none"
              />
              <kbd className="text-caption text-ink-tertiary glass rounded-md px-2 py-1">ESC</kbd>
            </div>

            {/* Results */}
            <div id="cmdk-listbox" role="listbox" aria-label="Command results" className="max-h-[50vh] overflow-y-auto no-scrollbar py-2">
              {filtered.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-ink-tertiary">
                  No results for "{query}"
                </div>
              )}
              {sections.map((section) => {
                const items = filtered.filter((c) => c.section === section)
                if (items.length === 0) return null
                return (
                  <div key={section}>
                    <div className="px-5 py-1.5 text-caption font-bold text-ink-tertiary uppercase tracking-wider">
                      {sectionLabels[section]}
                    </div>
                    {items.map((cmd) => {
                      const idx = filtered.indexOf(cmd)
                      const isActive = idx === selectedIndex
                      return (
                        <button
                          key={cmd.id}
                          id={`cmdk-option-${cmd.id}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            cmd.action()
                            setCmdkOpen(false)
                            setQuery('')
                            haptic('light')
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full px-5 py-2.5 flex items-center gap-3 text-left transition-colors ${
                            isActive ? 'bg-tint/[0.06]' : ''
                          }`}
                        >
                          <cmd.icon size={18} className="text-ink-tertiary flex-shrink-0" />
                          <span className="text-sm text-ink-primary flex-1">{cmd.label}</span>
                          {cmd.shortcut && (
                            <kbd className="hidden md:inline-block text-caption text-ink-tertiary glass rounded-md px-2 py-0.5 font-mono">
                              {cmd.shortcut}
                            </kbd>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Footer — keyboard hints are irrelevant on touch devices */}
            <div className="hidden md:flex px-5 py-2.5 border-t border-tint/5 items-center justify-between text-caption text-ink-tertiary">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="glass rounded px-1.5 py-0.5 flex items-center"><ArrowUpDown size={10} /></kbd> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="glass rounded px-1.5 py-0.5 flex items-center"><CornerDownLeft size={10} /></kbd> Select
                </span>
              </div>
              <span>Keel · Cmd+K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
