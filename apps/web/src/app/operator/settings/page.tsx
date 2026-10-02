'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Moon, MonitorSmartphone, Sun, type LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/lib/auth-context'
import { useThemePreference, type ThemePreference } from '@/lib/theme'
import { isValidEmailFormat } from '@/components/ConversationalOnboarding'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorSmartphone },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
]

// Operator-scoped account settings. The consumer /settings page can't be
// reused — AuthGate routes a signed-in user with no family group to
// /family-setup, which is the normal state for pure operator accounts.
export default function OperatorSettingsPage() {
  const { user, updateProfile, signOut } = useAuth()
  const [theme, setTheme] = useThemePreference()
  const router = useRouter()
  const toast = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
  }, [user?.name, user?.email])

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }
    if (!isValidEmailFormat(trimmedEmail)) {
      setError("That doesn't look like a valid email.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const patch: { name?: string; email?: string } = {}
      if (trimmedName !== user?.name) patch.name = trimmedName
      if (trimmedEmail !== user?.email) patch.email = trimmedEmail
      if (Object.keys(patch).length > 0) await updateProfile(patch)
      toast({ message: 'Profile updated', variant: 'success' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your changes — try again in a moment.')
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = () => {
    signOut()
    router.push('/login')
  }

  const inputClass =
    'w-full rounded-lg border border-tint/[0.08] bg-tint/[0.03] px-3 py-2 text-sm text-ink-primary outline-none focus:border-family-500/40'

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Your operator account. Platform-wide switches live under Configuration.</p>

      <GlassCard className="mt-5 p-4">
        <h2 className="font-semibold">Profile</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="operator-name" className="mb-1 block text-xs text-ink-tertiary">Name</label>
            <input id="operator-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="operator-email" className="mb-1 block text-xs text-ink-tertiary">Email</label>
            <input id="operator-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-family-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </GlassCard>

      <GlassCard className="mt-4 p-4">
        <h2 className="font-semibold">Appearance</h2>
        <div className="mt-3 flex gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  active
                    ? 'border-family-500/30 bg-family-500/10 font-semibold text-family-accent'
                    : 'border-tint/[0.08] text-ink-secondary hover:text-ink-primary'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            )
          })}
        </div>
      </GlassCard>

      <GlassCard className="mt-4 p-4">
        <h2 className="font-semibold">Session</h2>
        <p className="mt-1 text-xs text-ink-tertiary">Signed in as {user?.email ?? '…'}</p>
        <button
          onClick={handleSignOut}
          className="mt-3 flex items-center gap-2 rounded-lg border border-tint/[0.08] px-4 py-2 text-sm font-semibold text-danger"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </GlassCard>
    </div>
  )
}
