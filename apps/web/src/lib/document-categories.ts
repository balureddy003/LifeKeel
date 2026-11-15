import {
  ShieldCheck,
  Landmark,
  Home,
  TrendingUp,
  Receipt,
  Scale,
  FileText,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  insurance: ShieldCheck,
  pension: Landmark,
  income: Receipt,
  mortgage: Home,
  investment: TrendingUp,
  tax: Receipt,
  will: Scale,
  banking: Wallet,
  other: FileText,
}

export const CATEGORY_LABELS: Record<string, string> = {
  insurance: 'Insurance',
  pension: 'Pension',
  income: 'Income',
  mortgage: 'Mortgage',
  investment: 'Investment',
  tax: 'Tax',
  will: 'Will / Estate',
  banking: 'Bank statement',
  other: 'Other',
}
