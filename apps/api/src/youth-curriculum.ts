/**
 * Youth literacy curriculum (PRD-129).
 *
 * Age-banded financial-literacy cards served inside the youth twin's
 * redacted payload. Two bands: 'younger' (under 13) and 'teen' (13–17).
 * The band is chosen server-side — the same boundary that redacts money
 * picks the reading level, so there's no client path to the wrong band.
 *
 * Copy rules: no amounts, no products, no providers, no "ask your parents
 * to buy X." Concepts only — saving, waiting, growing, protecting — plus
 * one small "try it" activity per card. Everything is informational;
 * a card never references the child's actual data (goals are rendered
 * separately by the twin's savings_goals block).
 */

export interface YouthLesson {
  id: string
  title: string
  body: string
  /** One concrete, safe activity — always doable with a parent, never
   *  requires an account or a purchase. */
  try_it: string
}

export const YOUTH_CURRICULUM: Record<'younger' | 'teen', YouthLesson[]> = {
  younger: [
    {
      id: 'save-some-first',
      title: 'Save a little first',
      body: 'When money arrives — pocket money, a birthday gift — putting a bit aside before spending means there\'s always something growing for the things you really want.',
      try_it: 'Next time you get money, split it into "now" and "later" before you spend any of it.',
    },
    {
      id: 'money-grows-slowly',
      title: 'Money grows slowly — and that\'s the point',
      body: 'Savings don\'t jump; they build up little by little, like a plant. The families who reach big goals are usually the ones who started small and kept going.',
      try_it: 'Watch your savings goal on this page over a few weeks and see how the bar creeps up.',
    },
    {
      id: 'needs-and-wants',
      title: 'Needs before wants',
      body: 'Some things a family must pay for — food, a home, keeping the lights on. The fun stuff comes after those are covered. That order is what "a budget" really means.',
      try_it: 'Sort five things your family pays for into "need" and "want" — ask a grown-up if you\'re not sure.',
    },
  ],
  teen: [
    {
      id: 'compounding',
      title: 'Growth that grows itself',
      body: 'Money invested or saved earns a return — and next year the return earns a return too. Starting at 15 instead of 25 can matter more than how much you put in. That\'s why your fund was started early.',
      try_it: 'Compare: £10/month from age 15 to 25 vs age 25 to 35 at 5% growth — the earlier start usually wins despite half the contributions.',
    },
    {
      id: 'what-a-pension-is',
      title: 'A pension is just long-horizon saving',
      body: 'The adults in your family put money into pensions — savings locked away for decades so they can stop working one day. It\'s the same idea as your goal, just aimed much further out.',
      try_it: 'Ask a parent where their pension contribution goes each month — most people can\'t answer offhand, so it\'s a good question.',
    },
    {
      id: 'borrowing-costs',
      title: 'Borrowed money isn\'t free money',
      body: 'A loan or credit card charges interest — you repay more than you borrowed. Used carefully (like a mortgage for a home) it\'s a tool; used casually it quietly eats future-you\'s money.',
      try_it: 'Look up the APR on any credit card offer — then work out what a £100 purchase costs if repaid over a year.',
    },
    {
      id: 'insurance-is-protection',
      title: 'Insurance = paying a little to avoid losing a lot',
      body: 'Your family pays small amounts regularly so that one bad day — illness, an accident — doesn\'t wipe out everything they\'ve saved. It\'s a safety net, not an investment.',
      try_it: 'Ask which insurance policies your family holds and what each one protects.',
    },
  ],
}

export function youthLessonsFor(band: 'younger' | 'teen'): YouthLesson[] {
  return YOUTH_CURRICULUM[band]
}
