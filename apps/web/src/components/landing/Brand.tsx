import Link from 'next/link'
import './landing.css'
import './hero.css'
import './bands.css'

/**
 * The LifeKeel lockup used by the header, footer and sign-in screens: the app icon
 * (public/icon.svg, the source of truth for the mark) beside the wordmark in the
 * landing display face. One component so every surface lines up the same way.
 */
export function Brand({ size = 'md', href = '/' }: { size?: 'md' | 'lg'; href?: string | null }) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, same /icon.svg the app uses */}
      <img
        src="/icon.svg"
        alt=""
        width={size === 'lg' ? 40 : 30}
        height={size === 'lg' ? 40 : 30}
      />
      <span>LifeKeel</span>
    </>
  )
  const cls = `lk-brand lk-brand-${size}`
  return href ? (
    <Link href={href} className={cls} aria-label="LifeKeel home">
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  )
}
