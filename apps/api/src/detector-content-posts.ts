/**
 * Detector-driven content (PRD-202) — one explainer post per chosen
 * detector rule, seeded into the existing blog CMS (`routes/blog.ts`) by
 * a migration (`migrate.ts`). Six of the family vertical's ten rules were
 * chosen as genuinely search-worthy topics, not the full set — timing/
 * state nudges like policy_renewal_window or emergency_fund_overfunded
 * aren't the kind of worried-search question this content targets.
 *
 * `rule_id` here is not part of the persisted blog_posts document (it
 * isn't a BlogPostSchema field) — it exists so the migration and the
 * frontend's rule_id -> slug lookup (apps/web/src/lib/detector-content.ts)
 * stay in sync with the same source list, and so a test can assert every
 * rule_id referenced here still exists in the real detector YAML.
 */

export interface DetectorContentPost {
  slug: string
  title: string
  excerpt: string
  content: string
  category: 'product' | 'tutorial' | 'case-study' | 'news'
  author: string
  tags: string[]
  rule_id: string
}

const QUIZ_CTA_COVERED = `## See your own number
[Take the free 60-second readiness check](/readiness) — it runs this exact calculation on your numbers, with no signup required.`

const QUIZ_CTA_UNCOVERED = `## See what Keel finds for your family
[Take the free 60-second readiness check](/readiness) checks two of Keel's six signals — protection and emergency-fund coverage — free and with no signup. A full profile covers this and more, including retirement and education funding.`

export const DETECTOR_CONTENT_POSTS: DetectorContentPost[] = [
  {
    slug: 'life-insurance-coverage-gap',
    title: 'How Much Life Insurance Do You Actually Need?',
    excerpt: "A simple way to estimate your family's life insurance need — and how to check it against what you have.",
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['life insurance', 'protection'],
    rule_id: 'life_insurance_below_household_needs',
    content: `Life insurance is one of those things almost everyone knows they should have, and almost no one knows how to size correctly. Too little, and a family is left short at the worst possible time. Too much, and you're paying premiums for coverage you'll never use.

## A simple way to estimate the need

A widely used approach — and the one LifeKeel's protection-gap detector checks against — adds up three things a family would have to cover without your income:

- **Outstanding mortgage** — so the family isn't forced to sell or refinance under pressure.
- **Education funding gap** — whatever is still needed to get your children through their planned education, on top of what's already saved.
- **Five years of living expenses** — a runway long enough for a family to adjust, grieve, and rebuild, without being one missed paycheck away from a second crisis.

Add those three together, and you get a reasonable estimate of what your life insurance cover should be. If your current cover is below that number, there's a gap worth knowing about.

## How Keel checks this for your family

Every time you update your financial profile, LifeKeel runs this exact comparison — life cover against mortgage plus education gap plus five years of living expenses — using the numbers you've actually given it, not a generic average household. A family with no life insurance at all isn't treated as an edge case to skip; it's the clearest version of the gap this check exists to catch.

This is an estimate, not advice — everyone's situation is different, and a licensed insurance professional can help you weigh it against your family's specific circumstances.

${QUIZ_CTA_COVERED}`,
  },
  {
    slug: 'income-protection-insurance-explained',
    title: "What Happens to Your Income If You Can't Work?",
    excerpt: 'Employer sick pay usually runs out well before a serious illness or injury does. Here\'s what income protection insurance covers, and how to tell if you have a gap.',
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['income protection', 'insurance', 'protection'],
    rule_id: 'no_income_protection',
    content: `Most people insure their car, their home, and sometimes their life — but not the thing that pays for all three: their own ability to earn an income. Income protection insurance replaces part of your salary if you're unable to work due to illness or injury, for as long as the policy covers.

## Why this gap is easy to miss

If you're employed, it's tempting to assume your employer's sick pay has you covered. In practice, most employer sick-pay policies are generous for the first few weeks and then taper off fast — long before a serious illness or a slow recovery from injury actually resolves. Self-employed households often have even less of a safety net, since there's no employer policy to fall back on at all.

## How Keel checks this for your family

LifeKeel's protection-gap detector looks for two things: does your household have income to protect (employed or self-employed both count), and is there an income protection policy listed with a nonzero monthly benefit? If there's no policy on file and retirement isn't imminent, it flags the gap — and estimates the potential cost using a simple range, 6 to 24 months of your monthly salary, a rough proxy for how long a serious absence from work could realistically last.

This is informational, not advice — a licensed insurance professional can help you find a policy that actually fits your situation and budget.

${QUIZ_CTA_COVERED}`,
  },
  {
    slug: 'emergency-fund-three-months-rule',
    title: 'Why 3-6 Months of Expenses, Specifically?',
    excerpt: 'The most common piece of financial advice in the world, explained — and how to check your own number against it.',
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['emergency fund', 'savings'],
    rule_id: 'emergency_fund_below_3_months',
    content: `If you've ever read anything about personal finance, you've run into some version of this rule: keep 3 to 6 months of essential expenses in an accessible emergency fund. It's repeated so often it can start to sound like a cliché — but the logic behind it is worth understanding, not just following.

## Where the number comes from

Three to six months is roughly how long it takes most people to find a new job after losing one, recover from an unexpected medical event, or get through a major home or car repair without going into debt to do it. Less than three months, and a single bad month can turn into a cascade of missed payments. More than six, and you may be leaving money that could be invested or paying down debt sitting idle instead.

It's a range, not a single number, because the right amount depends on your situation — a two-income household with stable jobs can often sit comfortably at the lower end; a single income, self-employment, or a less predictable job market usually calls for the higher end.

## How Keel checks this for your family

LifeKeel's emergency-fund detector compares your listed emergency savings against your monthly expenses, and flags it when your savings would cover less than three months. It checks the other direction too — an emergency fund well past twelve months, alongside high-interest debt still outstanding, gets flagged as well, since that debt is very likely costing more than the savings are earning.

This is an estimate, not advice — a qualified financial professional can help you decide where in the 3-6 month range makes sense for your household.

${QUIZ_CTA_COVERED}`,
  },
  {
    slug: 'havent-started-retirement-savings',
    title: "You Haven't Started Saving for Retirement Yet — Now What?",
    excerpt: "It's never too late to start, but it is more expensive the longer you wait. Here's why, in plain terms.",
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['retirement', 'pension'],
    rule_id: 'no_retirement_savings',
    content: `If retirement savings feels like something you'll get to eventually, you're far from alone — but the math behind compound growth means "eventually" has a real cost, and it grows every year you wait.

## Why starting age matters so much

Retirement savings grow through compounding: the returns you earn also earn returns, year after year. A given amount saved at 30 has decades longer to compound than the same amount saved at 45 — which is why starting even a modest, regular contribution earlier tends to matter more than starting a larger one later. The earlier you begin, the more of the work is done by growth rather than by the size of your own contributions.

## How Keel checks this for your family

LifeKeel's retirement detector looks at whether any pension or retirement savings are listed at all. If your balance is zero and you're 25 or older, it flags this specifically — not to suggest you're behind in some absolute sense, but because every year without a starting balance is a year of potential compound growth that can't be recovered later. The detector also estimates roughly how many years remain until your target retirement age, since that's the single biggest factor in how much time your savings would have to grow.

This is informational only, not a recommendation — a qualified financial professional can help you find a retirement savings option that fits your country's tax rules and your own budget.

${QUIZ_CTA_UNCOVERED}`,
  },
  {
    slug: 'education-fund-behind-target',
    title: "Is Your Child's Education Fund on Track?",
    excerpt: 'A simple way to tell whether your current savings rate will realistically get you to your target — before the timeline runs out.',
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['education savings', 'children'],
    rule_id: 'education_fund_behind_target',
    content: `Saving for a child's education is a long project with a fixed deadline — university doesn't wait for your savings to catch up. The earlier a shortfall is visible, the more options you have to close it: a higher monthly contribution, a longer time horizon, or an adjusted target.

## A simple way to check

Two things matter here: how much you've saved so far relative to your target, and how many years remain before the money is needed. A fund that's a little behind with ten years left is a very different situation from one that's a little behind with two years left — the same savings gap gets much harder to close as the timeline shrinks, because there's less time for both contributions and growth to make up the difference.

## How Keel checks this for your family

LifeKeel's education-shortfall detector flags a fund when current savings are below half the target amount *and* five years or fewer remain — the combination that means a meaningful shortfall is closing in on tight timing, not just an early-stage fund with plenty of runway left.

This is an estimate, not advice — a qualified financial professional can help you weigh contribution increases, savings vehicles, and timeline adjustments specific to your situation.

${QUIZ_CTA_UNCOVERED}`,
  },
  {
    slug: 'education-fund-not-started',
    title: "Haven't Started an Education Fund Yet? Here's Why Early Matters More Than Big",
    excerpt: 'A small, early contribution often beats a larger one started later — the same compounding logic behind retirement savings, applied to a shorter timeline.',
    category: 'tutorial',
    author: 'LifeKeel Team',
    tags: ['education savings', 'children'],
    rule_id: 'education_fund_not_started',
    content: `Between childcare, everyday costs, and everything else a household budget covers, an education fund is easy to put off — especially when a child is still young and the timeline feels distant. But that distance is exactly what makes starting early valuable.

## Why "small and early" beats "bigger and later"

An education fund has a fixed, known deadline: whenever your child reaches university age. Money contributed early has more years to grow before that deadline arrives, through the same compounding effect that makes early retirement contributions so much more effective than late ones. A modest monthly contribution started when a child is young can end up doing more work than a much larger one started a few years before it's needed — simply because it had more time.

## How Keel checks this for your family

LifeKeel's education-shortfall detector flags a fund with zero savings on file when a child is under 16 and years still remain before the money is needed — specifically because that's the window where starting now, even modestly, has the most time to compound before it matters.

This is informational only, not advice — a qualified financial professional can help you choose a savings vehicle that fits your country's tax rules.

${QUIZ_CTA_UNCOVERED}`,
  },
]
