'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, AlertCircle, Info, type LucideIcon } from 'lucide-react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
  /** Optional undo callback — renders an "Undo" button. */
  onUndo: (() => void) | undefined
}

interface ToastOptions {
  message: string
  variant?: ToastVariant
  /** Auto-dismiss delay in ms (default 3000). */
  duration?: number
  onUndo?: () => void
}

type ShowToast = (options: ToastOptions) => void

const ToastContext = createContext<ShowToast | null>(null)

const VARIANT_ICON: Record<ToastVariant, LucideIcon> = {
  success: Check,
  error: AlertCircle,
  info: Info,
}

const VARIANT_COLOR: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-family-400',
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback<ShowToast>(
    ({ message, variant = 'success', duration = 3000, onUndo }) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, variant, onUndo }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    },
    [],
  )

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Portal-free: renders at the bottom of the provider tree, above
          the nav bar but below modals. safe-area-bottom keeps it clear of
          the home indicator on notched devices. */}
      <div className="fixed bottom-[var(--app-dock-space)] min-[1400px]:bottom-8 left-0 right-0 z-banner flex flex-col items-center gap-2 pointer-events-none px-4">
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = VARIANT_ICON[toast.variant]
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                role="status"
                aria-live="polite"
                className="pointer-events-auto glass-strong rounded-2xl px-4 py-3 flex items-center gap-2.5 shadow-lg max-w-sm w-full"
              >
                <Icon size={18} className={VARIANT_COLOR[toast.variant]} />
                <span className="text-sm font-medium text-ink-primary flex-1">{toast.message}</span>
                {toast.onUndo && (
                  <button
                    onClick={() => {
                      toast.onUndo?.()
                      dismiss(toast.id)
                    }}
                    className="text-sm font-semibold text-family-400 px-2 py-1 rounded-lg active:opacity-70"
                  >
                    Undo
                  </button>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
