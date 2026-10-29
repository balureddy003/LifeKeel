import { Baby, Briefcase, HeartHandshake, House, type LucideIcon } from 'lucide-react'

/**
 * Front doors for the catalogue, grouped by what is happening in the
 * household rather than by product category. Entries not listed here are still
 * reachable from "More situations" (search + full list).
 */
export interface Moment {
  id: string
  title: string
  blurb: string
  icon: LucideIcon
  entries: string[]
}

export const MOMENTS: Moment[] = [
  {
    id: 'baby',
    title: 'A baby is coming',
    blurb: 'Parental leave, nursery and the first year',
    icon: Baby,
    entries: ['pregnancy', 'nursery', 'fees_start', 'school_start'],
  },
  {
    id: 'job',
    title: 'A job is changing',
    blurb: 'Notice, fewer hours, a break or retiring',
    icon: Briefcase,
    entries: [
      'income_stops',
      'earning_less',
      'job_change',
      'hours_cut',
      'unpaid_leave',
      'self_employed',
      'retiring',
    ],
  },
  {
    id: 'care',
    title: 'Someone needs care',
    blurb: 'Supporting a parent or partner, and who knows what',
    icon: HeartHandshake,
    entries: ['supporting_relative', 'care_handover', 'medical_contacts', 'bereavement'],
  },
  {
    id: 'home',
    title: 'A bill or home is changing',
    blurb: 'Mortgage, rent, a move or a lump sum',
    icon: House,
    entries: [
      'mortgage_fix',
      'rent_rise',
      'tenancy_end',
      'moving_home',
      'renewal',
      'energy_council_tax',
      'car_repair',
      'windfall',
      'debt_payoff',
      'rental_change',
    ],
  },
]
