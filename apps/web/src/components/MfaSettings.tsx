'use client'

/**
 * Two-factor (TOTP) enrollment — lives in Settings → Security. The flow:
 * status → setup (secret + manual-entry code) → first code confirms →
 * recovery codes shown once (the API stores only their SHA-256 hashes).
 * No QR library: authenticator apps all accept the typed secret, and a
 * third-party QR renderer would leak the secret to an external service.
 */

import { useEffect, useState } from 'react'
import { ListSection, ListRow } from '@/components/Glass'
import { BottomSheet } from '@/components/BottomSheet'
import { PasswordInput } from '@/components/PasswordInput'
import { useToast } from '@/components/Toast'
import { credFetch } from '@/lib/http'
import { getApiBase } from '@/lib/env'
import { haptic } from '@/lib/haptics'
import {
  isNativeShell,
  isBiometricAvailable,
  biometricLockEnabled,
  setBiometricLockEnabled,
} from '@/lib/native'
import { ShieldCheck, Copy, Fingerprint } from 'lucide-react'

type Stage = 'idle' | 'setup' | 'recovery' | 'disabling'

// Every authed API call in the app sends the stored Bearer token as a
// fallback for browsers that block the cross-site session cookie (Safari
// ITP, third-party-cookie blocking — see lib/http.ts). These calls used to
// be cookie-only, so in production /auth/mfa/* came back 401 for exactly
// the users whose cookies didn't flow.
function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lifekeel_token') : null
  return token ? { ...base, Authorization: `Bearer ${token}` } : base
}

/** Face ID / device-biometric app lock — native shell only; the row is
 *  hidden entirely in a browser where there's no biometric API to gate on. */
export function BiometricLockRow() {
  const toast = useToast()
  const [available, setAvailable] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!isNativeShell()) return
    isBiometricAvailable().then((ok) => {
      setAvailable(ok)
      setEnabled(ok && biometricLockEnabled())
    })
  }, [])

  if (!isNativeShell() || !available) return null

  return (
    <ListRow
      icon={Fingerprint}
      onClick={() => {
        const next = !enabled
        setEnabled(next)
        setBiometricLockEnabled(next)
        toast({ message: next ? 'Face ID unlock on' : 'Face ID unlock off' })
        haptic('light')
      }}
      value={enabled ? 'On' : 'Off'}
    >
      <div className="text-left">
        <div className="text-base font-medium">Unlock with biometrics</div>
        <div className="text-xs text-ink-tertiary mt-0.5">Require Face ID when opening the app</div>
      </div>
    </ListRow>
  )
}

export function MfaSettings() {
  const toast = useToast()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [recoveryCount, setRecoveryCount] = useState(0)
  const [stage, setStage] = useState<Stage>('idle')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshStatus = async () => {
    try {
      const res = await credFetch(`${getApiBase()}/auth/mfa/status`, {
        headers: authHeaders(),
      })
      if (!res.ok) {
        setStatusFailed(true)
        return
      }
      const data = await res.json()
      setEnabled(data.enabled === true)
      setRecoveryCount(data.recovery_codes_remaining ?? 0)
    } catch {
      // leave enabled=null — the row shows "Unavailable" rather than guessing
      setStatusFailed(true)
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  const startSetup = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await credFetch(`${getApiBase()}/auth/mfa/setup`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start setup.')
      setSecret(data.secret)
      setStage('setup')
      haptic('light')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.')
    } finally {
      setBusy(false)
    }
  }

  const confirmEnable = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await credFetch(`${getApiBase()}/auth/mfa/enable`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That code did not work.')
      setRecoveryCodes(data.recovery_codes ?? [])
      setStage('recovery')
      haptic('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDisable = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await credFetch(`${getApiBase()}/auth/mfa/disable`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not turn off two-factor.')
      setEnabled(false)
      setStage('idle')
      setPassword('')
      toast({ message: 'Two-factor authentication turned off' })
      haptic('medium')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn off two-factor.')
    } finally {
      setBusy(false)
    }
  }

  const finishRecovery = () => {
    setStage('idle')
    setSecret('')
    setCode('')
    refreshStatus()
  }

  return (
    <>
      <ListSection title="Security">
        <ListRow
          icon={ShieldCheck}
          onClick={() => {
            if (enabled === false) {
              setError(null)
              startSetup()
            } else if (enabled === true) {
              setError(null)
              setStage('disabling')
            }
          }}
          value={enabled === null ? (statusFailed ? 'Unavailable' : '…') : enabled ? 'On' : 'Off'}
        >
          <div className="text-left">
            <div className="text-base font-medium">Two-factor authentication</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              {enabled
                ? `Authenticator app required at sign-in · ${recoveryCount} recovery codes left`
                : 'Extra protection for your family\u2019s financial data'}
            </div>
          </div>
        </ListRow>
        <BiometricLockRow />
      </ListSection>

      <BottomSheet
        open={stage !== 'idle'}
        onClose={() => !busy && setStage('idle')}
        label="Two-factor authentication"
      >
        {stage === 'setup' && (
          <div className="space-y-4 pb-4">
            <div>
              <div className="text-base font-semibold mb-1">Set up your authenticator</div>
              <p className="text-sm text-ink-tertiary leading-relaxed">
                Open your authenticator app (e.g. Apple Passwords, Google Authenticator, 1Password),
                choose &quot;add account&quot;, and enter this key:
              </p>
            </div>
            <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3">
              <code className="text-sm font-mono tracking-widest break-all select-all">
                {secret}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(secret).catch(() => {})
                  toast({ message: 'Copied' })
                }}
                className="text-ink-tertiary flex-shrink-0 p-2"
                aria-label="Copy setup key"
              >
                <Copy size={16} />
              </button>
            </div>
            <label htmlFor="mfa-setup-code" className="block">
              <div className="text-xs text-ink-tertiary mb-1.5 px-1">
                Then enter the 6-digit code it shows
              </div>
              <input
                id="mfa-setup-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="glass-input w-full rounded-2xl px-4 py-3.5 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 text-center tracking-widest"
              />
            </label>
            {error && (
              <p role="status" className="text-sm text-danger text-center">
                {error}
              </p>
            )}
            <button
              onClick={confirmEnable}
              disabled={code.trim().length < 6 || busy}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-3.5 text-sm disabled:opacity-40"
            >
              {busy ? 'Verifying...' : 'Turn on two-factor'}
            </button>
          </div>
        )}

        {stage === 'recovery' && (
          <div className="space-y-4 pb-4">
            <div>
              <div className="text-base font-semibold mb-1">Save your recovery codes</div>
              <p className="text-sm text-ink-tertiary leading-relaxed">
                Each works once if you lose your authenticator. They&apos;re shown only this once —
                store them somewhere safe (e.g. a password manager).
              </p>
            </div>
            <div className="glass rounded-2xl p-4 grid grid-cols-2 gap-2">
              {recoveryCodes.map((c) => (
                <code key={c} className="text-sm font-mono tracking-wider text-center">
                  {c}
                </code>
              ))}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(recoveryCodes.join('\n')).catch(() => {})
                toast({ message: 'Copied' })
              }}
              className="w-full glass rounded-2xl py-3 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Copy size={15} /> Copy all
            </button>
            <button
              onClick={finishRecovery}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-3.5 text-sm"
            >
              I&apos;ve saved them
            </button>
          </div>
        )}

        {stage === 'disabling' && (
          <div className="space-y-4 pb-4">
            <div>
              <div className="text-base font-semibold mb-1">Turn off two-factor?</div>
              <p className="text-sm text-ink-tertiary leading-relaxed">
                Your account will be protected by password only. Enter your password to confirm.
              </p>
            </div>
            <PasswordInput
              id="mfa-disable-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            {error && (
              <p role="status" className="text-sm text-danger text-center">
                {error}
              </p>
            )}
            <button
              onClick={confirmDisable}
              disabled={!password || busy}
              className="w-full bg-danger text-white font-semibold rounded-2xl py-3.5 text-sm disabled:opacity-40"
            >
              {busy ? 'Turning off...' : 'Turn off two-factor'}
            </button>
          </div>
        )}
      </BottomSheet>
    </>
  )
}
