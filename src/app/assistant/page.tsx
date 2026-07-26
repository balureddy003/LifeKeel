'use client'

import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Bot, Send } from 'lucide-react'
import { AI_SUGGESTIONS, AI_RESPONSES } from '@/lib/life-data'
import { AIAnswerCard } from '@/components/AIAnswer'
import { PageHeader } from '@/components/Glass'
import { haptic } from '@/lib/haptics'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  showPerplexity?: boolean
  userQuery?: string
}

function getAIResponse(query: string): string {
  const lower = query.toLowerCase()
  for (const [key, response] of Object.entries(AI_RESPONSES)) {
    if (lower.includes(key)) return response
  }
  return "I understand you're asking about that. Based on your family's financial profile, I'd recommend reviewing your current coverage and speaking with your financial advisor. Would you like me to show you specific numbers from your family's data?"
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your Family AI. I know your family's full picture — insurance, savings, goals, and what to do in any situation. Just ask me anything.",
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const sendMessage = (text: string) => {
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

    setTimeout(() => {
      const lower = text.toLowerCase()
      const hasPerplexity = lower.includes('retire') || lower.includes('protect') || lower.includes('job')
      const response = getAIResponse(text)
      setMessages((prev) => [...prev, {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response,
        showPerplexity: hasPerplexity,
        userQuery: text,
      }])
      setThinking(false)
      haptic('success')
    }, 1200)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <PageHeader title="Family AI" subtitle="Ask me anything about your family" />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-2 space-y-3 no-scrollbar">
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
                  <Bot size={12} /> Family AI
                </div>
              )}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              {msg.showPerplexity && msg.userQuery && (
                <div className="mt-3">
                  <AIAnswerCard query={msg.userQuery} />
                </div>
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
            <div className="glass rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-2 h-2 rounded-full bg-family-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {messages.length <= 1 && (
        <div className="px-4 py-2">
          <div className="text-xs text-ink-tertiary mb-2">Try asking:</div>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4">
            {AI_SUGGESTIONS.map((s, i) => (
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
