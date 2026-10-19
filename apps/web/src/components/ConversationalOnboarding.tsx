'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Send, Bot, User, Baby, Sparkles, PartyPopper, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { ONBOARDING_QUESTIONS } from '@/lib/onboarding-data'
import type { FamilyMemberDraft } from '@/lib/onboarding-data'
// Pragmatic (not full RFC 5322) format check — catches the obvious typos
// this question is guarding against: missing '@', no domain, stray
// whitespace, a second '@'. Matches the check on POST /auth/signup.
// Remediation item 27: when onboarding hits a signup collision we redirect
// to /login — the collected chat state (answers + family graph) is stashed
// here first so signing in resumes the flow instead of discarding the two
// minutes of answers the user just gave. sessionStorage, not localStorage:
// it's a single interrupted flow, not a preference.
const ONBOARDING_DRAFT_KEY = 'lifekeel_onboarding_draft'

interface OnboardingDraft {
  answers: Record<string, string>
  members: FamilyMemberDraft[]
}

function saveOnboardingDraft(draft: OnboardingDraft): void {
  try { sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft)) } catch { /* private mode — resume just won't happen */ }
}

function takeOnboardingDraft(): OnboardingDraft | null {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_DRAFT_KEY)
    if (!raw) return null
    sessionStorage.removeItem(ONBOARDING_DRAFT_KEY)
    return JSON.parse(raw) as OnboardingDraft
  } catch {
    return null
  }
}

function peekOnboardingDraft(): OnboardingDraft | null {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_DRAFT_KEY)
    return raw ? (JSON.parse(raw) as OnboardingDraft) : null
  } catch {
    return null
  }
}

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailFormat(value: string): boolean {
  return EMAIL_FORMAT_RE.test(value.trim())
}

interface ChatMsg {
  id: string
  role: 'ai' | 'user'
  text: string
}

export type SignupOutcome<T> =
  | { ok: true; user: T }
  | { ok: false; reason: 'collision'; message: string }
  | { ok: false; reason: 'other'; message: string }

// KEEL-017: onboarding used to generate a synthetic, unreceivable
// `@family.ai` email and silently retry with a random suffix on collision
// — that account could never be recovered via the existing password-reset
// flow, since nothing lives at that domain. Now takes the family's real
// email (collected earlier in the chat) and signs up directly. A genuine
// collision here means they already have an account — silently retrying
// with a mutated version of their real email would create a second,
// unreachable account and defeat the whole point of the fix, so the
// caller is expected to point them to sign in instead.
// Exported standalone so this stays unit-testable without mounting the
// whole chat flow.
export async function attemptOnboardingSignup<T>(
  name: string,
  email: string,
  password: string,
  signUp: (name: string, email: string, password: string) => Promise<T>,
): Promise<SignupOutcome<T>> {
  try {
    const signedUpUser = await signUp(name, email, password)
    return { ok: true, user: signedUpUser }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong creating your account.'
    return { ok: false, reason: message === 'Email already registered' ? 'collision' : 'other', message }
  }
}

// Live-verification finding: for anyone who signed up first (the app's
// main entry point), `owner` is already set by the time finishOnboarding
// runs, so the email this question collects was never linked to the
// account — "that's your key back in" (said right after they answer) was
// false. Returns the email to link via updateEmail(), or null when there's
// nothing to do — no answer given, or it already matches the account.
// Exported standalone for the same reason attemptOnboardingSignup is.
export function onboardingRecoveryEmailToLink(owner: { email: string } | null, rawAnswer: string | undefined): string | null {
  if (!owner) return null
  const trimmed = rawAnswer?.trim()
  if (!trimmed || trimmed === owner.email) return null
  return trimmed
}

// A signed-in user has already told us their name and email at signup, so the chat
// starts after those two questions instead of asking again. Returns null when
// there is nothing to skip (no account, or no usable name).
export function onboardingSeedFromAccount(
  account: { name?: string; email: string } | null,
): { answers: Record<string, string>; members: FamilyMemberDraft[]; nextIndex: number } | null {
  const name = account?.name?.trim()
  if (!account || !name) return null
  const skipped = new Set(['name', 'email'])
  let nextIndex = 0
  while (nextIndex < ONBOARDING_QUESTIONS.length && skipped.has(ONBOARDING_QUESTIONS[nextIndex]!.id)) nextIndex++
  return {
    answers: { name, email: account.email },
    members: [{ id: 'self', emoji: '', name, role: 'You', completion: 0 }],
    nextIndex,
  }
}

function GrowingGraph({ members }: { members: FamilyMemberDraft[] }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <AnimatePresence>
        {members.map((m, i) => (
          <div key={m.id} className="flex flex-col items-center">
            {i > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 16, opacity: 1 }}
                className="w-px bg-gradient-to-b from-family-500/40 to-family-500/10"
              />
            )}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="flex flex-col items-center gap-1"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: 'rgb(var(--family-accent) / 0.1)',
                  border: '2px solid rgb(var(--family-accent) / 0.3)',
                }}
              >
                <User size={24} className="text-family-400" strokeWidth={1.5} />
              </div>
              <span className="text-xs font-semibold">{m.name}</span>
              <span className="text-caption text-ink-tertiary">{m.role}</span>
            </motion.div>
          </div>
        ))}
      </AnimatePresence>
      {members.length === 0 && (
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-ink-tertiary text-sm"
        >
          Your family will appear on the chart here
        </motion.div>
      )}
    </div>
  )
}

export function ConversationalOnboarding() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: 'intro',
      role: 'ai',
      text: "Welcome! Let's put your family on the chart. I'll ask a few quick questions, and it takes about 2 minutes. After each answer, you'll see your chart fill in.",
    },
    {
      id: 'q-0',
      role: 'ai',
      text: ONBOARDING_QUESTIONS[0]!.question,
    },
  ])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [textValue, setTextValue] = useState('')
  const [multiValues, setMultiValues] = useState<string[]>([''])
  const [members, setMembers] = useState<FamilyMemberDraft[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [finished, setFinished] = useState(false)
  // Two-phase completion: `finished` shows the loading animation while
  // createFamily/inviteMember calls run; `setupDone` flips once those
  // calls resolve, swapping the loader for a brief celebration moment
  // before navigating — so the user sees "success", not just a redirect.
  const [setupDone, setSetupDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // setSubmitting alone isn't enough to block a rapid double-fire of the
  // same handler — React state doesn't update synchronously, so two calls
  // within the same tick both read the pre-update value. A ref does update
  // synchronously, which is what the actual re-entrancy guard needs; the
  // state copy exists only to drive the disabled UI.
  const submittingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const { user, family, isLoading, signUp, createFamily, inviteMember, updateEmail } = useAuth()
  const router = useRouter()

  // Resume after a signup-collision detour through /login: the draft saved
  // just before redirecting is still in sessionStorage. If the signed-in
  // account turns out to already have a family (an established user who
  // typed the same email), the draft is irrelevant — drop it so it can't
  // resurrect a stale setup later. If they're authenticated with no family
  // yet, they're exactly the person the draft belongs to — finish their
  // setup directly instead of re-asking everything. Waits for isLoading to
  // settle first: restore() sets user before family, so checking family
  // while it's still fetching would resume into a duplicate createFamily.
  const resumeAttempted = useRef(false)
  useEffect(() => {
    if (resumeAttempted.current || isLoading || !user) return
    const draft = peekOnboardingDraft()
    if (!draft) return
    resumeAttempted.current = true
    if (family) {
      takeOnboardingDraft() // discard — this account is already set up
      return
    }
    takeOnboardingDraft()
    addAIMessage(`Welcome back, ${draft.answers['name'] ?? 'friend'} — picking up right where we left off.`)
    void finishOnboarding(draft.answers, draft.members)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, family, isLoading])

  // Live-verification finding: the text input only had autoFocus, which
  // fires once on mount — this same <input> element is reused for every
  // question in the conversation (no key forcing a remount), so it never
  // regained focus after the first answer. Confirmed live: after
  // submitting "What's your name?", document.activeElement fell to <body>
  // even though the next question had already appeared — every subsequent
  // answer required manually re-clicking back into the input, breaking a
  // keyboard-only flow through what's meant to read as a continuous chat.
  // Re-focusing whenever `submitting` drops back to false covers both the
  // disabled-during-submit -> enabled cycle and the very first render
  // (submitting starts false), so autoFocus below is now redundant but
  // harmless to leave as a fallback for the instant before this effect runs.
  // Skip the name and email questions for a signed-in user (see onboardingSeedFromAccount).
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || isLoading || questionIndex !== 0 || Object.keys(answers).length > 0) return
    const seed = onboardingSeedFromAccount(user)
    if (!seed) return
    seeded.current = true
    const first = seed.answers['name']!
    setAnswers(seed.answers)
    setMembers(seed.members)
    setQuestionIndex(seed.nextIndex)
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== 'q-0'),
      { id: 'ai-seed', role: 'ai', text: `Nice to meet you, ${first}! Let's start your family's chart.` },
      { id: 'q-seed', role: 'ai', text: ONBOARDING_QUESTIONS[seed.nextIndex]!.question },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading])

  useEffect(() => {
    if (!submitting) textInputRef.current?.focus()
  }, [submitting])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const currentQuestion = ONBOARDING_QUESTIONS[questionIndex]
  const progress = (questionIndex / ONBOARDING_QUESTIONS.length) * 100

  // Same focus-loss bug as the text input above, for the other input type:
  // 'boolean'/'choice' questions render a fresh set of buttons per
  // question (different choices, so a fresh key each time) — the button
  // just clicked unmounts and focus fell back to <body>. Confirmed live
  // answering "married" -> "No, single" straight into the next boolean
  // question ("Do you have children?"): document.activeElement was <body>
  // even though the new Yes/No buttons had already rendered. Unlike the
  // text input (one persistent element to refocus), each question's
  // choices are genuinely new, so this focuses the first one — the same
  // "new required input" category as the financial-profile wizard fix.
  //
  // Second live-verification finding, on the first version of this fix:
  // questionIndex updates synchronously in handleAnswer, but submitting
  // only flips back to false ~300ms later — so this effect fired while
  // the choice buttons were still disabled={submitting} and .focus() on a
  // disabled button is a silent no-op. Depending on `submitting` too (and
  // gating on !submitting) makes it retry once the buttons are actually
  // focusable, instead of firing once too early and never again.
  const firstChoiceRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!submitting && (currentQuestion?.type === 'boolean' || currentQuestion?.type === 'choice')) {
      firstChoiceRef.current?.focus()
    }
  }, [questionIndex, currentQuestion?.type, submitting])

  // Same category as firstChoiceRef above, for the third input type:
  // 'multi-text' (children's names) also renders fresh on arrival with
  // nothing auto-focused — confirmed live transitioning children=Yes into
  // "What are your children's names?": document.activeElement was <body>
  // even though the "Child 1 name" input had already rendered. Only
  // focuses the FIRST input on question arrival, not on every keystroke —
  // multiValues changes on every character typed, so this intentionally
  // does not depend on multiValues (that would fight the user's own typing).
  const firstMultiInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!submitting && currentQuestion?.type === 'multi-text') {
      firstMultiInputRef.current?.focus()
    }
  }, [questionIndex, currentQuestion?.type, submitting])

  const addAIMessage = (text: string) => {
    setMessages((prev) => [...prev, { id: `ai-${Date.now()}`, role: 'ai', text }])
  }

  const addUserMessage = (text: string) => {
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
  }

  const handleAnswer = (answer: string) => {
    if (!currentQuestion || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    haptic('light')
    addUserMessage(answer)
    const newAnswers = { ...answers, [currentQuestion.id]: answer }
    setAnswers(newAnswers)

    // Grow the graph based on answers. Also track anything this specific
    // answer adds in a local array — finishOnboarding can run later in this
    // same handler (when this is the last question), and at that point the
    // setMembers update above is still only queued, not committed, so a
    // member added on the final answer would be invisible to a closure over
    // `members` state. Pass the complete list explicitly instead.
    let newlyAdded: FamilyMemberDraft[] = []
    if (currentQuestion.id === 'name') {
      newlyAdded = [{ id: 'self', emoji: '', name: answer, role: 'You', completion: 0 }]
      setMembers((prev) => [...prev, ...newlyAdded])
      addAIMessage(`Nice to meet you, ${answer}! Let's start your family's chart.`)
    } else if (currentQuestion.id === 'email') {
      addAIMessage("Got it — that's your key back in if you ever need it.")
    } else if (currentQuestion.id === 'married' && answer.startsWith('Yes')) {
      addAIMessage('Great!')
    } else if (currentQuestion.id === 'married' && answer === 'No, single') {
      addAIMessage('No problem! We can add family members anytime.')
    } else if (currentQuestion.id === 'spouse-name') {
      newlyAdded = [{ id: 'spouse', emoji: '', name: answer, role: 'Partner', completion: 0 }]
      setMembers((prev) => [...prev, ...newlyAdded])
      addAIMessage(`Lovely! ${answer} is on your family's chart.`)
    } else if (currentQuestion.id === 'children' && answer === 'Yes') {
      addAIMessage('Wonderful!')
    } else if (currentQuestion.id === 'children' && answer === 'No') {
      addAIMessage('No problem! We can add children later if things change.')
    } else if (currentQuestion.id === 'children-names') {
      const names = answer.split(',').map((n) => n.trim()).filter(Boolean)
      newlyAdded = names.map((name, i) => ({ id: `child-${i}`, emoji: '', name, role: 'Child', completion: 0 }))
      setMembers((prev) => [...prev, ...newlyAdded])
      addAIMessage(`Added ${names.length} ${names.length === 1 ? 'child' : 'children'} to your chart!`)
    } else {
      addAIMessage('Got it! Let\'s continue.')
    }

    // Skip follow-up questions if condition not met
    let nextIndex = questionIndex + 1
    const nextQ = ONBOARDING_QUESTIONS[nextIndex]
    if (nextQ?.followUp === 'married' && !newAnswers.married?.startsWith('Yes')) {
      nextIndex++
    }
    if (nextQ?.followUp === 'children' && newAnswers.children !== 'Yes') {
      nextIndex++
    }

    if (nextIndex >= ONBOARDING_QUESTIONS.length) {
      setTimeout(() => finishOnboarding(newAnswers, [...members, ...newlyAdded]), 800)
    } else {
      // Always ask the next question explicitly — the reaction above only
      // acknowledges the previous answer, and several reactions (skips,
      // generic "Got it!") never restate what's being asked next.
      setTimeout(() => {
        addAIMessage(ONBOARDING_QUESTIONS[nextIndex]!.question)
        submittingRef.current = false
        setSubmitting(false)
      }, 300)
      setQuestionIndex(nextIndex)
    }
  }

  const finishOnboarding = async (allAnswers: Record<string, string>, allMembers: FamilyMemberDraft[]) => {
    const name = allAnswers.name || 'User'

    // If the person already has an account (came from Sign Up or Sign In),
    // keep their real identity — don't overwrite it with an onboarding-derived one.
    let owner = user
    if (!owner) {
      // Reached /family-setup directly without going through /signup first
      // (it's allowed pre-auth — see AppShell's isAuthRoute). There's no
      // password field in this flow, so generate one — the account stays
      // recoverable via the real email collected in the 'email' question
      // above and the existing password-reset flow.
      const email = allAnswers.email?.trim() ?? ''
      const generatedPassword = crypto.randomUUID()
      const outcome = await attemptOnboardingSignup(name, email, generatedPassword, signUp)
      if (!outcome.ok) {
        if (outcome.reason === 'collision') {
          // Keep the chat state — signing in resumes right here instead of
          // throwing away everything they just told us (item 27).
          saveOnboardingDraft({ answers: allAnswers, members: allMembers })
          addAIMessage(`Looks like ${email} already has an account with us — taking you to sign in. Your answers are saved; we'll pick up right where we left off.`)
          setTimeout(() => router.push('/login'), 2500)
        } else {
          addAIMessage(`Hmm, that didn't go through: ${outcome.message}`)
        }
        submittingRef.current = false
        setSubmitting(false)
        return
      }
      owner = outcome.user
    } else {
      const recoveryEmail = onboardingRecoveryEmailToLink(owner, allAnswers.email)
      if (recoveryEmail) {
        // Best-effort — a collision with someone else's account shouldn't
        // block finishing onboarding, it just leaves the original signup
        // email as the recovery address. Still tell the user, so "didn't
        // save" isn't silent — they can fix it later from Settings.
        try {
          owner = await updateEmail(recoveryEmail)
        } catch {
          addAIMessage(`Couldn't save ${recoveryEmail} as your recovery email — you can add it later in Settings.`)
        }
      }
    }

    haptic('success')
    addAIMessage('Your family is on the chart. Setting things up now.')
    setFinished(true)

    await createFamily(`${owner.name}'s Family`, owner)

    // createFamily seeds the roster with just the organizer — persist the
    // partner/children collected during the chat (members state here is
    // local-only, used for the GrowingGraph animation) as real members too.
    const draftRoleToFamilyRole: Record<string, 'parent' | 'child'> = {
      Partner: 'parent',
      Child: 'child',
    }
    for (const draft of allMembers) {
      const role = draftRoleToFamilyRole[draft.role]
      if (!role) continue // skips the 'You' (self) entry — already the organizer
      try {
        await inviteMember(draft.name, '', role)
      } catch {
        // Best-effort — one failed member shouldn't block the rest or onboarding completion.
      }
    }

    track('family_setup_completed', { member_count: allMembers.length })

    // Show the success celebration for 1.5s before navigating — so the
    // user sees "Your family is set up!" rather than a silent redirect.
    setSetupDone(true)
    haptic('success')
    setTimeout(() => {
      router.push('/financial-profile?source=onboarding')
    }, 1800)
  }

  const handleTextSubmit = () => {
    if (!textValue.trim()) return
    if (currentQuestion?.id === 'email' && !isValidEmailFormat(textValue)) {
      addAIMessage("That doesn't look like a valid email — mind trying again?")
      setTextValue('')
      return
    }
    handleAnswer(textValue)
    setTextValue('')
  }

  const handleMultiSubmit = () => {
    const valid = multiValues.filter((v) => v.trim())
    if (valid.length === 0) return
    handleAnswer(valid.join(', '))
    setMultiValues([''])
  }

  if (finished) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <AnimatePresence mode="wait">
          {setupDone ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="flex flex-col items-center"
            >
              <motion.div
                className="w-16 h-16 rounded-full bg-success/15 border border-success/25 flex items-center justify-center mb-4"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
              >
                <motion.svg
                  viewBox="0 0 24 24"
                  className="w-8 h-8 text-success"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.path
                    d="M5 13l4 4L19 7"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                  />
                </motion.svg>
              </motion.div>
              <h1 className="text-2xl font-bold mb-2">Your family is set up!</h1>
              <p className="text-sm text-ink-tertiary">Next, add what you have on file</p>
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center"
            >
              <motion.div
                className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4 mx-auto"
                animate={{ scale: [1, 1.1, 1], rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <PartyPopper size={32} className="text-family-400" />
              </motion.div>
              <h1 className="text-2xl font-bold mb-2">Setting up your chart…</h1>
              <p className="text-sm text-ink-tertiary">Your family profile is taking shape</p>
              <motion.div
                className="mt-6 w-48 h-2 rounded-full bg-tint/5 overflow-hidden"
              >
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 1.5 }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Progress bar */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ink-tertiary font-semibold">Putting your family on the chart</span>
          <span className="text-xs text-family-400 font-bold">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-tint/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
      </div>

      {/* Growing graph */}
      <div className="px-4 py-2">
        <GrowingGraph members={members} />
      </div>

      {/* Chat messages — role="log" (same fix as /assistant) so a screen
          reader announces each new question/confirmation as it arrives,
          instead of the conversation silently advancing underneath the
          user. */}
      <div ref={scrollRef} role="log" aria-label="Onboarding conversation with Keel" className="flex-1 overflow-y-auto px-4 py-2 space-y-3 no-scrollbar">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-gradient-to-b from-family-500 to-family-600 text-white'
                  : 'glass text-ink-primary'
              }`}
            >
              {msg.role === 'ai' && (
                <div className="text-xs text-family-400 mb-1 flex items-center gap-1">
                  <Bot size={12} /> Keel
                </div>
              )}
              <p className="text-sm leading-relaxed">{msg.text}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Input area */}
      <div className="px-4 py-3 safe-area-bottom">
        {currentQuestion?.type === 'boolean' || currentQuestion?.type === 'choice' ? (
          <div className="space-y-2">
            {currentQuestion.choices?.map((choice, i) => (
              <motion.button
                key={choice}
                ref={i === 0 ? firstChoiceRef : undefined}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleAnswer(choice)}
                disabled={submitting}
                className="w-full glass rounded-2xl py-4 text-base font-semibold text-ink-primary disabled:opacity-40"
              >
                {choice}
              </motion.button>
            ))}
          </div>
        ) : currentQuestion?.type === 'multi-text' ? (
          <div className="space-y-2">
            {multiValues.map((val, i) => (
              <div key={i} className="flex gap-2">
                <input
                  ref={i === 0 ? firstMultiInputRef : undefined}
                  type="text"
                  placeholder={`Child ${i + 1} name`}
                  value={val}
                  onChange={(e) => {
                    const next = [...multiValues]
                    next[i] = e.target.value
                    setMultiValues(next)
                  }}
                  className="glass-input flex-1 rounded-2xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none"
                />
                {i === multiValues.length - 1 && (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setMultiValues([...multiValues, ''])}
                    aria-label="Add another child"
                    className="w-12 h-12 rounded-full glass flex items-center justify-center"
                  >
                    <Plus size={20} className="text-ink-secondary" />
                  </motion.button>
                )}
              </div>
            ))}
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleMultiSubmit}
              disabled={!multiValues.some((v) => v.trim()) || submitting}
              className="w-full bg-gradient-to-b from-family-500 to-family-600 text-white font-semibold rounded-2xl py-4 text-base shadow-lg shadow-family-500/25 disabled:opacity-40"
            >
              Continue
            </motion.button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <input
              ref={textInputRef}
              type="text"
              placeholder={currentQuestion?.hint ?? 'Type your answer...'}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !submitting && handleTextSubmit()}
              disabled={submitting}
              autoFocus
              className="glass-input flex-1 rounded-2xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none min-h-[52px] disabled:opacity-40"
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleTextSubmit}
              disabled={!textValue.trim() || submitting}
              aria-label="Send answer"
              className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
              style={{ background: 'rgb(var(--family-500))' }}
            >
              <Send size={18} color="rgb(var(--on-cta))" />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  )
}
