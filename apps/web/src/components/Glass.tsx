'use client'

import { motion, MotionStyle, useMotionValue, useTransform, useSpring, useReducedMotion } from 'framer-motion'
import { useRef, ReactNode } from 'react'
import { ChevronRight, ArrowLeft, Bot, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { haptic } from '@/lib/haptics'
import { useMode } from '@/lib/mode-context'

const springConfig = { type: 'spring' as const, stiffness: 400, damping: 30 }

export function GlassCard({
  children,
  className = '',
  onClick,
  interactive = false,
  style,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  interactive?: boolean
  style?: MotionStyle
}) {
  const ref = useRef<HTMLDivElement>(null)
  const rotateX = useSpring(useMotionValue(0), springConfig)
  const rotateY = useSpring(useMotionValue(0), springConfig)
  const scale = useSpring(useMotionValue(1), springConfig)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    rotateX.set(((y - centerY) / centerY) * -6)
    rotateY.set(((x - centerX) / centerX) * 6)
  }

  const handleMouseLeave = () => {
    rotateX.set(0)
    rotateY.set(0)
    scale.set(1)
  }

  const handleClick = () => {
    if (onClick) {
      haptic('light')
      onClick()
    }
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      whileTap={interactive ? { scale: 0.97 } : undefined as never}
      style={{
        ...(interactive ? { rotateX, rotateY, scale } : {}),
        transformStyle: 'preserve-3d',
        transformPerspective: 800,
        ...style,
      } as MotionStyle}
      className={`relative rounded-3xl border border-tint/[0.05] bg-tint/[0.03] backdrop-blur-2xl overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-tint/[0.03] to-transparent pointer-events-none rounded-3xl" />
      <div className="relative z-raised">{children}</div>
    </motion.div>
  )
}

export function GlassButton({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
  disabled?: boolean
}) {
  const baseClass = 'relative w-full flex items-center justify-center gap-2 rounded-2xl font-semibold text-base min-h-[56px] overflow-hidden transition-all active:opacity-90'
  const variantClass = {
    primary: 'bg-family-500 text-white shadow-md shadow-family-500/15',
    secondary: 'border border-tint/[0.06] bg-tint/[0.04] backdrop-blur-xl text-ink-primary',
    ghost: 'text-ink-secondary',
  }

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        if (disabled) return
        haptic('medium')
        onClick?.()
      }}
      disabled={disabled}
      className={`${baseClass} ${variantClass[variant]} ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      {variant === 'primary' && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          initial={{ x: '-100%' }}
          whileHover={{ x: '100%' }}
          transition={{ duration: 0.6 }}
        />
      )}
      <span className="relative z-raised flex items-center gap-2">{children}</span>
    </motion.button>
  )
}

export function MeshGradient({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return (
      <div className={`fixed inset-0 z-behind overflow-hidden ${className}`}>
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-family-500/15 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 rounded-full bg-info/10 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 rounded-full bg-success/8 blur-[120px]" />
      </div>
    )
  }

  return (
    <div className={`fixed inset-0 z-behind overflow-hidden ${className}`}>
      <motion.div
        className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-family-500/15 blur-[120px]"
        animate={{
          x: [0, 80, 0],
          y: [0, 60, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 -right-40 w-96 h-96 rounded-full bg-info/10 blur-[120px]"
        animate={{
          x: [0, -60, 0],
          y: [0, 80, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-40 left-1/3 w-96 h-96 rounded-full bg-success/8 blur-[120px]"
        animate={{
          x: [0, 40, 0],
          y: [0, -50, 0],
        }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, index }: { children: ReactNode; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: 'spring', stiffness: 300, damping: 25 }}
    >
      {children}
    </motion.div>
  )
}

export function ScoreRing({ score, size = 140 }: { score: number; size?: number }) {
  const radius = (size - 20) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#f87171'
  // The ring/glow keep the literal (it feeds `${color}80` alpha math);
  // the score NUMBER is text, so it goes through the semantic vars —
  // the pastel literals would fail AA on the light background.
  const textColor =
    score >= 80 ? 'rgb(var(--success))' : score >= 60 ? 'rgb(var(--warning))' : 'rgb(var(--danger))'
  // Number/caption were fixed at text-4xl/text-xs regardless of `size` —
  // fine at the 140/160 call sites, but Home's compact widget passes
  // size={80}, where a 36px number plus a 12px caption don't fit inside an
  // ~50px inner clear area (size minus the ring's own stroke) and visibly
  // overlap the ring's glow. Scale the number with the ring instead, and
  // below a threshold where two stacked lines genuinely can't fit legibly,
  // drop the caption rather than shrink it into something unreadable —
  // the same choice compact stat rings (e.g. Apple Watch activity rings)
  // make at small sizes.
  const numberPx = Math.round(size * 0.26)
  const showCaption = size >= 100

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="absolute inset-0 -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--tint) / 0.05)" strokeWidth="10" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
        />
      </svg>
      <div className="flex flex-col items-center">
        <motion.span
          className="font-bold leading-none"
          style={{ color: textColor, fontSize: numberPx }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 20 }}
        >
          {score}
        </motion.span>
        {showCaption && <span className="text-xs text-ink-tertiary mt-0.5">out of 100</span>}
      </div>
    </div>
  )
}

export function PulseDot({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const color =
    status === 'green'
      ? 'rgb(var(--success))'
      : status === 'yellow'
        ? 'rgb(var(--warning))'
        : 'rgb(var(--danger))'
  return (
    <span className="relative inline-flex w-3 h-3">
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      <span className="relative w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

export function PageHeader({
  title,
  subtitle,
  backHref,
  action,
}: {
  title: string
  subtitle?: string
  backHref?: string
  action?: ReactNode
}) {
  const assistantAction = title !== 'Oak' ? (
    <Link
      href="/assistant"
      onClick={() => haptic('light')}
      className="w-10 h-10 rounded-full bg-family-500/10 border border-family-500/20 flex items-center justify-center active:opacity-70 transition-opacity"
      aria-label="Assistant"
    >
      <Bot size={20} className="text-family-400" />
    </Link>
  ) : null

  return (
    // -mx-5 bleeds the sticky bar to the page edges — this is a contract:
    // it only aligns because every page root uses `px-5` (verified across
    // all ~30 consumers; the assistant page, which pads at px-4, renders
    // its own header). Change the shared page gutter and this has to move
    // with it.
    // Light-theme finding: bg-navbg/80 is near-opaque white, so the header
    // read as a hard-edged slab that ends at the content column instead of
    // the screen edge. Lighter tint plus a bottom fade mask (which also
    // fades the blur and removes the need for a border line) lets it melt
    // into the glass background while still keeping the title legible over
    // content scrolling underneath.
    <header className="sticky top-0 z-sticky safe-area-top bg-navbg/55 backdrop-blur-xl -mx-5 px-5 py-4 [mask-image:linear-gradient(to_bottom,#000_80%,transparent),linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)] [mask-composite:intersect] [-webkit-mask-image:linear-gradient(to_bottom,#000_80%,transparent),linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)] [-webkit-mask-composite:source-in]">
      <div className="flex items-center justify-between h-11">
        {backHref ? (
          <Link href={backHref} onClick={() => haptic('light')} className="flex items-center gap-1 text-ink-tertiary active:opacity-60">
            <ArrowLeft size={20} strokeWidth={2} />
            <span className="text-base font-medium">Back</span>
          </Link>
        ) : (
          <div />
        )}
        <div className="flex items-center">{action ?? assistantAction}</div>
      </div>
      {/* User-reported findings, all addressed here once since every page
          shares this header:
          1. text-title-lg (1.8rem on this app's 17px root, ~30.6px) read
             as too large on a real mobile screen — originally stepped down
             to title-md (~25.5px) only below md, escalating back to
             title-lg at md+. Live element-inspector feedback on a ~400px-
             wide container ("this is too big") showed that escalation
             still fires at md (768px) well before a header this size has
             room to justify it — dropped entirely; title-md is now the
             size at every width, not just the smallest one.
          2. "not modern" — semibold instead of bold (a heavy 700 black
             title reads as dated next to this app's otherwise light,
             glass-material UI), the same purple gradient the readiness
             score bar already uses (from-family-400 to-family-500) carried
             into the title itself rather than confined to icons/buttons,
             and more vertical room (py-3->py-4, pt-1/pb-1->pt-2/pb-2) so
             the title doesn't feel crowded against the header's own edges. */}
      <h1 className="text-title-md leading-tight font-semibold tracking-tight pt-2 pb-2 bg-gradient-to-r from-family-400 to-family-500 bg-clip-text text-transparent">
        {title}
      </h1>
      {subtitle && <p className="text-sm text-ink-tertiary pb-2">{subtitle}</p>}
    </header>
  )
}

export function ListSection({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      {title && <div className="px-1.5 text-sm font-semibold text-ink-tertiary uppercase tracking-wide">{title}</div>}
      <div className="rounded-2xl overflow-hidden border border-tint/[0.05] bg-tint/[0.03]">{children}</div>
    </div>
  )
}

export function Money({ value, className = '' }: { value: string; className?: string }) {
  const { config } = useMode()
  if (!config.showMoney) {
    return <span className={className}>•••</span>
  }
  return <span className={className}>{value}</span>
}

// Live-verification finding: this only matched $-prefixed amounts, but the
// AI assistant's real responses (apps/api/src/routes/assistant.ts) and the
// real subscription price on /upgrade are both £ — this app's actual
// currency, confirmed by the billing system's own GBP default. A £ amount
// in assistant prose was passing through completely unredacted in modes
// with showMoney off (e.g. Child), silently defeating the one feature this
// component exists for. Matches both symbols — $ still appears in sample/
// mock copy elsewhere that isn't live data.
const CURRENCY_PATTERN = /[£$][\d,]+(?:\.\d+)?[KMB]?/g

/**
 * Renders free-form text (e.g. an AI insight or income line item) with any
 * embedded currency amounts redacted in modes where showMoney is off —
 * Money only covers standalone values, but income/insight copy is prose
 * that mentions figures inline, so it needs its own masking pass.
 */
export function MoneyText({ text, className = '' }: { text: string; className?: string }) {
  const { config } = useMode()
  if (config.showMoney) {
    return <span className={className}>{text}</span>
  }
  return <span className={className}>{text.replace(CURRENCY_PATTERN, '•••')}</span>
}

export function IfAdvanced({ children }: { children: ReactNode }) {
  const { config } = useMode()
  if (!config.showAdvanced) return null
  return <>{children}</>
}

export function ListRow({
  label,
  icon: Icon,
  value,
  chevron,
  onClick,
  pressed,
  children,
}: {
  label?: string
  icon?: LucideIcon
  value?: ReactNode
  chevron?: boolean
  onClick?: () => void
  /** For a row that's one of several mutually-exclusive options (e.g. a
   * mode switcher) — sets aria-pressed so the selection state carried by
   * the `value` checkmark isn't visual-only. */
  pressed?: boolean
  children?: ReactNode
}) {
  const content = (
    <div className="flex items-center gap-3 px-4 py-3.5 min-h-[52px]">
      {Icon && (
        <div className="w-8 h-8 rounded-lg bg-tint/[0.05] flex items-center justify-center flex-shrink-0">
          <Icon size={18} className="text-ink-secondary" strokeWidth={2} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {children || <span className="text-base font-medium text-ink-primary">{label}</span>}
      </div>
      {value && <span className="text-sm text-ink-tertiary truncate max-w-[40%]">{value}</span>}
      {chevron && <ChevronRight size={18} className="text-ink-tertiary flex-shrink-0" />}
    </div>
  )

  if (onClick) {
    return (
      <motion.button
        whileTap={{ scale: 0.99 }}
        onClick={() => {
          haptic('light')
          onClick()
        }}
        aria-pressed={pressed}
        className="w-full text-left border-b border-tint/[0.04] last:border-0 active:opacity-80"
      >
        {content}
      </motion.button>
    )
  }

  return <div className="border-b border-tint/[0.04] last:border-0">{content}</div>
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-3xl border border-tint/[0.05] bg-tint/[0.03] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="flex items-center justify-around py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}
      </div>
      {lines > 0 && (
        <div className="space-y-2 mt-4 pt-4 border-t border-tint/5">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-3 w-8" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center text-center py-12 px-6"
    >
      <div className="w-16 h-16 rounded-3xl bg-tint/[0.04] border border-tint/[0.06] flex items-center justify-center mb-4">
        <Icon size={28} className="text-ink-tertiary" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-ink-secondary mb-1">{title}</h3>
      <p className="text-sm text-ink-tertiary leading-relaxed max-w-[260px] mb-4">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={() => { haptic('light'); onAction() }}
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-white bg-family-500/80 active:opacity-80 transition-opacity"
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  )
}
