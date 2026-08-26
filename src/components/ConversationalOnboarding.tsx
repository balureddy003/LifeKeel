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

interface ChatMsg {
  id: string
  role: 'ai' | 'user'
  text: string
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
                  background: 'rgba(124,110,240,0.1)',
                  border: '2px solid rgba(124,110,240,0.3)',
                }}
              >
                <User size={24} className="text-family-400" strokeWidth={1.5} />
              </div>
              <span className="text-xs font-semibold">{m.name}</span>
              <span className="text-[10px] text-ink-tertiary">{m.role}</span>
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
          Your family graph will grow here
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
      text: "Welcome! Let's build your Trellis. I'll ask a few quick questions — it takes about 2 minutes. After each answer, you'll see your family graph grow.",
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const { user, signUp, createFamily, inviteMember } = useAuth()
  const router = useRouter()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const currentQuestion = ONBOARDING_QUESTIONS[questionIndex]
  const progress = (questionIndex / ONBOARDING_QUESTIONS.length) * 100

  const addAIMessage = (text: string) => {
    setMessages((prev) => [...prev, { id: `ai-${Date.now()}`, role: 'ai', text }])
  }

  const addUserMessage = (text: string) => {
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
  }

  const handleAnswer = (answer: string) => {
    if (!currentQuestion) return
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
      addAIMessage(`Nice to meet you, ${answer}! Let's build your family graph.`)
    } else if (currentQuestion.id === 'married' && answer.startsWith('Yes')) {
      addAIMessage('Great!')
    } else if (currentQuestion.id === 'married' && answer === 'No, single') {
      addAIMessage('No problem! We can add family members anytime.')
    } else if (currentQuestion.id === 'spouse-name') {
      newlyAdded = [{ id: 'spouse', emoji: '', name: answer, role: 'Partner', completion: 0 }]
      setMembers((prev) => [...prev, ...newlyAdded])
      addAIMessage(`Lovely! ${answer} has been added to your family graph.`)
    } else if (currentQuestion.id === 'children' && answer === 'Yes') {
      addAIMessage('Wonderful!')
    } else if (currentQuestion.id === 'children' && answer === 'No') {
      addAIMessage('No problem! We can add children later if things change.')
    } else if (currentQuestion.id === 'children-names') {
      const names = answer.split(',').map((n) => n.trim()).filter(Boolean)
      newlyAdded = names.map((name, i) => ({ id: `child-${i}`, emoji: '', name, role: 'Child', completion: 0 }))
      setMembers((prev) => [...prev, ...newlyAdded])
      addAIMessage(`Added ${names.length} ${names.length === 1 ? 'child' : 'children'} to your graph!`)
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
      setTimeout(() => addAIMessage(ONBOARDING_QUESTIONS[nextIndex]!.question), 300)
      setQuestionIndex(nextIndex)
    }
  }

  const finishOnboarding = async (allAnswers: Record<string, string>, allMembers: FamilyMemberDraft[]) => {
    haptic('success')
    addAIMessage('Your family graph is ready! Let me set up your Trellis now.')
    setFinished(true)

    const name = allAnswers.name || 'User'

    // If the person already has an account (came from Sign Up or Sign In),
    // keep their real identity — don't overwrite it with an onboarding-derived one.
    let owner = user
    if (!owner) {
      // Reached /family-setup directly without going through /signup first
      // (it's allowed pre-auth — see AppShell's isAuthRoute). There's no
      // password field in this flow, so generate one; this account can
      // still only be recovered by the browser session that created it
      // until a real "set your password" step is added here.
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}@family.ai`
      const generatedPassword = crypto.randomUUID()
      owner = await signUp(name, email, generatedPassword)
    }
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

    setTimeout(() => {
      router.push('/')
    }, 2000)
  }

  const handleTextSubmit = () => {
    if (!textValue.trim()) return
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
        <motion.div
          className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4 mx-auto"
          animate={{ scale: [1, 1.1, 1], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <PartyPopper size={32} className="text-family-400" />
        </motion.div>
        <h1 className="text-2xl font-bold mb-2">Building your Trellis...</h1>
        <p className="text-sm text-ink-tertiary">Your family profile is taking shape</p>
        <motion.div
          className="mt-6 w-48 h-2 rounded-full bg-white/5 overflow-hidden"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ duration: 1.5 }}
          />
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Progress bar */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ink-tertiary font-semibold">Building your digital twin</span>
          <span className="text-xs text-family-400 font-bold">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
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

      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3 no-scrollbar">
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
                  <Bot size={12} /> Trellis
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
            {currentQuestion.choices?.map((choice) => (
              <motion.button
                key={choice}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleAnswer(choice)}
                className="w-full glass rounded-2xl py-4 text-base font-semibold text-ink-primary"
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
              disabled={!multiValues.some((v) => v.trim())}
              className="w-full bg-gradient-to-b from-family-500 to-family-600 text-white font-semibold rounded-2xl py-4 text-base shadow-lg shadow-family-500/25 disabled:opacity-40"
            >
              Continue
            </motion.button>
          </div>
        ) : (
          <div className="flex gap-2 items-end">
            <input
              type="text"
              placeholder={currentQuestion?.hint ?? 'Type your answer...'}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
              autoFocus
              className="glass-input flex-1 rounded-2xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none min-h-[52px]"
            />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleTextSubmit}
              disabled={!textValue.trim()}
              aria-label="Send answer"
              className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30"
              style={{ background: 'linear-gradient(135deg, #7c6ef0, #6b5ce0)' }}
            >
              <Send size={18} color="#fff" />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  )
}
