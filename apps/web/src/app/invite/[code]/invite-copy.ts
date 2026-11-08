/** Wording for the page a person reaches from an emailed invite. Never names the family. */
export const inviteIntro = (inviterName: string | null): string =>
  inviterName
    ? `${inviterName} invited you to join their family on LifeKeel.`
    : 'You have been invited to join a family on LifeKeel.'

export const INVITE_BUTTON = 'Join the family'

export const WRONG_PERSON =
  'If you were not expecting this, you can close this page. Nothing happens unless you set a password.'

/** What LifeKeel is, for someone who has not used it. Nothing about this family. */
export const INVITE_WHAT =
  'LifeKeel is a shared list a family keeps: policies, cars, school dates and who to call, so everyone knows where to look.'

export const INVITE_ASK =
  'You are asked to look and confirm you have seen it. An adult who cannot can be excused.'

export const INVITE_PROMISES = [
  'No commissions',
  'Never moves money',
  'Your details are not sold',
] as const
