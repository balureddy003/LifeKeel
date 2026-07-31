'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Info, Home, Landmark, Wallet, Plane, CreditCard, Car } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, PageHeader, EmptyState } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { INBOX_ITEMS } from '@/lib/onboarding-data'
import type { InboxItem } from '@/lib/onboarding-data'

const INBOX_ICONS: Record<string, LucideIcon> = {
  '1': Home,
  '2': Landmark,
  '3': Wallet,
  '4': Plane,
  '5': CreditCard,
  '6': Car,
}

const priorityColor = (priority: 'high' | 'medium' | 'low') => {
  const colors = { high: '#f87171', medium: '#fbbf24', low: '#4ade80' }
  return colors[priority]
}

const actionTypeColor = (type: InboxItem['actionType']) => {
  const colors: Record<string, string> = {
    review: '#fbbf24',
    renew: '#f87171',
    compare: '#60a5fa',
    update: '#a78bfa',
    info: '#8a8070',
  }
  return colors[type] ?? '#8a8070'
}

export default function InboxPage() {
  const [items, setItems] = useState(INBOX_ITEMS)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const unreadCount = items.filter((i) => !i.read).length

  const handleTap = (id: string) => {
    haptic('light')
    setExpandedId(expandedId === id ? null : id)
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)))
  }

  const handleAction = (item: InboxItem) => {
    haptic('success')
  }

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader
        title="Inbox"
        subtitle="AI reads your financial mail for you"
        action={
          unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-xs font-bold text-white px-2 py-0.5 rounded-full"
              style={{ background: '#f87171' }}
            >
              {unreadCount}
            </motion.span>
          )
        }
      />

      {/* AI Summary banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GlassCard className="p-4 border-family-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Bot size={18} className="text-family-400" />
            <span className="text-sm font-semibold text-family-400">AI Summary</span>
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed">
            You have {unreadCount} unread items. Two need attention: your <strong>home insurance renews next month</strong> with a 12% price increase, and your <strong>travel insurance expires</strong> before your upcoming trip.
          </p>
        </GlassCard>
      </motion.div>

      {/* Inbox items */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={Bot}
              title="Inbox zero"
              description="You're all caught up. Connect your email to automatically receive financial notifications here."
              actionLabel="Connect email"
              onAction={() => haptic('light')}
            />
          </GlassCard>
        ) : (
          items.map((item, i) => {
          const isExpanded = expandedId === item.id
          const color = priorityColor(item.priority)
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.06 }}
            >
              <GlassCard
                className="overflow-hidden"
                interactive
              >
                <button
                  onClick={() => handleTap(item.id)}
                  className="w-full p-4 flex items-start gap-3 text-left"
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${priorityColor(item.priority)}15` }}>
                    {(() => {
                      const InboxIcon = INBOX_ICONS[item.id] ?? Info
                      return <InboxIcon size={18} color={priorityColor(item.priority)} strokeWidth={1.5} />
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-ink-tertiary">{item.source}</span>
                      {!item.read && (
                        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      )}
                      <span className="text-xs text-ink-tertiary ml-auto">{item.date}</span>
                    </div>
                    <div className={`text-sm font-semibold ${item.read ? 'text-ink-secondary' : 'text-ink-primary'}`}>
                      {item.subject}
                    </div>
                    {!isExpanded && (
                      <p className="text-xs text-ink-tertiary mt-1 line-clamp-2">
                        {item.aiSummary}
                      </p>
                    )}
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        <div className="glass rounded-2xl p-3 mb-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Bot size={14} className="text-family-400" />
                            <span className="text-xs font-semibold text-family-400">AI explains</span>
                          </div>
                          <p className="text-sm text-ink-secondary leading-relaxed">
                            {item.aiSummary}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleAction(item)}
                            className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white"
                            style={{ background: actionTypeColor(item.actionType) }}
                          >
                            {item.actionLabel}
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleTap(item.id)}
                            className="glass rounded-2xl px-4 py-3 text-sm font-semibold text-ink-tertiary"
                          >
                            Dismiss
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>
          )
        })
        )}
      </div>

      {/* Empty state hint */}
      <div className="glass rounded-2xl p-4 flex items-start gap-2">
        <Info size={18} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          Connect your email to automatically see every financial notification — bank statements, insurance renewals, pension updates — all summarized in plain language.
        </p>
      </div>
    </div>
  )
}
