'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Building2,
  UserPlus,
  Tag,
  CreditCard,
  FileText,
  Megaphone,
  ShieldCheck,
  Activity,
  SlidersHorizontal,
  ScrollText,
  Settings,
  ArrowLeft,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

const links = [
  { href: '/operator', label: 'Overview', icon: LayoutDashboard },
  { href: '/operator/users', label: 'Users', icon: Users },
  { href: '/operator/tenants', label: 'Tenants', icon: Building2 },
  { href: '/operator/leads', label: 'Leads', icon: UserPlus },
  { href: '/operator/promotions', label: 'Promotions', icon: Tag },
  { href: '/operator/billing', label: 'Billing', icon: CreditCard },
  { href: '/operator/content', label: 'Content', icon: FileText },
  { href: '/operator/marketing', label: 'Marketing', icon: Megaphone },
  { href: '/operator/operators', label: 'Operators', icon: ShieldCheck },
  { href: '/operator/operations', label: 'Operations', icon: Activity },
  { href: '/operator/configuration', label: 'Configuration', icon: SlidersHorizontal },
  { href: '/operator/audit', label: 'Audit', icon: ScrollText },
  { href: '/operator/settings', label: 'Settings', icon: Settings },
]

function isActive(pathname: string, href: string) {
  return href === '/operator' ? pathname === '/operator' : pathname.startsWith(href)
}

function useSignOut() {
  const { signOut } = useAuth()
  const router = useRouter()
  return () => {
    signOut()
    router.push('/login')
  }
}

// Compact icon button for the mobile header, where the rail (and its
// footer sign-out row) isn't rendered.
export function OperatorSignOutButton() {
  const handleSignOut = useSignOut()
  return (
    <button
      onClick={handleSignOut}
      aria-label="Sign out"
      className="rounded-lg p-2 text-ink-tertiary hover:text-ink-primary"
    >
      <LogOut size={17} />
    </button>
  )
}

// Desktop (md+): fixed left rail. The console's 12 sections overflowed the
// old top tab strip — a rail is also the standard pattern for admin
// consoles and leaves the full content width for tables.
export function OperatorSidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const handleSignOut = useSignOut()
  return (
    <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-sticky md:flex md:w-56 md:flex-col border-r border-tint/[0.08] bg-navbg/80 backdrop-blur-xl">
      <div className="border-b border-tint/[0.08] px-5 py-4">
        <Link href="/operator" className="font-semibold text-family-400">Agent Oak Operator</Link>
        <p className="mt-0.5 text-caption text-ink-tertiary">Platform console</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {links.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                active
                  ? 'bg-family-500/10 font-semibold text-family-accent'
                  : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              <Icon size={17} strokeWidth={active ? 2.4 : 2} className="flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-tint/[0.08] px-3 py-4 space-y-1">
        {user && (
          <div className="px-3 pb-2">
            <p className="truncate text-sm font-medium text-ink-primary">{user.name || 'Operator'}</p>
            <p className="truncate text-caption text-ink-tertiary">{user.email}</p>
          </div>
        )}
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-tertiary hover:text-ink-primary"
        >
          <ArrowLeft size={17} className="flex-shrink-0" />
          Back to product
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-tertiary hover:text-ink-primary"
        >
          <LogOut size={17} className="flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

// Below md there's no room for a rail — keep the horizontally scrollable
// strip, now with the same active-state styling as the sidebar.
export function OperatorTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 md:hidden">
      {links.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${
              active
                ? 'border-family-500/30 bg-family-500/10 font-semibold text-family-accent'
                : 'border-tint/[0.08] text-ink-secondary hover:text-ink-primary'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
