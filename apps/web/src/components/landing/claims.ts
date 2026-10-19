/**
 * Claims registry for the public landing page (PRD-209).
 *
 * Every capability on the story board points at one claim here. A `live` claim
 * must name a file that implements it; a `planned` claim may only appear on the
 * page with its Planned tag; a `blocked` claim must not appear in the landing
 * copy at all. `claims-registry.test.ts` enforces all three.
 */
export type ClaimStatus = 'live' | 'planned' | 'blocked'

export interface Claim {
  id: string
  /** What the page may say, in plain words. */
  text: string
  status: ClaimStatus
  /** Repo-relative path of the code that makes a live claim true. */
  evidence?: string
  /** True for statements made on the page outside the story board (promises, cover table). */
  page?: boolean
  /** Blocked claims only: wording that must not appear in landing copy. */
  forbidden?: string[]
}

export const CLAIMS: Claim[] = [
  {
    id: 'runway',
    text: 'Savings runway from the figures you enter',
    status: 'live',
    evidence: 'apps/api/src/scenarios/calculate.ts',
  },
  {
    id: 'cover-on-file',
    text: 'Life, income and health cover on file',
    status: 'live',
    evidence: 'detectors/family/protection-gap.yaml',
  },
  {
    id: 'renewals-duplicates',
    text: 'Policy renewals and duplicate policies for the same person',
    status: 'live',
    evidence: 'detectors/family/policy-review.yaml',
  },
  { id: 'partner-overlap', text: 'Overlap between partners’ policies', status: 'planned' },
  {
    id: 'retirement-education',
    text: 'Retirement and education pace',
    status: 'live',
    evidence: 'detectors/family/retirement-gap.yaml',
  },
  { id: 'next-steps', text: 'One ordered list of next steps', status: 'planned' },
  {
    id: 'debt-health',
    text: 'Debt health',
    status: 'live',
    evidence: 'detectors/family/debt-health.yaml',
  },
  {
    id: 'papers-on-file',
    text: 'Wills and papers on file',
    status: 'live',
    evidence: 'detectors/family/estate-readiness.yaml',
  },
  {
    id: 'what-if',
    text: '"What if" runway simulator',
    status: 'live',
    evidence: 'apps/api/src/routes/family-scenarios.ts',
  },
  { id: 'monthly-letter', text: 'Monthly letter about what changed', status: 'planned' },
  {
    id: 'vault',
    text: 'Documents the family’s adults can open',
    status: 'live',
    evidence: 'apps/api/src/routes/vault.ts',
  },
  {
    id: 'bad-day-steps',
    text: 'Steps for seven kinds of bad day',
    status: 'live',
    evidence: 'apps/api/src/life-events/render-playbook.ts',
  },
  {
    id: 'continuity-emails',
    text: 'Emails to people you name if you go quiet',
    status: 'live',
    evidence: 'apps/api/src/routes/family-continuity.ts',
  },
  {
    id: 'named-person-access',
    text: 'Access for a named person outside the family',
    status: 'planned',
  },
  {
    id: 'who-to-call',
    text: 'Who to call, from your policy papers',
    status: 'live',
    evidence: 'apps/api/src/life-events/render-playbook.ts',
  },
  {
    id: 'draft-insurer',
    text: 'Draft message to your own insurer',
    status: 'live',
    evidence: 'apps/api/src/routes/life-events.ts',
  },
  {
    id: 'how-to-claim',
    text: 'Plain how-to-claim guide for each kind of policy',
    status: 'planned',
  },
  { id: 'claim-pack', text: 'Claim-ready pack: policies, contacts, papers', status: 'planned' },
  { id: 'new-life-events', text: 'New checks for new life events', status: 'planned' },

  // Statements made outside the board: the six promises and the cover table.
  {
    id: 'no-commissions',
    text: 'Subscriptions only: no commissions, no ads',
    status: 'live',
    page: true,
    evidence: 'apps/api/src/billing/billing-constants.ts',
  },
  {
    id: 'no-selling',
    text: 'Your details are never sold',
    status: 'live',
    page: true,
    evidence: 'apps/web/src/app/privacy/page.tsx',
  },
  {
    id: 'no-policy-picks',
    text: 'Keel names no insurer, ranks no policy and gives no switching advice',
    status: 'live',
    page: true,
    evidence: 'packages/engine/src/__tests__/advice-rule.test.ts',
  },
  {
    id: 'approval-first',
    text: 'Nothing leaves LifeKeel for you unless you approve it or switched it on',
    status: 'live',
    page: true,
    evidence: 'apps/api/src/__tests__/trust-tier-gate.test.ts',
  },
  {
    id: 'cover-estimate',
    text: 'Cover on file against a rough household estimate',
    status: 'live',
    page: true,
    evidence: 'detectors/family/protection-gap.yaml',
  },
  {
    id: 'plus-reads-policy',
    text: 'Keel Plus reads policy details from an uploaded policy for you to confirm',
    status: 'live',
    page: true,
    evidence: 'apps/api/src/ocr',
  },

  {
    id: 'carer-view',
    text: 'A dedicated view for caring for a parent',
    status: 'planned',
    page: true,
  },

  // Blocked: not true of the shipped product, or held by another PRD. Not for landing copy.
  {
    id: 'no-training',
    text: 'Family data is never used for training',
    status: 'blocked',
    forbidden: [
      'not used for training',
      'never used to train',
      'nothing trains',
      'to train models',
      'to train ai',
    ],
  },
  {
    id: 'sign-in-link',
    text: 'Sign in with an email link, no password',
    status: 'blocked',
    forbidden: ['no password', 'email link', 'magic link'],
  },
  {
    id: 'always-on',
    text: 'Keel is always watching',
    status: 'blocked',
    forbidden: ['always on', 'always-on', 'always watching', 'around the clock', '24/7'],
  },
]
