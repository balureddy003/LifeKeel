/**
 * Words for the trust and security pages (PRD-208). Constants so the
 * advice-rule scan covers them. They describe the product and how to report a
 * problem; they contain no advice and name no provider. Nothing here claims a
 * certificate, test or agreement: those appear only through the claims
 * register, and only while evidenced (apps/api/src/trust/claims.ts).
 */
export const TRUST_TITLE = 'Trust'
export const TRUST_INTRO =
  'What LifeKeel says about how it handles your family’s information, and where each statement can be checked. A statement appears here only while someone is responsible for it and has confirmed it recently.'

export const MONEY_TITLE = 'How LifeKeel makes money'
export const MONEY_TEXT =
  'You can use LifeKeel free. An optional paid plan adds more. LifeKeel does not sell your information and does not earn from the companies it describes.'

export const CLAIMS_TITLE = 'What we state, and the evidence'
export const CLAIMS_EMPTY =
  'Nothing is listed here yet. Statements are added once they have been checked, and removed if they are not kept up to date.'
export const EVIDENCE_LABEL: Record<'page' | 'check' | 'commitment', string> = {
  page: 'Where to see it',
  check: 'How it is checked',
  commitment: 'How it is backed',
}

export const PROCESSORS_TITLE = 'Who processes your documents'
export const BACKUPS_TITLE = 'Deleting your data'
export const BACKUPS_LEAD =
  'Deleting your account erases your data from live systems and gives you a receipt.'

export const SECURITY_TITLE = 'Reporting a security problem'
export const SECURITY_INTRO =
  'If you think you have found a weakness in LifeKeel, please tell us before sharing it publicly. We will read every report.'
export const SECURITY_ASK =
  'Include what you found, how to reproduce it, and how to reach you. Please do not access other people’s data, and do not run tests that could disrupt the service.'
export const SECURITY_NO_CONTACT =
  'A reporting address has not been published yet. Check back soon.'
