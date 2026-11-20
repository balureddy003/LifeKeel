import { useLayoutEffect, type RefObject } from 'react'

/**
 * Records where the chat box starts on the page as `--app-chat-top`, so its height can be "what is
 * left under it" whatever sits above (the verify-email or offline banner, the app header). A fixed
 * header-height sum ignored those banners, so the message box slid under the bottom nav.
 */
export function useChatTop(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      el.style.setProperty('--app-chat-top', `${Math.round(top)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    // A banner appearing, finishing its slide-in or being dismissed changes the page height.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [ref])
}
