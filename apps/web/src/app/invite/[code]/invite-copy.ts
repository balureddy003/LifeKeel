/** Wording for the page a person reaches from an emailed invite. Never names the family. */
export const inviteIntro = (inviterName: string | null): string =>
  inviterName
    ? `${inviterName} invited you to join their family on LifeKeel.`
    : 'You have been invited to join a family on LifeKeel.'

export const INVITE_BUTTON = 'Join the family'

export const WRONG_PERSON =
  'If you were not expecting this, you can close this page. Nothing happens unless you set a password.'
