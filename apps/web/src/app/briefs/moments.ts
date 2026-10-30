import { Baby, Briefcase, HeartHandshake, House, type LucideIcon } from 'lucide-react'

/**
 * Front doors for the catalogue, grouped by what is happening in the
 * household rather than by product category. Which entries sit behind each
 * door comes from the API (`entry.moment`, Intent 80), so the server stays the
 * single source of truth. Entries with no moment are still reachable from
 * "see every situation" (search + full list).
 */
export type MomentKey = 'baby' | 'job' | 'care' | 'fix'

export interface Moment {
  key: MomentKey
  title: string
  blurb: string
  icon: LucideIcon
}

export const MOMENTS: Moment[] = [
  {
    key: 'job',
    title: 'A job is changing',
    blurb: 'Notice, fewer hours, a break or retiring',
    icon: Briefcase,
  },
  {
    key: 'baby',
    title: 'A baby is coming',
    blurb: 'Parental leave, nursery and the first year',
    icon: Baby,
  },
  {
    key: 'care',
    title: 'A parent needs care',
    blurb: 'Supporting someone, and who knows what',
    icon: HeartHandshake,
  },
  {
    key: 'fix',
    title: 'A fix is ending',
    blurb: 'Mortgage, rent, a bill or a lump sum',
    icon: House,
  },
]
