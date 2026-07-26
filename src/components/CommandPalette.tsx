'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Home, Inbox, Users, AlertTriangle, Settings, Bot, Siren, Crown, Shield, Baby, Accessibility, Search, CornerDownLeft, ArrowUpDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'

interface Command {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  action: () => void
  section: 'navigate' | 'actions' | 'mode'
}

export function CommandPalette() {
  const { cmdkOpen, setCmdkOpen, setMode, setEmergencyOpen } = useAppStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()

  const commands: Command[] = [
    { id: 'home', label: 'Go to Home', icon: Home, shortcut: 'G H', section: 'navigate', action: () => router.push('/') },
    { id: 'inbox', label: 'Open Inbox', icon: Inbox, shortcut: 'G I', section: 'navigate', action: () => router.push('/inbox') },
    { id: 'family', label: 'View Family', icon: Users, shortcut: 'G F', section: 'navigate', action: () => router.push('/family') },
    { id: 'events', label: 'What If Scenarios', icon: AlertTriangle, shortcut: 'G E', section: 'navigate', action: () => router.push('/events') },
    { id: 'settings', label: 'Settings', icon: Settings, shortcut: 'G S', section: 'navigate', action: () => router.push('/settings') },
    { id: 'assistant', label: 'Ask AI', icon: Bot, shortcut: 'G A', section: 'navigate', action: () => router.push('/assistant') },
    { id: 'emergency', label: 'Emergency Mode', icon: Siren, shortcut: 'E', section: 'actions', action: () => { setEmergencyOpen(true); setCmdkOpen(false) } },
    { id: 'mode-organizer', label: 'Switch to Organizer Mode', icon: Crown, section: 'mode', action: () => { setMode('organizer'); haptic('success') } },
    { id: 'mode-parent', label: 'Switch to Parent Mode', icon: Shield, section: 'mode', action: () => { setMode('parent'); haptic('success') } },
    { id: 'mode-child', label: 'Switch to Child Mode', icon: Baby, section: 'mode', action: () => { setMode('child'); haptic('success') } },
    { id: 'mode-elderly', label: 'Switch to Elderly Mode', icon: Accessibility, section: 'mode', action: () => { setMode('elderly'); haptic('success') } },
  ]

  const filtered = commands.filter((c) =>
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

  const sections = ['navigate', 'actions', 'mode'] as const
  const sectionLabels = { navigate: 'Navigate', actions: 'Quick Actions', mode: 'Switch Mode' }

  return (
    <AnimatePresence>
      {cmdkOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setCmdkOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg glass-strong rounded-3xl overflow-hidden shadow-2xl"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
              <Search size={18} className="text-ink-tertiary" />
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-base text-ink-primary placeholder:text-ink-tertiary outline-none"
              />
              <kbd className="text-[10px] text-ink-tertiary glass rounded-md px-2 py-1">ESC</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto no-scrollbar py-2">
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
                    <div className="px-5 py-1.5 text-[10px] font-bold text-ink-tertiary uppercase tracking-wider">
                      {sectionLabels[section]}
                    </div>
                    {items.map((cmd) => {
                      const idx = filtered.indexOf(cmd)
                      const isActive = idx === selectedIndex
                      return (
                        <button
                          key={cmd.id}
                          onClick={() => {
                            cmd.action()
                            setCmdkOpen(false)
                            setQuery('')
                            haptic('light')
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full px-5 py-2.5 flex items-center gap-3 text-left transition-colors ${
                            isActive ? 'bg-white/[0.06]' : ''
                          }`}
                        >
                          <cmd.icon size={18} className="text-ink-tertiary flex-shrink-0" />
                          <span className="text-sm text-ink-primary flex-1">{cmd.label}</span>
                          {cmd.shortcut && (
                            <kbd className="text-[10px] text-ink-tertiary glass rounded-md px-2 py-0.5 font-mono">
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

            {/* Footer */}
            <div className="px-5 py-2.5 border-t border-white/5 flex items-center justify-between text-[10px] text-ink-tertiary">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="glass rounded px-1.5 py-0.5 flex items-center"><ArrowUpDown size={10} /></kbd> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="glass rounded px-1.5 py-0.5 flex items-center"><CornerDownLeft size={10} /></kbd> Select
                </span>
              </div>
              <span>Family AI · Cmd+K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
