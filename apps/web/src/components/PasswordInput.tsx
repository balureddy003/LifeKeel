'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputClassName?: string
  wrapperClassName?: string
  toggleClassName?: string
  invalid?: boolean
  describedBy?: string
}

const DEFAULT_INPUT_CLASSES =
  'glass-input w-full rounded-2xl px-4 py-4 pr-12 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all'

// KEEL-024: password fields had no way to check what you'd typed before
// submitting. Wraps a standard password input with a show/hide toggle,
// matching the app's existing glass-input styling.
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  onKeyDown,
  inputClassName,
  wrapperClassName,
  toggleClassName,
  invalid,
  describedBy,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={wrapperClassName ?? 'relative'}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={inputClassName ?? DEFAULT_INPUT_CLASSES}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className={
          toggleClassName ??
          'absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary active:opacity-60'
        }
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
