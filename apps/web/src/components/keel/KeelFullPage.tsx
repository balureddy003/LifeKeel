'use client'

import { useEffect, useRef } from 'react'
import { PageHeader } from '@/components/Glass'
import { useKeelPanel } from '@/lib/keel/store'
import { useChatTop } from '@/lib/useChatTop'
import { KeelPanelBody } from './KeelDock'

const CONTEXT_RE = /^\/[a-z0-9\-/]{0,98}$/

/**
 * The same conversation as the panel, expanded to a page. Direct /assistant
 * links land here. Old ?context= and ?prompt= links are untrusted hints:
 * the context is length- and shape-checked, and the prompt only fills the
 * composer. It is never sent until the person presses send.
 */
export function KeelFullPage() {
  const ref = useRef<HTMLDivElement>(null)
  useChatTop(ref)
  useEffect(() => {
    const store = useKeelPanel.getState()
    const params = new URLSearchParams(window.location.search)
    const context = params.get('context')
    if (context && CONTEXT_RE.test(context)) store.setPageContext({ route: context })
    const prompt = params.get('prompt')
    if (prompt && store.draft === '') store.setDraft(prompt.slice(0, 2000))
    void store.refreshSetup()
  }, [])

  return (
    <div ref={ref} className="app-chat flex flex-col overflow-x-hidden">
      <div className="px-5">
        <PageHeader title="Keel" subtitle="Ask me anything about your family" />
      </div>
      <KeelPanelBody />
    </div>
  )
}
