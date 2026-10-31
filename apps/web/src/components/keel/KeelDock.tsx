'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Bot, ChevronUp, Minus, Plus, Siren, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { isKeelPanelEnabled, onKeelDataChanged } from '@/lib/keel/client'
import { usePresentation, type Presentation } from '@/lib/keel/presentation'
import { collectAnchors } from '@/lib/keel/spotlight'
import { MAX_WIDTH, MIN_WIDTH, useKeelPanel } from '@/lib/keel/store'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { NavChip } from './KeelCards'
import { KeelComposer } from './KeelComposer'
import { KeelThread } from './KeelThread'

import { PANEL_ID } from './panel-id'

export { PANEL_ID }

/** The setup summary that stays above the conversation. */
function SetupSummary({ onNavigate }: { onNavigate?: () => void }) {
  const setup = useKeelPanel((s) => s.setup)
  const failed = useKeelPanel((s) => s.setupFailed)
  if (!setup || setup.role === 'child')
    return failed ? (
      <p className="px-3 py-2 text-xs text-ink-tertiary">
        Couldn&apos;t check your setup just now.
      </p>
    ) : null
  if (setup.verified_complete) return null
  const next = setup.steps.find((s) => s.id === setup.next_step_id)
  const pct = setup.total > 0 ? Math.round((setup.completed / setup.total) * 100) : 0
  return (
    <div
      className="mx-3 mb-2 rounded-xl border border-ink-tertiary/15 p-3"
      data-testid="setup-summary"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-ink-primary">
          Setup {setup.completed} of {setup.total}
        </span>
        {failed && <span className="text-warning">Couldn&apos;t refresh</span>}
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={setup.completed}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full bg-family-500" style={{ width: `${pct}%` }} />
      </div>
      {next && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-ink-secondary">Next: {next.title}</p>
          <NavChip
            card={{
              kind: 'navigate',
              route_key: next.route_key,
              label: 'Open',
              ...(next.anchor ? { anchor: next.anchor } : {}),
            }}
            {...(onNavigate ? { onNavigate } : {})}
          />
        </div>
      )}
    </div>
  )
}

/** Setup summary, conversation and composer. Shared by the dock and the full-page view. */
export function KeelPanelBody({
  onNavigate,
  memberId,
}: {
  onNavigate?: () => void
  memberId?: string
}) {
  return (
    <>
      <SetupSummary {...(onNavigate ? { onNavigate } : {})} />
      <KeelThread {...(onNavigate ? { onNavigate } : {})} />
      <KeelComposer {...(memberId ? { memberId } : {})} />
      <p className="px-3 pb-2 text-center text-[11px] text-ink-tertiary">
        Keel explains what is on file. It isn&apos;t financial advice.
      </p>
    </>
  )
}

function Header({
  presentation,
  onEmergency,
  contextLabel,
}: {
  presentation: Presentation
  onEmergency?: () => void
  contextLabel: string
}) {
  const { closePanel, setMinimised, newConversation } = useKeelPanel.getState()
  const modal = presentation !== 'docked'
  return (
    <header className="flex items-center gap-2 border-b border-ink-tertiary/10 px-3 py-2.5">
      <Bot size={18} className="text-family-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink-primary">Keel</h2>
        <p className="truncate text-[11px] text-ink-tertiary">{contextLabel}</p>
      </div>
      {modal && onEmergency && (
        <button
          type="button"
          onClick={onEmergency}
          aria-label="Emergency help"
          className="flex h-11 w-11 items-center justify-center rounded-full text-danger"
        >
          <Siren size={18} aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={() => newConversation()}
        aria-label="New conversation"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary"
      >
        <Plus size={18} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setMinimised(true)}
        aria-label="Minimise Keel"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary"
      >
        <Minus size={18} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => closePanel()}
        aria-label="Close Keel"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary"
      >
        <X size={18} aria-hidden />
      </button>
    </header>
  )
}

function labelFor(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0]
  return first ? `On: ${first.replace(/-/g, ' ')}` : 'On: Home'
}

/** Drag the left edge to resize the docked panel. */
function ResizeHandle() {
  const setWidth = useKeelPanel((s) => s.setWidth)
  const widthPx = useKeelPanel((s) => s.widthPx)
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setWidth(window.innerWidth - ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Keel panel"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={widthPx}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setWidth(widthPx + 20)
        if (e.key === 'ArrowRight') setWidth(widthPx - 20)
      }}
      className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-family-500/30 focus:bg-family-500/50 focus:outline-none"
    />
  )
}

export function KeelDock({
  eligible,
  onEmergency,
}: {
  eligible: boolean
  onEmergency?: () => void
}) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const { user } = useAuth()
  const open = useKeelPanel((s) => s.open)
  const minimised = useKeelPanel((s) => s.minimised)
  const widthPx = useKeelPanel((s) => s.widthPx)
  const setup = useKeelPanel((s) => s.setup)
  const measured = usePresentation(widthPx)
  const presentation: Presentation = measured ?? 'sheet'
  const enabled = isKeelPanelEnabled()
  const onFullPage = pathname.startsWith('/assistant')
  const visible = enabled && eligible && !onFullPage && open && !minimised && measured !== null
  const modal = visible && presentation !== 'docked'
  const trapRef = useFocusTrap<HTMLDivElement>(modal && presentation === 'sheet')
  const launcher = useRef<HTMLElement | null>(null)

  // Identity: a new person (or sign-out) never inherits the previous conversation.
  useEffect(() => {
    if (enabled) useKeelPanel.getState().resetIdentity(user?.id ?? null)
  }, [enabled, user?.id])

  // Page context: route, ?step=, and the anchors present. No field values, ever.
  useEffect(() => {
    if (!enabled) return
    useKeelPanel.getState().setPageContext({ route: pathname || '/' })
    const t = window.setTimeout(() => {
      const step = new URLSearchParams(window.location.search).get('step')
      useKeelPanel.getState().setPageContext({
        anchors: collectAnchors(),
        ...(step && /^[a-z-]{1,32}$/.test(step) ? { step } : {}),
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [enabled, pathname])

  const refresh = useCallback(() => void useKeelPanel.getState().refreshSetup(), [])

  // Read the setup state when the panel opens, after every confirmed save, and on return to the tab.
  useEffect(() => {
    if (!enabled || !eligible || !open) return
    refresh()
    const off = onKeelDataChanged(refresh)
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      off()
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, eligible, open, refresh])

  // One greeting per session, only while setup is unfinished.
  useEffect(() => {
    const s = useKeelPanel.getState()
    if (!visible || s.greeted || !setup || s.messages.length > 0) return
    s.markGreeted()
    if (setup.role === 'child' || setup.verified_complete) return
    const next = setup.steps.find((x) => x.id === setup.next_step_id)
    s.appendLocal({
      role: 'keel',
      route: 'setup',
      content: setup.bootstrap
        ? 'Welcome. Your first step is to create your household. It takes about three minutes.'
        : `You've finished **${setup.completed} of ${setup.total}** setup steps.${next ? ` **Next:** ${next.title} (about ${next.est_minutes} min).` : ''}`,
      cards: next
        ? [
            {
              kind: 'navigate',
              route_key: next.route_key,
              label: `Open: ${next.title}`,
              ...(next.anchor ? { anchor: next.anchor } : {}),
            },
          ]
        : [],
    })
  }, [visible, setup])

  // Ctrl/Cmd+J toggles the panel.
  useEffect(() => {
    if (!enabled || !eligible) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        useKeelPanel.getState().togglePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, eligible])

  // Layout: docked mode pushes the page; every other mode leaves it alone.
  useEffect(() => {
    const px = visible && presentation === 'docked' ? `${widthPx}px` : '0px'
    document.documentElement.style.setProperty('--keel-panel-w', px)
    return () => document.documentElement.style.setProperty('--keel-panel-w', '0px')
  }, [visible, presentation, widthPx])

  // Modal presentations make the page behind inert.
  useEffect(() => {
    const main = document.getElementById('main-content')
    if (!main || !modal) return
    main.setAttribute('inert', '')
    return () => main.removeAttribute('inert')
  }, [modal])

  // Focus moves into the composer on open and back to the launcher on close.
  useEffect(() => {
    if (visible) {
      launcher.current = document.activeElement as HTMLElement | null
      window.setTimeout(
        () =>
          document
            .getElementById(PANEL_ID)
            ?.querySelector<HTMLTextAreaElement>('textarea')
            ?.focus(),
        50,
      )
    } else if (launcher.current) {
      launcher.current.focus?.()
      launcher.current = null
    }
  }, [visible])

  if (!enabled || !eligible || onFullPage || !open || measured === null) return null

  const collapseForNavigation = () => {
    // On a phone, drop to the "Resume Keel" pill so the page the link opened is visible.
    if (presentation !== 'docked') useKeelPanel.getState().setMinimised(true)
  }

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => useKeelPanel.getState().setMinimised(false)}
        aria-label="Resume Keel"
        className="glass-strong fixed bottom-24 right-4 z-fab flex min-h-[48px] items-center gap-2 rounded-full px-4 shadow-xl desk:bottom-8"
      >
        <Bot size={16} className="text-family-400" aria-hidden />
        <span className="text-sm font-semibold text-ink-primary">
          Keel
          {setup && !setup.verified_complete && setup.total > 0
            ? ` · Step ${setup.completed} of ${setup.total}`
            : ''}
        </span>
        <ChevronUp size={14} aria-hidden />
      </button>
    )
  }

  const chrome = (
    <>
      <Header
        presentation={presentation}
        {...(onEmergency ? { onEmergency } : {})}
        contextLabel={labelFor(pathname)}
      />
      <KeelPanelBody onNavigate={collapseForNavigation} />
    </>
  )

  if (presentation === 'sheet') {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-modal">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => useKeelPanel.getState().setMinimised(true)}
            aria-hidden
          />
          <motion.section
            id={PANEL_ID}
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label="Keel assistant"
            tabIndex={-1}
            initial={reduceMotion ? false : { y: '100%' }}
            animate={{ y: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }
            }
            onKeyDown={(e) => e.key === 'Escape' && useKeelPanel.getState().closePanel()}
            className="glass-strong absolute inset-x-0 bottom-0 flex h-[92dvh] flex-col overflow-hidden rounded-t-3xl pb-[env(safe-area-inset-bottom)] outline-none"
          >
            {chrome}
          </motion.section>
        </div>
      </AnimatePresence>
    )
  }

  const docked = presentation === 'docked'
  return (
    <motion.aside
      id={PANEL_ID}
      {...(docked ? {} : { role: 'dialog', 'aria-modal': false })}
      aria-label="Keel assistant"
      initial={reduceMotion ? false : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      onKeyDown={(e) => e.key === 'Escape' && useKeelPanel.getState().closePanel()}
      style={{ width: widthPx }}
      className={`glass-strong fixed bottom-0 right-0 top-0 z-nav flex max-w-full flex-col border-l border-ink-tertiary/15 ${docked ? '' : 'shadow-2xl'}`}
    >
      {docked && <ResizeHandle />}
      {chrome}
    </motion.aside>
  )
}
