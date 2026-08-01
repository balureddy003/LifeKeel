'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, HelpCircle, Briefcase, Wallet, DollarSign, Home, Shield, ClipboardList, Siren } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FAMILY_MEMBERS } from '@/lib/data'
import { PageHeader, Money, MoneyText } from '@/components/Glass'

function InfoSection({ title, items, icon: Icon }: { title: string; items: string[]; icon: LucideIcon }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={18} className="text-ink-secondary" />
        <span className="text-sm font-semibold text-ink-secondary">{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2">
            <Check size={14} className="text-success" />
            <MoneyText text={item} className="text-sm text-ink-primary" />
          </div>
        ))}
      </div>
    </div>
  )
}

function BranchCard({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="bg-surface-2 rounded-xl p-3 border border-haze/20">
      <div className="text-sm font-semibold text-family-400 mb-2">{label}</div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item} className="text-sm text-ink-secondary flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-family-400 flex-shrink-0" />
            <MoneyText text={item} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MemberProfileClient() {
  const params = useParams<{ id: string }>()
  const member = FAMILY_MEMBERS.find((m) => m.id === params.id)

  if (!member) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Family member not found</p>
        <Link href="/" className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader title={member.name} backHref="/" />

      {/* Financial role & net worth — owner only */}
      {member.financialRole && (
        <InfoSection title="Financial Role" items={[member.financialRole]} icon={Briefcase} />
      )}
      {member.netWorth && (
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={18} className="text-ink-secondary" />
            <span className="text-sm font-semibold text-ink-secondary">Net Worth</span>
          </div>
          <Money value={member.netWorth} className="text-2xl font-bold text-family-400" />
        </div>
      )}

      {/* Income */}
      {member.income && <InfoSection title="Income" items={member.income} icon={DollarSign} />}

      {/* Assets */}
      {member.assets && <InfoSection title="Assets" items={member.assets} icon={Home} />}

      {/* Protection */}
      {member.protection && <InfoSection title="Protection" items={member.protection} icon={Shield} />}

      {/* Responsibilities */}
      {member.responsibilities && <InfoSection title="Responsibilities" items={member.responsibilities} icon={ClipboardList} />}

      {/* Branches (visual map for this member) */}
      {member.branches && (
        <div className="card">
          <div className="text-sm font-semibold text-ink-secondary mb-3">Overview</div>
          <div className="space-y-3">
            {member.branches.map((branch) => (
              <BranchCard key={branch.label} label={branch.label} items={branch.items} />
            ))}
          </div>
        </div>
      )}

      {/* Simulate life event button */}
      <Link href="/events" className="btn-primary flex items-center justify-center gap-2 w-full">
        <Siren size={18} />
        <span>Simulate Life Event</span>
      </Link>
    </div>
  )
}
