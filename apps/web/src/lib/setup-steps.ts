/**
 * The cards a new household sees under "Add what you have on file". Each is a
 * service entry on the same pattern (title, one line, one action) and each is
 * short: nothing here asks for a long profile or a connected account before the
 * first result. New services add an entry here instead of a one-off section.
 * "Get your first answer" is not repeated: the first door above already is it.
 */
export interface SetupStepDef {
  id: 'policy' | 'upload'
  label: string
  description: string
  href: string
}

export const SETUP_STEPS: SetupStepDef[] = [
  {
    id: 'policy',
    label: 'Add a policy',
    description: 'Life or income cover. One short form, and it checks the numbers as you type',
    href: '/policies/new',
  },
  {
    id: 'upload',
    label: 'Upload a document',
    description: 'Insurance policy, will, or bank statement',
    href: '/upload',
  },
]
