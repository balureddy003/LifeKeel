/**
 * The cards a new household sees under "Add what you have on file". Each is a
 * service entry on the same pattern (title, one line, one action) and each is
 * short: nothing here asks for a long profile or a connected account before the
 * first result. A new service adds its card in services.ts, not a one-off section.
 * "Get your first answer" is not repeated: the first door above already is it.
 */
import { SERVICES, setupStepsFor, type SetupCardDef } from './services'

export type SetupStepDef = Omit<SetupCardDef, 'done'>

export const SETUP_STEPS: SetupStepDef[] = setupStepsFor(SERVICES, {
  profile: null,
  documentCount: 0,
}).map(({ done: _done, ...def }) => def)
