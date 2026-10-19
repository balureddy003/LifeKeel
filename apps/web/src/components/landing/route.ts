/**
 * The marked route: a short, fixed-order preview of the planned single list of next
 * steps. Each card carries its own Live or Planned tag for the thing it describes and
 * names the claim in claims.ts that backs it. Sample family, made-up dates.
 */
export type RouteKind = 'DATE' | 'CHECK' | 'STEPS' | 'DRAFT'

export interface RouteCard {
  claim: string
  kind: RouteKind
  live: boolean
  title: string
  onFile: string
  needs: string
  does: string
  /** Position (of 1000 wide, 220 tall) of this card's lantern on the course. */
  x: number
  y: number
}

export const ROUTE: RouteCard[] = [
  {
    claim: 'renewals-duplicates',
    kind: 'DATE',
    live: true,
    title: 'Home policy renews in 45 days',
    onFile: 'Home policy and its renewal date.',
    needs: 'Nothing. Mark as seen when you like.',
    does: 'Shows the renewal date and the terms on file. Sends a reminder only if you turn reminders on.',
    x: 240,
    y: 56,
  },
  {
    claim: 'cover-on-file',
    kind: 'DATE',
    live: true,
    title: 'Life policy renews on 3 March',
    onFile: 'Life policy, cover of £180,000.',
    needs: 'Check the amount against your policy papers.',
    does: 'Notes that cover on file is below a rough estimate. A licensed professional can say what suits you.',
    x: 380,
    y: 30,
  },
  {
    claim: 'cover-on-file',
    kind: 'CHECK',
    live: true,
    title: 'Income protection is not on file',
    onFile: 'No income protection policy is listed.',
    needs: 'Add one if you hold it, or leave it.',
    does: 'Lists what it checked. It cannot see policies you have not entered.',
    x: 530,
    y: 64,
  },
  {
    claim: 'bad-day-steps',
    kind: 'STEPS',
    live: true,
    title: 'If something happens, the steps are ready',
    onFile: 'Policies, contacts and papers.',
    needs: 'Tell Keel what happened.',
    does: 'Lists the steps in order with your contacts filled in, and drafts a message to your own insurer. You send it.',
    x: 680,
    y: 24,
  },
  {
    claim: 'partner-overlap',
    kind: 'CHECK',
    live: false,
    title: 'Duplicate cover across partners',
    onFile: 'Policies held by each adult.',
    needs: 'Nothing today.',
    does: 'Will note when two policies of a shared type are on file, and will say it cannot tell if that is intended.',
    x: 830,
    y: 56,
  },
  {
    claim: 'claim-pack',
    kind: 'DRAFT',
    live: false,
    title: 'A claim-ready pack',
    onFile: 'The policy, contact and papers for one event.',
    needs: 'Nothing today.',
    does: 'Will put them on one page. You make the claim.',
    x: 940,
    y: 32,
  },
]
