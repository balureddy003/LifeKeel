/**
 * Evergreen SEO guides — one per detector in detectors/family/*.yaml.
 * Copy is derived from the same heuristics the detectors evaluate (3-6
 * month emergency fund, mortgage + education + 5y living expenses cover,
 * projected-vs-target retirement age, education target vs years left) so
 * what a visitor reads is exactly what Keel later checks for their family.
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
  /** 'detector' explains one check; 'life-stage' shows how several checks
   *  converge on a moment (new baby, first home) — different search intent. */
  kind: 'detector' | 'life-stage'
  /** SEO title + on-page h1 (kept identical so SERP matches the page). */
  title: string
  /** Meta description + index-card blurb. */
  description: string
  tagline: string
  intro: string[]
  sections: GuideSection[]
  faq: GuideFaq[]
}

const QUIZ_CTA = 'Take the free Family Readiness Check — six questions, no signup, and see which of these areas Keel would flag for your household.'

export const GUIDES: Guide[] = [
  {
    slug: 'emergency-fund-how-much',
    kind: 'detector',
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
        heading: 'How Keel checks this',
        paragraphs: [
          'Keel compares your listed emergency savings against your monthly expenses and flags a fund below three months or above twelve alongside high-interest debt — the same arithmetic on this page, run against your actual numbers rather than a worksheet you fill in once.',
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
    kind: 'detector',
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
        heading: 'How Keel checks this',
        paragraphs: [
          'Keel computes the same need estimate — mortgage plus education gap plus five years of living expenses — against the cover in a family\'s profile, and flags when listed cover falls below it, when no income protection is listed, and when a policy renewal window is approaching.',
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
        a: 'Compare quotes from multiple insurers and consider speaking with a licensed insurance broker who can assess the household\'s coverage needs. Product and provider choices are individual — Keel surfaces the gap; licensed professionals advise on filling it.',
      },
    ],
  },
  {
    slug: 'retirement-gap-check',
    kind: 'detector',
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
        heading: 'How Keel checks this',
        paragraphs: [
          'Keel projects the retirement age from the pension balance, contribution rate, and target in a family\'s profile — then flags when the projection lands late, when the required contribution would exceed half of monthly income (the contributions-alone-are-not-enough case), and when no retirement savings are listed at all.',
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
    kind: 'detector',
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
        heading: 'How Keel checks this',
        paragraphs: [
          'For each child in a family\'s profile, Keel compares current education savings against the target and the years remaining — flagging funds below half-target inside five years, and funds not started for children under sixteen, so the runway shrinks visibly rather than silently.',
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
  {
    slug: 'new-baby-financial-checklist',
    kind: 'life-stage',
    title: 'New Baby, New Numbers: The Financial Checklist for New Parents',
    description: 'The first child changes every financial number a household has — emergency fund, protection cover, education savings, and the budget itself. What to check, and why the first months matter.',
    tagline: 'Every check on this site gets bigger the day the baby arrives',
    intro: [
      'A first child is the single largest simultaneous change to a household\'s finances. Expenses rise, income often drops during leave, a new dependent exists for the next eighteen-plus years — and every financial check a family runs changes its answer on the same day.',
      'None of the arithmetic is new. What changes is that the numbers all move at once, which is why the weeks after a birth are when families most often discover a gap that had been quietly fine before.',
    ],
    sections: [
      {
        heading: 'The emergency fund target just moved',
        paragraphs: [
          'Essential expenses rise — childcare, food, the hundred small recurring costs — which means the three-to-six-month fund target computed on the old budget is now understated. A household that was comfortably at four months may find the same balance now covers barely three.',
          'Leave periods matter too: if one income pauses or drops for months, the fund is not just future insurance — it may be carrying the household sooner than expected.',
        ],
      },
      {
        heading: 'A dependent means a protection gap exists now',
        paragraphs: [
          'Before children, a stopped income affects the earners. After, it affects someone who cannot replace it. The standard estimate — mortgage, remaining education costs, roughly five years of living expenses — was theoretical before; now it has a name.',
          'Employer death-in-service benefits and existing cover may close part of the gap automatically — worth checking the actual amounts rather than assuming either way.',
        ],
      },
      {
        heading: 'Eighteen years of runway starts today',
        paragraphs: [
          'An education fund started at birth has the longest possible runway — the case where small monthly contributions outgrow later large ones. Even a token amount establishes the account and the habit while the runway is maximal.',
          'And the practical items: a will naming guardians, updated beneficiaries on existing policies and pensions. The paperwork is tedious and the cost of not doing it is borne by the person this is all for.',
        ],
        bullets: [
          'Recompute the emergency fund on the new budget',
          'Check existing cover against the new dependent',
          'Start the education fund while the runway is longest',
          'Guardianship in a will; beneficiaries on policies and pensions',
        ],
      },
      {
        heading: 'How Keel checks this',
        paragraphs: [
          'Adding a child to an Keel profile re-evaluates all four checks at once — the fund target against new expenses, cover against a household that now includes a dependent, the education runway starting at eighteen years, and the retirement projection under changed contributions. The gaps arrive as a list, not a surprise.',
        ],
      },
    ],
    faq: [
      {
        q: 'What should new parents sort out first financially?',
        a: 'The two time-sensitive items are protection cover (a dependent now relies on the income) and guardianship arrangements in a will. The emergency fund and education savings matter but tolerate slower ramp-up.',
      },
      {
        q: 'How much does a first child change the emergency fund target?',
        a: 'By the increase in monthly essential spending — childcare alone often adds a large recurring cost. Recomputing the three-to-six-month target on the new budget usually moves it meaningfully.',
      },
      {
        q: 'Is it too early to start saving for education at birth?',
        a: 'It is the point of maximum runway — eighteen years of compounding, which is when the small-early-beats-large-late math is strongest. The right vehicle and amount depend on your country and situation; a qualified professional can advise.',
      },
      {
        q: 'Do we need life insurance after a baby?',
        a: 'A new dependent is the classic reason the protection question becomes concrete — the household\'s need estimate (mortgage, education, living costs) now has someone it exists for. Compare quotes from multiple insurers or speak with a licensed broker.',
      },
    ],
  },
  {
    slug: 'first-home-financial-checklist',
    kind: 'life-stage',
    title: 'Buying a First Home: The Financial Checks That Come With the Keys',
    description: 'A mortgage changes the math on everything — the emergency fund, the protection gap, and the monthly budget. What to recheck the day the purchase completes.',
    tagline: 'The mortgage is the visible part; the recheck is the important part',
    intro: [
      'Buying a first home is planned for months — the deposit, the rate, the conveyancing. What gets less attention is the day after: the household now carries the largest debt it has ever had, a new set of essential costs, and a property that must be maintained.',
      'Three checks change their answers the day completion happens. They are the same checks this site covers individually — here is how they interact at this specific moment.',
    ],
    sections: [
      {
        heading: 'The emergency fund, post-deposit',
        paragraphs: [
          'The deposit usually empties the savings the fund was built from — a household can move from a six-month cushion to near zero on completion day, precisely when it takes on a mortgage payment that cannot pause.',
          'Essential expenses change too: mortgage payment, buildings insurance, maintenance, council tax. The three-to-six-month target should be recomputed on the new cost base, not the rental one.',
        ],
      },
      {
        heading: 'The mortgage is now the largest line in the protection estimate',
        paragraphs: [
          'The standard household need — mortgage plus education costs plus five years of living expenses — jumps the moment a mortgage exists. Cover sized for a renting household, or none at all, is a different calculation with a £200,000 balance attached.',
          'Many buyers take out mortgage-linked cover at completion because it is offered then; worth checking what it actually covers — the outstanding balance only, or the household\'s fuller need — and comparing it against standalone options.',
        ],
      },
      {
        heading: 'The budget absorbs a house',
        paragraphs: [
          'Houses generate irregular costs on their own schedule — boilers, roofs, appliances — that renters never saw. A common approach is a separate maintenance sinking fund alongside the emergency fund, so a broken boiler is a maintenance event rather than an emergency.',
          'Retirement contributions sometimes quietly stop in the first months of ownership. Worth a deliberate decision rather than a drift.',
        ],
      },
      {
        heading: 'How Keel checks this',
        paragraphs: [
          'Listing a mortgage and home in an Keel profile re-evaluates the fund target against the new essentials, adds the mortgage balance to the protection estimate, and keeps watching for the renewal and maintenance windows a house introduces — the checks run on the household as it actually is now, not as it was.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much should I keep in savings after buying a house?',
        a: 'Enough to rebuild toward three to six months of the new essential costs — mortgage, insurance, utilities, maintenance. The first months after completion are often the thinnest a household\'s buffer ever gets; rebuilding it deliberately matters more than any target number.',
      },
      {
        q: 'Is mortgage life cover enough?',
        a: 'Mortgage-linked cover typically clears the outstanding loan — the household keeps the house, but the income question remains. Compare what it covers against the fuller estimate (mortgage plus living costs plus dependents) before assuming it is sufficient.',
      },
      {
        q: 'Should I pause retirement contributions to rebuild savings?',
        a: 'That is a real trade-off households make — the cost is years of compounding, the benefit is resilience now. A qualified financial professional can help weigh the order for your numbers; making it a decision rather than a drift is the important part.',
      },
      {
        q: 'What insurance does a new homeowner actually need?',
        a: 'Buildings insurance is usually a mortgage condition. Beyond that — contents, life cover, income protection — the need depends on the household\'s obligations and dependents. Compare multiple quotes and consider a licensed broker for the protection questions.',
      },
    ],
  },
  {
    slug: 'single-income-family-checklist',
    kind: 'life-stage',
    title: 'The Single-Income Family Checklist: When One Paycheck Carries Everything',
    description: 'Why single-earner households need a bigger buffer and a sharper view of protection — the math that changes when there is no second income to fall back on.',
    tagline: 'No second income means no built-in backup plan',
    intro: [
      'In a two-income household, a lost paycheck is a crisis with a partial cushion — the other income keeps arriving. In a single-income household the same event is total: income goes to zero while every expense continues. The financial checks are identical; the margins are not.',
      'Single-earner is sometimes permanent — one parent at home, one carer, one business owner — and sometimes a season, like parental leave or a career break. Either way, the arithmetic below applies for as long as the arrangement does.',
    ],
    sections: [
      {
        heading: 'Six months is the floor, not the ceiling',
        paragraphs: [
          'The three-to-six-month emergency fund guideline scales with income risk — and a single income is the maximum-risk case. Six months of essentials is the defensible floor; households with variable or self-employed income often aim beyond it.',
          'The fund is also the timeline: it is how long the household has to find new income before decisions get forced. More runway means better decisions.',
        ],
      },
      {
        heading: 'Protection is not optional when one income is everything',
        paragraphs: [
          'The need estimate — mortgage, education costs, five years of living expenses — assumes the earner\'s income stops permanently. In a single-income household that scenario has no buffer whatsoever, which makes the cover question sharper than in almost any other arrangement.',
          'Income protection deserves specific attention here: statistically the more likely disruption is the earner alive but unable to work for months — an event the emergency fund alone may not outlast.',
        ],
        bullets: [
          'Emergency fund toward six-plus months of essentials',
          'Life cover against the full household need estimate',
          'Income protection — the unable-to-work case',
          'Legal basics: will, beneficiaries, guardians for dependents',
        ],
      },
      {
        heading: 'What about the non-earning partner?',
        paragraphs: [
          'The contribution a non-earning partner makes — childcare, household management — has a real replacement cost that vanishes into the same single-point-of-failure problem. If that partner became unable to do that work, the household would have to buy it. Some households include this in their protection thinking.',
        ],
      },
      {
        heading: 'How Keel checks this',
        paragraphs: [
          'Keel sees the household\'s actual income structure — a single-income profile automatically weights the fund check toward the higher band, surfaces the protection estimate against listed cover, and keeps the renewal windows watched. The risk profile of one income is read from the data, not assumed.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much should a single-income family keep in emergency savings?',
        a: 'Six months of essential expenses is the common floor — the single income means a job loss is total rather than partial. Variable or self-employed income often justifies more. A financial professional can help size it for your situation.',
      },
      {
        q: 'Is income protection worth it for a single earner?',
        a: 'It addresses the most likely disruption — the earner unable to work for months — which is also the case with no fallback. Whether the cost makes sense is individual; compare quotes and consider a licensed advisor.',
      },
      {
        q: 'Should the non-earning partner be covered too?',
        a: 'Their contribution has a real replacement cost — childcare and household work the family would otherwise pay for. Some households include this in their protection review; a licensed broker can evaluate the household as a whole.',
      },
      {
        q: 'What if the single income is temporary?',
        a: 'The higher margins still apply for the duration — a leave period or career break is exactly when the cushion gets used. Re-run the checks when the second income returns; the targets will relax.',
      },
    ],
  },
  {
    slug: 'retirement-in-your-50s',
    kind: 'life-stage',
    title: 'Retirement Planning in Your Fifties: The Last Decade of Leverage',
    description: 'What the projection-vs-target check looks like when the runway is ten to fifteen years — the contribution math, the honest limits, and the levers that are not contributions.',
    tagline: 'The math gets steeper — and more honest',
    intro: [
      'In your thirties, a retirement gap is a number with decades of runway to close it. In your fifties it is a decision. The projection-versus-target comparison is the same check — what changes is which levers are still strong enough to move it.',
      'The fifties are also when the vague sense of being behind tends to harden into either a plan or an avoidance. Getting the actual projected age — not a feeling, a number — is the step that separates the two.',
    ],
    sections: [
      {
        heading: 'The contribution math at ten to fifteen years',
        paragraphs: [
          'With a decade of runway left, each year of delay costs more than the year before — compounding has less time to work, so more of the pot has to come from contributions directly. The monthly figure that would have closed a gap at forty can be half what the same gap needs at fifty-five.',
          'This is the uncomfortable version of the check, and also the useful one: the projected-versus-target number turns a vague worry into a specific monthly figure that can be weighed against the household\'s actual capacity.',
        ],
      },
      {
        heading: 'When the number exceeds what contributions can do',
        paragraphs: [
          'If the required contribution climbs beyond what the household can carry — Keel flags the case where it would exceed half of monthly income — the honest conclusion is that contributions are not the whole answer. That is not failure; it is a signal to look at the other levers.',
          'Retirement date moves the projection powerfully at this stage: retiring two years later adds contribution years and removes withdrawal years simultaneously — a double effect. Expected spending, other assets, and part-time transitions all move it too.',
        ],
        bullets: [
          'Contribution increase — still works, just costs more per year of gap',
          'Retirement timing — moves both sides of the equation at once',
          'Spending target — a lower target pulls the projected age forward',
          'Other assets — the projection is about the pension, but retirement is about everything',
        ],
      },
      {
        heading: 'The catch-up window',
        paragraphs: [
          'The fifties are often peak-earning years with reduced child-related costs — a genuine catch-up window some households deliberately use. The decision is easier to make when the gap is a specific monthly number rather than an ambient worry.',
        ],
      },
      {
        heading: 'How Keel checks this',
        paragraphs: [
          'Keel projects the retirement age from the listed pension balance, contribution rate, and target age — at this stage of life the output tends to be concrete rather than advisory: a projected age, and the monthly contribution change that would bring it back to target. When that figure exceeds half of income, the finding says so plainly.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is it too late to fix a retirement gap at 55?',
        a: 'Not too late, but the levers shift — contributions cost more per year of gap, and timing, spending, and other assets matter more. The first step is getting the projected age as a number rather than a feeling.',
      },
      {
        q: 'How much extra should I contribute in my fifties?',
        a: 'Whatever the projection says the gap needs — there is no universal percentage that is honest at this stage. A qualified financial advisor can model contribution, timing, and tax-relief interactions for your situation.',
      },
      {
        q: 'Should I work longer or save harder?',
        a: 'Retiring later works on both sides of the equation — more contribution years and fewer withdrawal years — so it is often the strongest single lever. Whether it is available or desirable is personal; the projection makes the trade-off visible in years.',
      },
      {
        q: 'What about pensions from old employers?',
        a: 'Forgotten pots are common — tracing and consolidating them is worth doing before the projection, since missing balances make the gap look worse than it is. Pension-tracing services exist in most countries; a qualified advisor can help.',
      },
    ],
  },
  {
    slug: 'saving-for-university-countdown',
    kind: 'life-stage',
    title: 'The University Costs Countdown: Saving When the Deadline Is a Person',
    description: 'Education saving has a fixed deadline — the child turns eighteen on schedule. How to read the runway, what behind-pace looks like in real numbers, and when the window gets tight.',
    tagline: 'Most savings goals can slip; this one has a birthday',
    intro: [
      'A retirement can move; a house purchase can wait. Education saving is unusual because the deadline is fixed — the child\'s eighteenth birthday arrives on schedule regardless of the fund\'s balance. That makes the check unusually readable: progress is simply current savings against target, weighed against years left.',
      'The same balance means opposite things at different runways — half-funded with fifteen years left is comfortable; half-funded with five is urgent. This is the countdown logic.',
    ],
    sections: [
      {
        heading: 'Reading the runway',
        paragraphs: [
          'Divide current savings by the target cost — that percentage only means something against the years remaining. Keel\'s check flags the sharp case: below half the target inside five years, when the monthly contribution needed to close it climbs steeply.',
          'The useful output is not the percentage but the monthly figure — the contribution that closes the gap in the time left. A specific number can be planned around; a shortfall percentage cannot.',
        ],
      },
      {
        heading: 'Starting from zero at different ages',
        paragraphs: [
          'Zero saved at age two is a plan waiting to start — sixteen years of compounding ahead. Zero at age twelve is a different problem: six years left means most of the funding has to come from contributions, not growth.',
          'The math is the same either way; what the runway changes is how much of the work the contributions have to do themselves.',
        ],
      },
      {
        heading: 'When the fund cannot get there',
        paragraphs: [
          'A fund that projects short of target is information, not failure — education funding has levers other goals lack: the target itself can adjust (local versus away, covered versus shared), and loans, scholarships, and part-time work all exist on the student\'s side too.',
          'The order most guidance suggests: the child\'s education has alternatives; the parents\' retirement does not. Funding education at the expense of retirement is a trade worth making deliberately rather than by default.',
        ],
      },
      {
        heading: 'How Keel checks this',
        paragraphs: [
          'For each child listed in a profile, Keel tracks savings against target and years remaining — flagging a fund below half-target inside the five-year window, and a fund not started for a child under sixteen, so the countdown is tracked rather than remembered annually.',
        ],
      },
    ],
    faq: [
      {
        q: 'How much do I need saved by the time my child is 18?',
        a: 'Work backward from the expected cost — tuition, living costs, years of study — then let the runway tell you the monthly figure. A qualified financial advisor can help set a realistic target for your plans and country.',
      },
      {
        q: 'My child is 13 and we have saved nothing — is it too late?',
        a: 'Not too late, but different — five years of runway means contributions do nearly all the work with little compounding. The monthly figure may be higher than expected; knowing it early is still better than finding it at eighteen.',
      },
      {
        q: 'Should education saving come before retirement?',
        a: 'Most guidance says no — education has loans, scholarships, and flexibility that retirement lacks. Funding a child\'s education at the cost of an unfunded retirement shifts the burden rather than removing it.',
      },
      {
        q: 'What accounts exist for education savings?',
        a: 'Most countries offer tax-advantaged education vehicles — the specifics differ by jurisdiction and change over time. Research what applies where you live, or ask a qualified financial professional.',
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
