/**
 * Evergreen SEO guides — one per detector in detectors/family/*.yaml.
 * Copy is derived from the same heuristics the detectors evaluate (3-6
 * month emergency fund, mortgage + education + 5y living expenses cover,
 * projected-vs-target retirement age, education target vs years left) so
 * what a visitor reads is exactly what Oak later checks for their family.
 *
 * Same rule as the detectors' reasoning_template: informational only —
 * never name a product or provider, always point to licensed
 * professionals and comparing multiple quotes.
 */

export interface GuideSection {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

export interface GuideFaq {
  q: string
  a: string
}

export interface Guide {
  slug: string
  /** SEO title + on-page h1 (kept identical so SERP matches the page). */
  title: string
  /** Meta description + index-card blurb. */
  description: string
  tagline: string
  intro: string[]
  sections: GuideSection[]
  faq: GuideFaq[]
}

const QUIZ_CTA = 'Take the free Family Readiness Check — six questions, no signup, and see which of these areas Oak would flag for your household.'

export const GUIDES: Guide[] = [
  {
    slug: 'emergency-fund-how-much',
    title: 'How Much Should a Family Emergency Fund Be?',
    description: 'The 3-6 month guideline, how to compute your household number, and what to consider when savings sit far above — or below — the target.',
    tagline: 'The first buffer between a bad month and a bad year',
    intro: [
      'An emergency fund is money set aside for expenses you cannot plan for: a lost job, a medical bill, a car that dies the week before a trip. The most commonly cited guideline is three to six months of essential household expenses — enough to keep the household running while income resumes or alternatives are arranged.',
      'Three months is a floor, not a target. Households with a single income, variable earnings, or dependents often aim closer to six. The right number is specific to your household — the sections below walk through how to compute it.',
    ],
    sections: [
      {
        heading: 'Computing your number',
        paragraphs: [
          'Start with monthly essential expenses: housing, utilities, food, transport, insurance premiums, minimum debt payments — the bills that do not stop when income does. Multiply by three for the floor and six for the fuller cushion.',
          'A household spending £3,000 a month on essentials has a floor of £9,000 and a fuller target of £18,000. The gap between what you have and that number is the shortfall worth knowing about.',
        ],
        bullets: [
          'Use essential expenses, not take-home pay — lifestyle spending pauses in an emergency, rent does not.',
          'Adjust for income risk: single-income and self-employed households lean toward six months.',
          'Adjust for dependents: more people relying on the fund means a larger target.',
        ],
      },
      {
        heading: 'Too little, and too much',
        paragraphs: [
          'Below three months, the fund may not survive a typical job-search window — this is the shortfall most guidelines focus on.',
          'Above about twelve months, the question flips: savings far beyond the cushion earn little interest, and if the household carries high-interest debt, some households review whether part of that excess could reduce interest costs instead. At typical high-interest rates of 15-25% APR, a large balance can cost more per year than the extra savings earn.',
        ],
      },
      {
        heading: 'How Oak checks this',
        paragraphs: [
          'Oak compares your listed emergency savings against your monthly expenses and flags a fund below three months or above twelve alongside high-interest debt — the same arithmetic on this page, run continuously against your actual numbers rather than a worksheet you fill in once.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is three months of expenses enough?',
        a: 'Three months is widely treated as a minimum. Households with one income, variable earnings, or several dependents often target six months or more. A financial professional can help size the target for your situation.',
      },
      {
        q: 'Where should emergency savings be kept?',
        a: 'Somewhere accessible and low-risk — the fund needs to be there the day it is needed, not after a market recovery or a notice period. Comparing accounts from multiple providers on access and interest rate is a common approach.',
      },
      {
        q: 'Should I build the fund or pay off high-interest debt first?',
        a: 'Both matter; many households keep a small starter buffer while addressing high-interest debt, since the interest often outpaces savings returns. A financial advisor or credit counselor can help weigh the order for your numbers.',
      },
      {
        q: 'Does the fund count retirement savings?',
        a: 'No — the emergency fund is separate from retirement and education savings. Those are long-horizon goals; the fund exists to absorb short-term shocks without touching them.',
      },
    ],
  },
  {
    slug: 'family-protection-gap',
    title: 'The Family Protection Gap: What If a Household Income Stops?',
    description: 'How families estimate the coverage gap — mortgage, education costs, and living expenses — and what the gap looks like in real numbers.',
    tagline: 'The difference between what is covered and what the household would need',
    intro: [
      'A protection gap is the difference between what a household would need if an earner\'s income stopped, and the coverage actually in place. It is one of the least visible financial risks a family carries — nothing about it shows up in a bank balance until the day it matters.',
      'The estimate is arithmetic, not guesswork: outstanding mortgage, remaining education costs, and several years of household living expenses, minus whatever life or income cover is already listed.',
    ],
    sections: [
      {
        heading: 'Estimating household need',
        paragraphs: [
          'A common starting estimate adds the mortgage balance, any remaining education funding gap, and roughly five years of living expenses. A household with a £200,000 mortgage, a £30,000 education gap, and £40,000 annual living costs arrives at a need figure near £430,000.',
          'Compare that against the cover listed today — employer death-in-service benefits, existing life policies — and the difference is the gap. For many households the number is large enough that knowing it is the valuable part, whatever is done about it next.',
        ],
      },
      {
        heading: 'What protection typically covers',
        paragraphs: [
          'Life cover addresses the permanent case: the household keeps the house and the plan if an earner dies. Income protection and critical-illness cover address the interrupted case: an earner alive but unable to work for months or years — statistically the more common disruption.',
          'Renewal windows matter too. Policies approaching renewal are moments when cover amounts, exclusions, and premiums all change — a gap can appear or grow silently at a renewal nobody reviewed.',
        ],
        bullets: [
          'Life cover — the permanent-income-loss case',
          'Income protection — the unable-to-work case',
          'Critical-illness cover — the large-one-off-cost case',
          'Renewal review — the quietly-changed-terms case',
        ],
      },
      {
        heading: 'How Oak checks this',
        paragraphs: [
          'Oak computes the same need estimate — mortgage plus education gap plus five years of living expenses — against the cover in a family\'s profile, and flags when listed cover falls below it, when no income protection is listed, and when a policy renewal window is approaching.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much life insurance does a family need?',
        a: 'A common estimate is outstanding mortgage plus remaining education costs plus several years of living expenses, minus existing cover. The right figure depends on dependents, debts, and goals — a licensed insurance professional can evaluate your household\'s need.',
      },
      {
        q: 'What is the difference between life insurance and income protection?',
        a: 'Life insurance pays out if the covered person dies; income protection replaces part of an income while someone is alive but unable to work. They cover different disruptions and many households consider both.',
      },
      {
        q: 'Who actually needs this cover?',
        a: 'Households where people depend on an income — dependents, a mortgage, education plans. A single renter with no dependents may have little need; a licensed professional can confirm either way.',
      },
      {
        q: 'How do we fill a gap if we find one?',
        a: 'Compare quotes from multiple insurers and consider speaking with a licensed insurance broker who can assess the household\'s coverage needs. Product and provider choices are individual — Oak surfaces the gap; licensed professionals advise on filling it.',
      },
    ],
  },
  {
    slug: 'retirement-gap-check',
    title: 'Is Your Retirement Savings on Track? The Gap Check',
    description: 'How to compare your projected retirement age against your target, what the contribution math looks like, and when contributions alone are not the answer.',
    tagline: 'Two numbers decide everything: when you want to stop, and when the savings say you can',
    intro: [
      'Retirement planning reduces to a comparison most households have never made: the age the savings project to, versus the age the household wants. When the projected age lands after the target, the difference is the retirement gap.',
      'The gap has a price — the extra monthly contribution that would close it. Sometimes that number is manageable. Sometimes it exceeds what contributions alone can do, and that case deserves different thinking.',
    ],
    sections: [
      {
        heading: 'The projection, in plain terms',
        paragraphs: [
          'Start with the pension balance today and the monthly contribution going in. Extend both forward at a reasonable growth assumption to the target retirement age. If the projected pot falls short of what the household would need to retire at that age, the projection pushes retirement later — the projected age rises until the numbers close.',
          'The useful figure is usually not the pot itself but the monthly contribution change that would bring the projected age back to the target. An extra £150 a month is actionable information; a vague sense of being behind is not.',
        ],
      },
      {
        heading: 'When contributions alone are not enough',
        paragraphs: [
          'If closing the gap by the target age would require a monthly contribution larger than the household can reasonably carry, the honest answer is that contributions are not the only lever. Retirement date, expected spending, and other assets all move the projection too.',
          'A household near retirement age with a large gap faces a different problem than a household in its thirties — the projection model and the realistic levers differ, which is why a single rule of thumb misleads.',
        ],
      },
      {
        heading: 'Starting from zero',
        paragraphs: [
          'No retirement savings listed at all is a common finding and the math is the same — the gap is just the whole target. Starting earlier gives contributions more years to compound; starting later increases the monthly amount needed for the same target.',
        ],
      },
      {
        heading: 'How Oak checks this',
        paragraphs: [
          'Oak projects the retirement age from the pension balance, contribution rate, and target in a family\'s profile — then flags when the projection lands late, when the required contribution would exceed half of monthly income (the contributions-alone-are-not-enough case), and when no retirement savings are listed at all.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much should I be saving for retirement?',
        a: 'Enough that the projected balance supports your target age — the honest answer is a projection specific to your balance, contribution, and timeline. A qualified financial professional can model it for your situation.',
      },
      {
        q: 'What if the monthly contribution needed is more than I earn?',
        a: 'Then contributions alone are not the lever — the projection moves with retirement timing, expected spending, and other assets too. This case is worth a conversation with a financial advisor rather than a single-product fix.',
      },
      {
        q: 'Is it too late to start in my forties or fifties?',
        a: 'Not too late, but the monthly amount required rises steeply with each deferred year — which is exactly why knowing the projected-versus-target number early is valuable.',
      },
      {
        q: 'Are these projections guaranteed?',
        a: 'No. Projections are estimates built on assumptions about growth, contributions, and timing — they inform planning and are worth reviewing periodically with a qualified professional.',
      },
    ],
  },
  {
    slug: 'education-savings-plan',
    title: 'Saving for a Child\'s Education: How Far Ahead Should You Be?',
    description: 'How to measure progress toward an education savings target, why years remaining matter more than the balance, and what starting from zero looks like.',
    tagline: 'The target is fixed; the runway is what changes',
    intro: [
      'Education saving has a deadline most goals lack: the child turns eighteen on schedule whether the fund is ready or not. That makes progress measurable — current savings against target, divided by the runway left.',
      'Two findings cover most households: a fund that exists but is behind pace for the years remaining, and a fund that has not started yet.',
    ],
    sections: [
      {
        heading: 'Measuring the shortfall',
        paragraphs: [
          'Divide current savings by the target, then weigh the percentage against years remaining. A fund at half its target is comfortable with fifteen years left and urgent with five — the same balance, opposite readings. Runway is the variable that decides which.',
          'With five years or fewer remaining and savings below half the target, the contribution rate required to close the gap climbs quickly — which is why the check matters more than the balance.',
        ],
      },
      {
        heading: 'Not started yet',
        paragraphs: [
          'Zero saved with years still on the clock is the most common position. The compound-growth math favours starting over waiting: a small monthly contribution begun early can outrun a larger one begun late, because the early contributions spend more years growing.',
          'Tax-advantaged education savings vehicles exist in most countries and are worth researching — the specifics differ by jurisdiction, and a qualified financial professional can advise on what applies to your household.',
        ],
      },
      {
        heading: 'How Oak checks this',
        paragraphs: [
          'For each child in a family\'s profile, Oak compares current education savings against the target and the years remaining — flagging funds below half-target inside five years, and funds not started for children under sixteen, so the runway shrinks visibly rather than silently.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much should I save for my child\'s education?',
        a: 'Work backward from the target cost and the years remaining — the same balance means very different things at different runways. A financial advisor can help set a target and a monthly contribution that fits your household.',
      },
      {
        q: 'What if I have not started saving yet?',
        a: 'The runway still works in your favour — early contributions compound for more years, so starting small now usually beats starting large later. Research the education savings options available in your country.',
      },
      {
        q: 'Should education savings come before retirement?',
        a: 'Most guidance treats retirement as the harder constraint — education has loans, scholarships, and timing flexibility that retirement does not. The right ordering depends on your household; a qualified professional can weigh it.',
      },
      {
        q: 'Are education savings projections guaranteed?',
        a: 'No — they are estimates based on contribution, growth, and time assumptions. Review them periodically, especially as the deadline approaches.',
      },
    ],
  },
]

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug)
}

/** CTA link into the readiness quiz, UTM'd per-guide so utm_content joins
 *  the lead/signup funnel back to the exact page that sent them. */
export function guideQuizUrl(slug: string): string {
  const params = new URLSearchParams({
    utm_source: 'guides',
    utm_medium: 'content',
    utm_campaign: 'guides',
    utm_content: slug,
  })
  return `/readiness?${params.toString()}`
}

export { QUIZ_CTA }
