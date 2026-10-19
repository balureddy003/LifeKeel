/**
 * The story board. One entry per capability, grouped by the moment it helps with.
 * Adding a capability to the page means adding one line here and one claim in
 * claims.ts. The admission test is in docs/prd/209-landing-chart-story.md.
 * Entries with `live: false` are the in-app roadmap's data: the public board renders
 * only `live` ones, and no Live or Planned wording appears on the public site.
 */
export type Moment = 'before' | 'during' | 'after'

export interface Capability {
  /** Id of the claim in claims.ts that backs this line. */
  claim: string
  moment: Moment
  text: string
  live: boolean
  /** Shown beside a Live tag so Live is never read as always-on or unconditional. */
  qualifier?: string
}

export const MOMENTS: { id: Moment; name: string; line: string }[] = [
  { id: 'before', name: 'Before', line: 'Know where you stand.' },
  { id: 'during', name: 'During', line: 'Find what you need.' },
  { id: 'after', name: 'After', line: 'Send what is ready.' },
]

export const CAPABILITIES: Capability[] = [
  {
    claim: 'runway',
    moment: 'before',
    text: 'Emergency fund and savings runway',
    live: true,
    qualifier: 'Works from the figures you enter',
  },
  {
    claim: 'cover-on-file',
    moment: 'before',
    text: 'Life, income and health cover on file',
    live: true,
    qualifier: 'Rough estimates from what you enter. Keel does not read policy wording',
  },
  {
    claim: 'renewals-duplicates',
    moment: 'before',
    text: 'Policy renewals and duplicate policies',
    live: true,
    qualifier: 'Reminders are opt-in. Duplicates are flagged for the same person only',
  },
  {
    claim: 'partner-overlap',
    moment: 'before',
    text: 'Overlap between partners’ policies',
    live: false,
  },
  {
    claim: 'retirement-education',
    moment: 'before',
    text: 'Retirement and education pace',
    live: true,
    qualifier: 'Works from the figures you enter',
  },
  { claim: 'next-steps', moment: 'before', text: 'One ordered list of next steps', live: false },
  {
    claim: 'debt-health',
    moment: 'before',
    text: 'Debt health',
    live: true,
    qualifier: 'Works from the figures you enter',
  },
  {
    claim: 'papers-on-file',
    moment: 'before',
    text: 'Wills and papers on file',
    live: true,
    qualifier: 'Checks whether you have added them. Keel cannot judge a will',
  },
  {
    claim: 'what-if',
    moment: 'before',
    text: '"What if" runway simulator',
    live: true,
    qualifier: 'A rehearsal on your figures, not a forecast',
  },
  {
    claim: 'monthly-letter',
    moment: 'before',
    text: 'Monthly letter about what changed',
    live: false,
  },

  {
    claim: 'vault',
    moment: 'during',
    text: 'Documents your family’s adults can open',
    live: true,
    qualifier:
      'Adults who have joined your household. Passphrase sealing is optional and has no recovery',
  },
  {
    claim: 'bad-day-steps',
    moment: 'during',
    text: 'Steps for seven kinds of bad day',
    live: true,
    qualifier: 'Starts when you say what happened',
  },
  {
    claim: 'continuity-emails',
    moment: 'during',
    text: 'Emails to people you name if you go quiet',
    live: true,
    qualifier: 'Opt-in, off by default. It points them to papers they can already open',
  },
  {
    claim: 'named-person-access',
    moment: 'during',
    text: 'Access for a named person outside the family',
    live: false,
  },

  {
    claim: 'who-to-call',
    moment: 'after',
    text: 'Who to call, from your policy papers',
    live: true,
    qualifier: 'Only if the contact is on file. Reading an uploaded policy needs Keel Plus',
  },
  {
    claim: 'draft-insurer',
    moment: 'after',
    text: 'Draft message to your own insurer',
    live: true,
    qualifier: 'You edit it and send it. Keel never sends it',
  },
  {
    claim: 'how-to-claim',
    moment: 'after',
    text: 'Plain how-to-claim guide for each kind of policy',
    live: false,
  },
  {
    claim: 'claim-pack',
    moment: 'after',
    text: 'Claim-ready pack: policies, contacts, papers',
    live: false,
  },
  {
    claim: 'new-life-events',
    moment: 'after',
    text: 'New checks for new life events',
    live: false,
  },
]
