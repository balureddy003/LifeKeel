/**
 * Wording for approving someone who asked to join. Approving lets them in to everything on
 * the family list, so the organizer is told that, and who is asking, before they approve.
 */
export const APPROVAL_NOTE =
  'Asked to join with your invite code. If you approve, they can see everything on the family list.'

export function approvalConfirm(name: string, email: string) {
  return {
    title: `Let ${name} in?`,
    message: `${name} (${email}) asked to join with your invite code. If you approve, they will see everything on the family list: the policies, cars, children and dates. Only approve someone you know.`,
    confirmLabel: 'Approve',
  }
}
