'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { haptic } from '@/lib/haptics'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button + warning icon, for destructive/irreversible actions. */
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

// Replaces window.confirm() — the browser's native dialog is unstyled,
// blocks the JS thread, and reads nothing like the rest of this app. Every
// destructive/irreversible action (remove a family member, disconnect a
// service, delete an education fund) used it before this. Modeled as a
// bottom sheet, the same pattern iOS's own action sheets use for exactly
// this "are you sure" moment.
export function ConfirmSheetProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOptions(opts)
    })
  }, [])

  const settle = (value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <BottomSheet open={options !== null} onClose={() => settle(false)} label={options?.title ?? 'Confirm'}>
        {options && (
          <div className="px-5 pb-6 pt-2">
            {options.destructive && (
              <div className="w-11 h-11 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-3">
                <AlertTriangle size={20} className="text-danger" />
              </div>
            )}
            <div className="text-base font-bold text-ink-primary mb-1.5">{options.title}</div>
            <p className="text-sm text-ink-secondary leading-relaxed mb-5">{options.message}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { haptic('light'); settle(false) }}
                className="flex-1 rounded-2xl py-3.5 text-sm font-semibold text-ink-secondary glass active:opacity-80"
              >
                {options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => { haptic(options.destructive ? 'warning' : 'success'); settle(true) }}
                className={`flex-1 rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 ${
                  options.destructive ? 'bg-danger' : 'bg-family-500'
                }`}
              >
                {options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmSheetProvider')
  return ctx
}
