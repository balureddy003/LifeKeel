/**
 * The story board. Six chapters, each a thing a family says out loud, and one scene per use case
 * inside them. Chapter 7, "It's yours", is the trust section, not part of this board.
 *
 * A new use case never changes the story: it adds one scene here and one claim in claims.ts. Every
 * scene needs a claim (`claim`), written in the family's words (`text`), and an honest limit
 * (`qualifier`) when it is live. Scenes with `live: false` are the in-app roadmap's data: the public
 * board renders only `live` ones, and no Live or Planned wording appears on the public site.
 * The admission test is in docs/prd/209-landing-chart-story.md; the story system is in
 * docs/research/brand-and-story-guide-2026-11-08.md.
 */
export type Chapter = 'find' | 'know' | 'dates' | 'ask' | 'help' | 'change'

export interface Capability {
  /** Id of the claim in claims.ts that backs this line. */
  claim: string
  chapter: Chapter
  text: string
  live: boolean
  /** Shown beside a scene so it is never read as always-on or unconditional. */
  qualifier?: string
}

export const CHAPTERS: { id: Chapter; name: string; says: string; line: string }[] = [
  { id: 'find', name: 'Find it', says: '“Where’s the…?”', line: 'One place to look.' },
  {
    id: 'know',
    name: 'Everyone knows',
    says: '“Do you know about…?”',
    line: 'Every adult is asked to look.',
  },
  {
    id: 'dates',
    name: 'Dates, not surprises',
    says: '“What’s coming up?”',
    line: 'See what is next.',
  },
  {
    id: 'ask',
    name: 'Money questions',
    says: '“What if we…?”',
    line: 'One answer from your own figures.',
  },
  {
    id: 'help',
    name: 'Where to start',
    says: '“Something’s happened.”',
    line: 'Steps from what you have added.',
  },
  {
    id: 'change',
    name: 'A list that keeps up',
    says: '“Things have changed.”',
    line: 'People come and go. The list copes.',
  },
]

export const CAPABILITIES: Capability[] = [
  // 1. “Where’s the…?” — find it
  {
    claim: 'family-list',
    chapter: 'find',
    text: 'Policies, cars and school dates on one list',
    live: true,
    qualifier: 'Shows what your family adds. Nothing is added for you',
  },
  {
    claim: 'vault',
    chapter: 'find',
    text: 'Papers that every adult can open',
    live: true,
    qualifier:
      'Only adults who have joined. A passphrase is optional, and if it is lost it cannot be recovered',
  },
  {
    claim: 'papers-on-file',
    chapter: 'find',
    text: 'Wills and papers on file',
    live: true,
    qualifier: 'Checks whether you have added them. Keel cannot judge a will',
  },
  {
    claim: 'who-to-call',
    chapter: 'find',
    text: 'Who to call, from your policy papers',
    live: true,
    qualifier: 'Only if the contact is on file. Reading an uploaded policy needs Keel Plus',
  },
  {
    claim: 'employer-cover',
    chapter: 'find',
    text: 'Cover that comes with a job',
    live: true,
    qualifier:
      'You enter what your payslip or HR portal shows. Keel cannot see your employer’s policy',
  },
  {
    claim: 'ask-keel',
    chapter: 'find',
    text: 'Ask about what you have on file',
    live: true,
    qualifier: 'Answers from what you have entered. Information only, not advice',
  },

  // 2. “Do you know about…?” — everyone knows
  {
    claim: 'every-adult-confirms',
    chapter: 'know',
    text: 'Each adult confirms they have seen the list',
    live: true,
    qualifier:
      'A change asks everyone to look again. Someone can be excused, for example if they are unwell',
  },
  {
    claim: 'join-with-code',
    chapter: 'know',
    text: 'An adult joins with a code, and you approve them',
    live: true,
    qualifier: 'They see nothing until you approve. A request lapses after 14 days',
  },
  {
    claim: 'edit-access',
    chapter: 'know',
    text: 'You choose who can change the list',
    live: true,
    qualifier: 'Every adult can see it and confirm it. Children are never asked to confirm',
  },
  {
    claim: 'household-brief',
    chapter: 'know',
    text: 'An answer you share with the other adult',
    live: true,
    qualifier: 'You see when they have opened it',
  },
  {
    claim: 'obligations-map',
    chapter: 'know',
    text: 'Who each bill and account depends on',
    live: true,
    qualifier:
      'You enter each one. Keel infers nothing. The adult named on a row confirms it themselves',
  },

  // 3. “What’s coming up?” — dates, not surprises
  {
    claim: 'dates-coming-up',
    chapter: 'dates',
    text: 'MOT, renewal and fees dates, with what is next',
    live: true,
    qualifier: 'From the dates you add. It does not check any register',
  },
  {
    claim: 'monthly-letter',
    chapter: 'dates',
    text: 'A monthly note of what changed',
    live: true,
    qualifier: 'It says so when nothing changed. It lists counts and dates, not names or amounts',
  },
  {
    claim: 'renewals-duplicates',
    chapter: 'dates',
    text: 'Policy renewals and duplicate policies',
    live: true,
    qualifier: 'Reminders are opt-in. Duplicates are flagged for the same person only',
  },
  {
    claim: 'payment-gaps',
    chapter: 'dates',
    text: 'A policy with no recent payment on file',
    live: true,
    qualifier:
      'Based on the dates you enter. Keel cannot tell whether cover is in force, so check with your provider',
  },
  {
    claim: 'nomination-check',
    chapter: 'dates',
    text: 'A nomination that no longer fits your family',
    live: true,
    qualifier:
      'Compares two records you entered. It never says who to name: trustees or the scheme decide',
  },
  {
    claim: 'alert-channels',
    chapter: 'dates',
    text: 'Alerts on your phone or by email',
    live: true,
    qualifier: 'Opt-in. Settings shows which channel works on your device',
  },
  {
    claim: 'partner-overlap',
    chapter: 'dates',
    text: 'Overlap between partners’ policies',
    live: false,
  },
  { claim: 'next-steps', chapter: 'dates', text: 'One ordered list of next steps', live: false },

  // 4. “What if we…?” — money questions
  {
    claim: 'runway',
    chapter: 'ask',
    text: 'How many months your savings would last',
    live: true,
    qualifier: 'Works from the figures you enter',
  },
  {
    claim: 'what-if',
    chapter: 'ask',
    text: '"What if" for a change in pay or costs',
    live: true,
    qualifier: 'A rehearsal on your figures, not a forecast',
  },
  {
    claim: 'cover-on-file',
    chapter: 'ask',
    text: 'Life, income and health cover on file',
    live: true,
    qualifier: 'Rough estimates from what you enter. Keel does not read policy wording',
  },
  {
    claim: 'retirement-education',
    chapter: 'ask',
    text: 'Retirement and education pace',
    live: true,
    qualifier: 'Works from the figures you enter',
  },
  {
    claim: 'debt-health',
    chapter: 'ask',
    text: 'Debt health',
    live: true,
    qualifier: 'Works from the figures you enter',
  },

  // 5. “Something’s happened.” — where to start
  {
    claim: 'first-steps-from-list',
    chapter: 'help',
    text: 'First steps that fit what is on your list',
    live: true,
    qualifier: 'Information only. In an emergency, call 999',
  },
  {
    claim: 'bad-day-steps',
    chapter: 'help',
    text: 'Steps for seven kinds of bad day',
    live: true,
    qualifier: 'Starts when you say what happened',
  },
  {
    claim: 'claim-pack',
    chapter: 'help',
    text: 'Claim packet for a life policy',
    live: true,
    qualifier:
      'A checklist and a draft from your own record. You send it; your insurer’s own claim pack is the authority',
  },
  {
    claim: 'draft-insurer',
    chapter: 'help',
    text: 'Draft message to your own insurer',
    live: true,
    qualifier: 'You edit it and send it. Keel never sends it',
  },
  {
    claim: 'continuity-emails',
    chapter: 'help',
    text: 'Emails to people you name if you go quiet',
    live: true,
    qualifier: 'Opt-in, off by default. It points them to papers they can already open',
  },
  {
    claim: 'how-to-claim',
    chapter: 'help',
    text: 'Plain how-to-claim guide for each kind of policy',
    live: false,
  },

  // 6. “Things have changed.” — a list that keeps up
  {
    claim: 'leave-and-removal',
    chapter: 'change',
    text: 'Anyone can leave, and a person removed is cut off at once',
    live: true,
    qualifier: 'A child cannot leave alone. The account owner hands over first',
  },
  {
    claim: 'new-life-events',
    chapter: 'change',
    text: 'New checks for new life events',
    live: false,
  },
  {
    claim: 'named-person-access',
    chapter: 'change',
    text: 'Access for a named person outside the family',
    live: false,
  },
]
