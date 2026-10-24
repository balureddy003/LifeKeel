'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRouteParam } from '@/lib/useRouteParam'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Users, Check, X, Clock, Mail } from 'lucide-react'
import { PasswordInput } from '@/components/PasswordInput'
import { joinFamily, fetchFamilyInvite, type FamilyInviteInfo } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { Turnstile, useTurnstile } from '@/components/security/Turnstile'

// This page serves two different "invite" flows, distinguished by the URL
// segment's shape:
//   - 6-char code  → PRD-110 join request: the requester found the family's
//     shared invite code; submitting only queues a request the organizer
//     must approve — it never creates a login or grants access by itself.
//   - long token   → PRD-123 per-member invite: the organizer emailed a
//     specific pending roster member; accepting creates/links their login
//     and flips that roster entry to active immediately (the organizer's
//     approval already happened at invite-send time).
const isMemberInviteToken = (code: string) => /^[0-9a-f]{48}$/i.test(code)

export default function InviteJoinClient() {
  // code stays undefined until the real URL segment is resolved post-mount
  // (static export — see useRouteParam).
  const code = useRouteParam('/invite')
  if (code === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink-tertiary">
        Checking your invite…
      </div>
    )
  }
  if (isMemberInviteToken(code)) return <AcceptMemberInvite token={code} />
  return <RequestJoin code={code} />
}

// ── PRD-123: accept a per-member invite ────────────────────────────────────
function AcceptMemberInvite({ token }: { token: string }) {
  const router = useRouter()
  const { acceptFamilyInvite } = useAuth()
  const [info, setInfo] = useState<FamilyInviteInfo | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchFamilyInvite(token)
      .then(setInfo)
      .catch((err) => setLookupError(err instanceof Error ? err.message : 'Invalid invite'))
  }, [token])

  const handleAccept = async () => {
    if (password.length < 8) return
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      await acceptFamilyInvite(token, password)
      haptic('success')
      router.push('/')
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : "Couldn't accept the invite. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (lookupError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-4">
          <X size={32} className="text-danger" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Invite not valid</h1>
        <p className="text-sm text-ink-secondary leading-relaxed max-w-xs">{lookupError}</p>
        <Link href="/login" className="inline-block mt-6 text-sm font-semibold text-family-400">
          Go to sign in
        </Link>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink-tertiary">
        Checking your invite…
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Mail size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold">You're invited, {info.memberName}</h1>
        <p className="text-sm text-ink-tertiary mt-1">
          {info.familyName} set you up on LifeKeel. Set a password to finish joining — you'll be
          signed in right away. If you already have an Keel account for this family, use that
          password to link it instead.
        </p>
      </div>

      <div className="mb-6">
        <label htmlFor="accept-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">
          Password (min. 8 characters)
        </label>
        <PasswordInput
          id="accept-password"
          placeholder="Password (min. 8 characters)"
          value={password}
          onChange={setPassword}
          onKeyDown={(e) => e.key === 'Enter' && handleAccept()}
          autoComplete="new-password"
        />
        {password.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-1.5 mt-1.5 px-1 text-xs ${password.length >= 8 ? 'text-success' : 'text-ink-tertiary'}`}
          >
            {password.length >= 8 ? <Check size={12} /> : <X size={12} />}
            {password.length >= 8
              ? 'Password length looks good'
              : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`}
          </div>
        )}
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">
          {error}
        </p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleAccept}
        disabled={password.length < 8 || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Joining...' : `Join ${info.familyName}`}
      </motion.button>

      <p className="text-xs text-ink-tertiary text-center mt-4">
        Not you?{' '}
        <Link href="/login" className="text-family-400 font-semibold">
          Sign in
        </Link>
      </p>
    </div>
  )
}

// ── PRD-110: request to join via shared invite code ────────────────────────
// Submitting this form never creates a login or grants any access by itself —
// it only creates a pending request the family's organizer has to explicitly
// approve. See docs/prd/110-family-sharing-secondary-user-access.md.
function RequestJoin({ code }: { code: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ familyName: string } | null>(null)
  const captcha = useTurnstile()

  const canSubmit = name.trim() && email.trim() && password.length >= 8 && captcha.ready

  const handleSubmit = async () => {
    if (!canSubmit) return
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      const result = await joinFamily(code, name.trim(), email.trim(), password, captcha.consume())
      haptic('success')
      setSubmitted(result)
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error ? err.message : "Couldn't submit your request. Please try again.",
      )
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4 mx-auto">
            <Clock size={32} className="text-family-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Waiting for approval</h1>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-xs mx-auto">
            We've let {submitted.familyName} know you'd like to join. Once they approve your
            request, sign in with the email and password you just set.
          </p>
          <Link href="/login" className="inline-block mt-6 text-sm font-semibold text-family-400">
            Go to sign in
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col px-6 pt-12 pb-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Users size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold">Join your family on Keel</h1>
        <p className="text-sm text-ink-tertiary mt-1">
          The organizer will need to approve your request before you can sign in.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        <label htmlFor="invite-name" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Your name</div>
          <input
            id="invite-name"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="name"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <label htmlFor="invite-email" className="block">
          <div className="text-xs text-ink-tertiary mb-1.5 px-1">Email address</div>
          <input
            id="invite-email"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="email"
            className="glass-input w-full rounded-2xl px-4 py-4 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div>
          <label htmlFor="invite-password" className="block text-xs text-ink-tertiary mb-1.5 px-1">
            Password (min. 8 characters)
          </label>
          <PasswordInput
            id="invite-password"
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoComplete="new-password"
          />
          {password.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-1.5 mt-1.5 px-1 text-xs ${password.length >= 8 ? 'text-success' : 'text-ink-tertiary'}`}
            >
              {password.length >= 8 ? <Check size={12} /> : <X size={12} />}
              {password.length >= 8
                ? 'Password length looks good'
                : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`}
            </div>
          )}
        </div>
      </div>

      <Turnstile
        ref={captcha.ref}
        action="family_join"
        onToken={captcha.onToken}
        onExpire={captcha.onExpire}
      />

      {error && (
        <p role="status" aria-live="polite" className="text-sm text-danger text-center mb-4">
          {error}
        </p>
      )}

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSubmit}
        disabled={!canSubmit || loading}
        className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 disabled:opacity-40 active:opacity-90 transition-opacity"
      >
        {loading ? 'Submitting...' : 'Request to join'}
      </motion.button>

      <p className="text-xs text-ink-tertiary text-center mt-4">
        Already have an account?{' '}
        <Link href="/login" className="text-family-400 font-semibold">
          Sign in
        </Link>
      </p>
    </div>
  )
}
