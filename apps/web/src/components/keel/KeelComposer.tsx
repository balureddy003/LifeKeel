'use client'

import { useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { useKeelPanel } from '@/lib/keel/store'

const MAX_LENGTH = 2000

/**
 * Enter sends, Shift+Enter adds a line, IME composition never sends, and
 * sending is blocked while a reply is pending. The draft lives in the store,
 * so it survives route changes and failed sends.
 */
export function KeelComposer({ memberId }: { memberId?: string }) {
  const draft = useKeelPanel((s) => s.draft)
  const sending = useKeelPanel((s) => s.sending)
  const setDraft = useKeelPanel((s) => s.setDraft)
  const send = useKeelPanel((s) => s.send)
  const stop = useKeelPanel((s) => s.stop)
  const composing = useRef(false)

  const submit = () => {
    if (!draft.trim() || sending) return
    void send(draft, memberId ? { memberId } : undefined)
  }

  return (
    <div className="px-3 pb-3 pt-2 safe-area-bottom">
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          rows={1}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !composing.current &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Ask Keel…"
          aria-label="Ask Keel a question"
          className="glass-input max-h-32 min-h-[48px] min-w-0 flex-1 resize-none rounded-2xl px-4 py-3 text-base text-ink-primary outline-none placeholder:text-ink-tertiary focus:ring-2 focus:ring-family-500/40"
        />
        {sending ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-family-500"
          >
            <Square size={16} color="rgb(var(--on-cta))" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-family-500 disabled:opacity-30"
          >
            <Send size={18} color="rgb(var(--on-cta))" />
          </button>
        )}
      </div>
    </div>
  )
}
