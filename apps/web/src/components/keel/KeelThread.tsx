'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Bot, CloudOff, RotateCcw } from 'lucide-react'
import { LifeSafetyNotice } from '@/components/LifeSafetyNotice'
import { CURRENCY_PATTERN } from '@/components/Glass'
import { useMode } from '@/lib/mode-context'
import { useKeelPanel } from '@/lib/keel/store'
import type { KeelMessage } from '@/lib/keel/types'
import { NavChip, Proposal, Provenance, SetupChecklist } from './KeelCards'

const MARKDOWN: Components = {
  p: (props) => <p className="mb-2 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 list-outside list-disc space-y-1 pl-4 last:mb-0" {...props} />,
  ol: (props) => (
    <ol className="mb-2 list-outside list-decimal space-y-1 pl-4 last:mb-0" {...props} />
  ),
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => (
    <a
      className="underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  h1: (props) => <p className="mb-1 font-semibold" {...props} />,
  h2: (props) => <p className="mb-1 font-semibold" {...props} />,
  h3: (props) => <p className="mb-1 font-semibold" {...props} />,
}

const ERROR_COPY: Record<NonNullable<KeelMessage['error']>, string> = {
  unavailable:
    "Keel's assistant is temporarily unavailable. That's a real outage, not a missing answer. Your question is kept, so you can try again.",
  rate_limited: "You're asking quickly. Give it a minute and try again.",
  access_changed:
    "Your access to this household changed while I was answering, so I didn't send that reply.",
  signed_out: 'Your session ended. Sign in again to keep going.',
}

export function suggestionsFor(setupComplete: boolean): string[] {
  return [
    setupComplete ? 'What can Keel do?' : 'What should I do next?',
    'What does this page do?',
    'Recommended settings for my family',
    ...(setupComplete ? [] : ['What can Keel do?']),
  ]
}

function Bubble({
  msg,
  onNavigate,
  onRetry,
  onApplied,
}: {
  msg: KeelMessage
  onNavigate?: () => void
  onRetry: (id: string) => void
  onApplied: () => void
}) {
  const { config } = useMode()
  const isUser = msg.role === 'user'
  const text = config.showMoney ? msg.content : msg.content.replace(CURRENCY_PATTERN, '•••')

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`min-w-0 max-w-[94%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gradient-to-b from-family-500 to-family-600 text-white'
            : 'glass text-ink-primary'
        }`}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1 text-xs text-family-400">
            <Bot size={12} aria-hidden /> Keel
          </div>
        )}
        {msg.route === 'emergency' && <LifeSafetyNotice compact />}
        {msg.pending && !msg.content && msg.cards.length === 0 ? (
          <p className="text-xs text-ink-tertiary" role="status">
            Keel is checking…
          </p>
        ) : isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
        ) : (
          msg.content && (
            <div className="text-sm leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN}
                // A remote image loads the moment it renders, which would let injected text send data out.
                disallowedElements={['img']}
                unwrapDisallowed
              >
                {text}
              </ReactMarkdown>
            </div>
          )
        )}

        {msg.cards.map((card, i) =>
          card.kind === 'setup_checklist' ? (
            <SetupChecklist key={i} card={card} {...(onNavigate ? { onNavigate } : {})} />
          ) : card.kind === 'proposal' ? (
            <Proposal key={i} card={card} onApplied={onApplied} />
          ) : (
            <div key={i} className="mt-2">
              <NavChip card={card} {...(onNavigate ? { onNavigate } : {})} />
            </div>
          ),
        )}

        {msg.isLive && msg.dataAsOf && <Provenance dataAsOf={msg.dataAsOf} />}

        {msg.error && (
          <div className="mt-2 rounded-xl border border-ink-tertiary/15 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <CloudOff size={15} className="text-warning" aria-hidden /> Couldn&apos;t answer
            </div>
            <p className="mb-2 text-xs leading-relaxed text-ink-tertiary">
              {ERROR_COPY[msg.error]}
            </p>
            {msg.retryOf && msg.error !== 'signed_out' && (
              <button
                type="button"
                onClick={() => onRetry(msg.id)}
                className="flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-family-400"
              >
                <RotateCcw size={12} aria-hidden /> Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function KeelThread({ onNavigate }: { onNavigate?: () => void }) {
  const messages = useKeelPanel((s) => s.messages)
  const sending = useKeelPanel((s) => s.sending)
  const setup = useKeelPanel((s) => s.setup)
  const send = useKeelPanel((s) => s.send)
  const retry = useKeelPanel((s) => s.retry)
  const refreshSetup = useKeelPanel((s) => s.refreshSetup)
  const ref = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const [unseen, setUnseen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (nearBottom.current) el.scrollTop = el.scrollHeight
    else setUnseen(true)
  }, [messages])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom.current) setUnseen(false)
  }

  const showSuggestions = messages.filter((m) => m.role === 'user').length === 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        role="log"
        aria-label="Conversation with Keel"
        onScroll={onScroll}
        className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 && (
          <p className="px-1 text-sm text-ink-secondary">
            Hi, I&apos;m Keel. Ask me where to start, what a page does, or about your family&apos;s
            saved records. I explain what is on file; I don&apos;t give financial advice, and I
            never change anything without you.
          </p>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            msg={m}
            {...(onNavigate ? { onNavigate } : {})}
            onRetry={(id) => void retry(id)}
            onApplied={() => void refreshSetup()}
          />
        ))}
      </div>

      {unseen && (
        <button
          type="button"
          onClick={() => {
            if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
            setUnseen(false)
          }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-family-500 px-3 py-1.5 text-xs font-semibold text-[rgb(var(--on-cta))]"
        >
          New response
        </button>
      )}

      {showSuggestions && !sending && (
        <div className="flex flex-wrap gap-2 px-3 pb-2" aria-label="Suggested questions">
          {suggestionsFor(setup?.verified_complete ?? false).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              className="glass min-h-[44px] rounded-full px-4 text-sm text-ink-secondary"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
