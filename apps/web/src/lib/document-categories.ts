import { ShieldCheck, Landmark, Home, TrendingUp, Receipt, Scale, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  insurance: ShieldCheck,
  pension: Landmark,
  mortgage: Home,
  investment: TrendingUp,
  tax: Receipt,
  will: Scale,
  other: FileText,
}

export const CATEGORY_LABELS: Record<string, string> = {
  insurance: 'Insurance',
  pension: 'Pension',
  mortgage: 'Mortgage',
  investment: 'Investment',
  tax: 'Tax',
  will: 'Will / Estate',
  other: 'Other',
}
