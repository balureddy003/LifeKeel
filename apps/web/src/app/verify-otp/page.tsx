'use client'

/**
 * Email one-time code (CLOUDFLARE_INTEGRATION.md §6.7). Reached after signup
 * or password sign-in when the API answers `otp_required`; the pending
 * challenge lives in sessionStorage (lib/otp-pending.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthShell } from '@/components/landing/AuthShell'
import { Turnstile, useTurnstile } from '@/components/security/Turnstile'
import { AuthRequestError, useAuth } from '@/lib/auth-context'
import { clearPendingOtp, readPendingOtp, type PendingOtp } from '@/lib/otp-pending'
import { haptic } from '@/lib/haptics'

type Phase =
  | 'idle'
  | 'verifying'
  | 'error'
  | 'locked'
  | 'code_expired'
  | 'chain_expired'
  | 'superseded'
  | 'success'

const LENGTH = 6
const DIGITS = /^\d$/

function remaining(iso: string | undefined, now: number): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000))
}
const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export default function VerifyOtpPage() {
  const router = useRouter()
  const { verifyEmailOtp, resendEmailOtp } = useAuth()
  const [pending, setPending] = useState<PendingOtp | null>(null)
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''))
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [resending, setResending] = useState(false)
  const [resendReadyAt, setResendReadyAt] = useState<string | undefined>()
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const captcha = useTurnstile()

  // Read the pending challenge once, on mount. (The router object isn't a
  // dependency: re-reading storage on every render would reset the page.)
  const routerRef = useRef(router)
  routerRef.current = router
  useEffect(() => {
    const p = readPendingOtp()
    if (!p) {
      routerRef.current.replace('/login')
      return
    }
    setPending(p)
    setResendReadyAt(p.resend_available_at)
    if (p.delivery === 'failed') setNotice("We couldn't send the email. Use Resend to try again.")
    else if (p.delivery === 'unknown')
      setNotice("If you don't see the email in a minute, check spam or resend.")
    inputs.current[0]?.focus()
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const codeLeft = remaining(pending?.code_expires_at, now)
  const chainLeft = remaining(pending?.chain_expires_at, now)
  const resendLeft = remaining(resendReadyAt, now)

  useEffect(() => {
    if (!pending || phase === 'success' || phase === 'verifying') return
    if (chainLeft === 0) setPhase('chain_expired')
    else if (codeLeft === 0 && phase !== 'locked' && phase !== 'superseded')
      setPhase('code_expired')
  }, [pending, chainLeft, codeLeft, phase])

  const focusFirstEmpty = (d: string[]) => {
    const i = d.findIndex((x) => !x)
    inputs.current[i === -1 ? LENGTH - 1 : i]?.focus()
  }

  const submit = useCallback(
    async (code: string) => {
      if (phase === 'verifying' || !pending) return
      setPhase('verifying')
      setMessage('')
      try {
        const done = await verifyEmailOtp(code)
        haptic('success')
        setPhase('success')
        router.push(done.next ?? (done.purpose === 'signup' ? '/family-setup' : '/'))
      } catch (err) {
        haptic('warning')
        const e = err instanceof AuthRequestError ? err : null
        const cleared = Array(LENGTH).fill('')
        setDigits(cleared)
        switch (e?.code) {
          case 'otp_invalid': {
            const left = e.body['attempts_left']
            setPhase('error')
            setMessage(
              typeof left === 'number'
                ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
                : "That code isn't right.",
            )
            break
          }
          case 'otp_locked':
            setPhase('locked')
            setMessage('Too many incorrect codes. Start over to get a new one.')
            break
          case 'otp_expired':
            setPhase(chainLeft > 0 ? 'code_expired' : 'chain_expired')
            setMessage(chainLeft > 0 ? 'That code has expired. Send a new one.' : '')
            break
          case 'otp_superseded':
            setPhase('superseded')
            setMessage('A newer sign-up for this email replaced this one. Start over.')
            break
          case 'invite_unavailable':
            setPhase('error')
            setMessage('Your invite code has been used up. Contact whoever invited you.')
            break
          default:
            if (e?.status === 401) {
              setPhase('chain_expired')
            } else {
              setPhase('error')
              setMessage(err instanceof Error ? err.message : 'Verification failed. Try again.')
            }
        }
        setTimeout(() => inputs.current[0]?.focus(), 0)
      }
    },
    [phase, pending, verifyEmailOtp, router, chainLeft],
  )

  const setAt = (index: number, value: string) => {
    const next = [...digits]
    next[index] = value
    setDigits(next)
    if (value && index < LENGTH - 1) inputs.current[index + 1]?.focus()
    if (next.every((d) => DIGITS.test(d))) void submit(next.join(''))
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array.from({ length: LENGTH }, (_, i) => text[i] ?? '')
    setDigits(next)
    if (text.length === LENGTH) void submit(text)
    else focusFirstEmpty(next)
  }

  const resend = async () => {
    if (resending || resendLeft > 0 || !captcha.ready) return
    setResending(true)
    setMessage('')
    try {
      const updated = await resendEmailOtp(captcha.consume())
      setPending(updated)
      setResendReadyAt(updated.resend_available_at)
      setDigits(Array(LENGTH).fill(''))
      setPhase('idle')
      setNotice(
        updated.delivery === 'failed'
          ? "We couldn't send the email. Try again."
          : 'New code sent. Earlier codes no longer work.',
      )
      inputs.current[0]?.focus()
    } catch (err) {
      const e = err instanceof AuthRequestError ? err : null
      if (e?.code === 'otp_cooldown') {
        const wait = Number(e.body['retry_after_s'] ?? 60)
        setResendReadyAt(new Date(Date.now() + wait * 1000).toISOString())
        setMessage(`Please wait ${wait} seconds before asking for another code.`)
      } else if (e?.code === 'otp_send_limit') {
        setMessage("You've asked for a lot of codes. Wait a while, then start over.")
      } else if (e?.code === 'otp_expired') {
        setPhase('chain_expired')
      } else {
        setMessage(err instanceof Error ? err.message : "Couldn't send a new code.")
      }
    } finally {
      setResending(false)
    }
  }

  const startOver = () => {
    clearPendingOtp()
    router.push(pending?.purpose === 'signup' ? '/signup' : '/login')
  }

  if (!pending) return null

  const terminal = phase === 'locked' || phase === 'chain_expired' || phase === 'superseded'
  const canResend =
    !terminal && phase !== 'success' && resendLeft === 0 && !resending && captcha.ready

  return (
    <AuthShell
      title={pending.purpose === 'signup' ? 'Confirm your email' : 'Check your email'}
      sub={`We sent a 6-digit code to ${pending.email_hint}.`}
    >
      {phase === 'chain_expired' ? (
        <>
          <p className="lk-hint" role="alert">
            This sign-in has expired. Start over to get a new code.
          </p>
          <button type="button" className="lk-btn" onClick={startOver}>
            Start over
          </button>
        </>
      ) : (
        <form
          className="lk-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const code = digits.join('')
            if (/^\d{6}$/.test(code)) void submit(code)
          }}
        >
          <fieldset className="lk-otp" disabled={terminal || phase === 'verifying'}>
            <legend className="lk-sr-only">Enter the 6-digit code from the email</legend>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el
                }}
                className="lk-input lk-otp-box"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={i === 0 ? LENGTH : 1}
                aria-label={`Digit ${i + 1} of ${LENGTH}`}
                aria-invalid={phase === 'error' ? true : undefined}
                aria-describedby="otp-error"
                value={d}
                onPaste={onPaste}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '')
                  // iOS/Android one-time-code autofill drops all six into the first box.
                  if (v.length === LENGTH) {
                    const next = v.split('')
                    setDigits(next)
                    void submit(v)
                    return
                  }
                  setAt(i, v.slice(-1))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digits[i] && i > 0) {
                    inputs.current[i - 1]?.focus()
                    setAt(i - 1, '')
                  }
                }}
              />
            ))}
          </fieldset>

          <p className="lk-hint">
            {phase === 'code_expired'
              ? 'This code has expired.'
              : `Code expires in ${mmss(codeLeft)}`}
          </p>

          <div id="otp-error" role="alert" aria-live="assertive" className="lk-err">
            {message}
          </div>
          {notice && !message && (
            <p className="lk-hint" role="status">
              {notice}
            </p>
          )}

          {terminal ? (
            <button type="button" className="lk-btn" onClick={startOver}>
              Start over
            </button>
          ) : (
            <button
              type="submit"
              className="lk-btn"
              disabled={phase === 'verifying' || digits.some((x) => !x)}
            >
              {phase === 'verifying' ? 'Checking...' : 'Continue'}
            </button>
          )}

          {!terminal && (
            <>
              {resendLeft === 0 && (
                <Turnstile
                  ref={captcha.ref}
                  action="otp_resend"
                  appearance="interaction-only"
                  onToken={captcha.onToken}
                  onExpire={captcha.onExpire}
                />
              )}
              <button
                type="button"
                className="lk-textlink"
                onClick={() => void resend()}
                disabled={!canResend}
              >
                {resending
                  ? 'Sending...'
                  : resendLeft > 0
                    ? `Resend in ${resendLeft} s`
                    : 'Resend code'}
              </button>
            </>
          )}

          <p className="lk-hint lk-center">
            {pending.purpose === 'signup' ? (
              <>
                Wrong email?{' '}
                <Link href="/signup" className="lk-textlink" onClick={() => clearPendingOtp()}>
                  Go back
                </Link>
              </>
            ) : (
              <Link href="/login" className="lk-textlink" onClick={() => clearPendingOtp()}>
                Back to sign in
              </Link>
            )}
          </p>
          <p className="lk-hint lk-center">
            LifeKeel will never ask you for this code by phone, chat or email.
          </p>
        </form>
      )}
    </AuthShell>
  )
}
