'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, X, Send, ChevronRight } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { AI_SUGGESTIONS, AI_RESPONSES } from '@/lib/life-data'

function getAIResponse(query: string): string {
  const lower = query.toLowerCase()
  for (const [key, response] of Object.entries(AI_RESPONSES)) {
    if (lower.includes(key)) return response
  }
  return "I understand you're asking about that. Let me look into your family's data and get back to you with a clear answer. In the meantime, would you like me to show you your family's protection status?"
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function AIFloatingButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const send = (text: string) => {
    if (!text.trim()) return
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setThinking(true)
    haptic('light')

    setTimeout(() => {
      const response = getAIResponse(text)
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: response }])
      setThinking(false)
      haptic('success')
    }, 1200)
  }

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={() => {
          haptic('medium')
          setIsOpen(true)
        }}
        whileTap={{ scale: 0.85 }}
        className="fixed bottom-32 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-xl"
        style={{
          background: 'linear-gradient(135deg, #7c6ef0, #6b5ce0)',
          boxShadow: '0 8px 32px rgba(124,110,240,0.3)',
        }}
        aria-label="Ask AI"
      >
        <Bot size={24} color="#fff" />
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ border: '2px solid rgba(124,110,240,0.4)' }}
          animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.button>

      {/* Chat overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col"
            style={{ background: 'rgba(8,8,12,0.85)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 safe-area-top">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center">
                  <Bot size={20} className="text-family-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Ask Anything</h2>
                  <p className="text-xs text-ink-tertiary">I know your family's full picture</p>
                </div>
              </div>
              <motion.button
                onClick={() => {
                  haptic('light')
                  setIsOpen(false)
                }}
                whileTap={{ scale: 0.9 }}
                className="w-10 h-10 rounded-full glass flex items-center justify-center"
                aria-label="Close"
              >
                <X size={18} className="text-ink-secondary" />
              </motion.button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3 no-scrollbar">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-4"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 3, repeat: Infinity }}
                  >
                    <Bot size={32} className="text-family-400" />
                  </motion.div>
                  <p className="text-ink-secondary text-sm max-w-xs">
                    Ask me anything about your family. I know your insurance, savings, goals, and what to do in any situation.
                  </p>
                  <div className="mt-6 w-full space-y-2">
                    {AI_SUGGESTIONS.map((s, i) => (
                      <motion.button
                        key={s}
                        onClick={() => send(s)}
                        whileTap={{ scale: 0.97 }}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="w-full glass rounded-2xl px-4 py-3 text-left text-sm text-ink-secondary flex items-center gap-2"
                      >
                        <span className="text-family-400"><ChevronRight size={16} /></span>
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

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
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
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

            {/* Input */}
            <div className="px-4 py-3 safe-area-bottom">
              <div className="flex gap-2 items-end">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send(input)}
                  placeholder="Ask about insurance, retirement, goals..."
                  className="glass-input flex-1 rounded-2xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none min-h-[52px]"
                />
                <motion.button
                  onClick={() => send(input)}
                  whileTap={{ scale: 0.9 }}
                  disabled={!input.trim() || thinking}
                  className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: input.trim() ? 'linear-gradient(135deg, #7c6ef0, #6b5ce0)' : 'rgba(255,255,255,0.05)',
                  }}
                  aria-label="Send"
                >
                  <Send size={18} color="#fff" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
