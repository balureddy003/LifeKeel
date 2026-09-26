'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Bot, Send } from 'lucide-react'
import { AI_SUGGESTIONS } from '@/lib/life-data'
import { AIAnswerCard } from '@/components/AIAnswer'
import { PageHeader, CURRENCY_PATTERN } from '@/components/Glass'
import { useMode } from '@/lib/mode-context'
import { haptic } from '@/lib/haptics'
import { fetchAIResponse } from '@/lib/api'

// Oak's live answers were rendering as a single whitespace-pre-wrap plain
// text blob — a multi-part answer (narrating a scenario, listing several
// policies) came back from the LLM with real markdown structure
// (paragraphs, **emphasis**, "- " lists) that just showed up as literal
// asterisks and dashes instead of being rendered. Sized for a compact chat
// bubble, not full page prose — see BlogPostClient.tsx's MARKDOWN_COMPONENTS
// for the same pattern at article scale.
const CHAT_MARKDOWN_COMPONENTS: Components = {
  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props) => <ul className="list-disc list-outside pl-4 mb-2 last:mb-0 space-y-1" {...props} />,
  ol: (props) => <ol className="list-decimal list-outside pl-4 mb-2 last:mb-0 space-y-1" {...props} />,
  li: (props) => <li {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />,
  code: (props) => <code className="px-1 py-0.5 rounded bg-tint/10 text-xs" {...props} />,
  h1: (props) => <p className="font-semibold mb-1" {...props} />,
  h2: (props) => <p className="font-semibold mb-1" {...props} />,
  h3: (props) => <p className="font-semibold mb-1" {...props} />,
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  showPerplexity?: boolean
  userQuery?: string
  isLive?: boolean
}

function getAIResponse(query: string): string {
  // Synchronous fallback — the async fetchAIResponse is used in sendMessage.
  // This is kept for any synchronous call sites that may exist.
  return "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?"
}

// Page-context-aware suggestions — when the user arrives from a specific
// page, lead with questions relevant to what they were just looking at.
const CONTEXT_SUGGESTIONS: Record<string, string[]> = {
  '/inbox': ['Summarize my notifications', 'Any renewals coming up?'],
  '/family': ['How complete is our family profile?', 'Who still needs to fill in their details?'],
  '/financial-profile': ['How does my profile compare to recommended coverage?', 'What gaps should I address first?'],
  '/upload': ['What documents have I uploaded?', 'What documents should I upload next?'],
  '/events': ['What would happen if I lost my job today?', 'Am I covered for a medical emergency?'],
  '/life-events': ['What would happen if I lost my job today?', 'Am I covered for a medical emergency?'],
  '/settings': ['What data does Oak have about my family?'],
}

function getContextSuggestions(context: string | null): string[] {
  if (!context) return AI_SUGGESTIONS
  // Match the longest prefix — /life-events/123 → /life-events
  const match = Object.keys(CONTEXT_SUGGESTIONS)
    .filter((k) => context.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  if (!match) return AI_SUGGESTIONS
  return [...CONTEXT_SUGGESTIONS[match]!, ...AI_SUGGESTIONS.slice(0, 2)]
}

export default function AssistantPage() {
  const { config } = useMode()
  const [pageContext] = useState<string | null>(
    () => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('context') : null,
  )
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm Oak. I can summarize your family's financial profile — insurance, savings, goals, and scenarios. This is for informational purposes only. Just ask me anything.",
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  // Live-verification finding: a real answer can take 30+ seconds and the
  // only feedback was three static dots — long enough that a real user
  // (and this agent, at first) reads it as a dead button. Rotating text
  // makes the wait legible without promising a specific time.
  const [thinkingText, setThinkingText] = useState('Oak is thinking...')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    if (!thinking) return
    setThinkingText('Oak is thinking...')
    const t1 = setTimeout(() => setThinkingText('Checking your family’s financial profile...'), 5000)
    const t2 = setTimeout(() => setThinkingText('Still working — this can take a little longer for detailed questions...'), 15000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [thinking])

  const sendMessage = async (text: string) => {
    if (!text.trim()) return
    haptic('light')

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setThinking(true)

    try {
      const { content, isLive } = await fetchAIResponse(text)
      setMessages((prev) => [...prev, {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content,
        // Non-live answers render through AIAnswerCard, which carries its
        // own honest "Sample answer" disclosure — the plain bubble below
        // has no way to label itself, so every canned response needs to
        // go through the labeled card, not just a handful of keywords.
        showPerplexity: !isLive,
        userQuery: text,
        isLive,
      }])
    } catch {
      setMessages((prev) => [...prev, {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: getAIResponse(text),
        showPerplexity: true,
        userQuery: text,
        isLive: false,
      }])
    } finally {
      setThinking(false)
      haptic('success')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <PageHeader title="Oak" subtitle="Ask me anything about your family" />

      {/* Live-verification finding: new messages appeared with no signal
          to screen readers — a blind/low-vision user had no way to know
          Oak had answered unless they manually re-navigated to this list.
          role="log" is the ARIA role built for exactly this (a chronological
          message transcript), implying a polite live-region announcement
          of each addition without needing separate aria-live plumbing. */}
      <div ref={scrollRef} role="log" aria-label="Conversation with Oak" className="flex-1 overflow-y-auto px-5 py-2 space-y-3 no-scrollbar">
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
              {msg.role === 'assistant' && (
                <div className="text-xs text-family-400 mb-1 flex items-center gap-1">
                  <Bot size={12} /> Oak
                </div>
              )}
              {msg.showPerplexity && msg.userQuery ? (
                <AIAnswerCard query={msg.userQuery} />
              ) : msg.role === 'assistant' ? (
                <div className="text-sm leading-relaxed">
                  <ReactMarkdown components={CHAT_MARKDOWN_COMPONENTS}>
                    {config.showMoney ? msg.content : msg.content.replace(CURRENCY_PATTERN, '•••')}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </motion.div>
        ))}

        {thinking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="flex gap-1 flex-shrink-0">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-2 h-2 rounded-full bg-family-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
              <span className="text-xs text-ink-tertiary">{thinkingText}</span>
            </div>
          </motion.div>
        )}
      </div>

      {messages.length <= 1 && (
        <div className="px-4 py-2">
          <div className="text-xs text-ink-tertiary mb-2">Try asking:</div>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4">
            {getContextSuggestions(pageContext).map((s, i) => (
              <motion.button
                key={s}
                onClick={() => sendMessage(s)}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex-shrink-0 glass rounded-full px-4 py-2.5 text-sm text-ink-secondary whitespace-nowrap"
              >
                {s}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 safe-area-bottom">
        <div className="flex gap-2 items-end">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask about insurance, retirement, goals..."
            className="glass-input flex-1 rounded-2xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none min-h-[52px] focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
          <motion.button
            onClick={() => sendMessage(input)}
            whileTap={{ scale: 0.9 }}
            disabled={!input.trim() || thinking}
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 bg-family-500 active:opacity-90 transition-opacity"
            aria-label="Send message"
          >
            <Send size={18} color="#fff" />
          </motion.button>
        </div>
      </div>
    </div>
  )
}
