import { test } from '@playwright/test'

/**
 * Placeholder for the passwordless "hold this result" save (growth strategy,
 * intervention I1): reveal → one email field → magic link → the snapshot is
 * claimed by the new account. Skipped until that flow ships; kept here so the
 * device matrix covers it from day one.
 */
test.fixme('saving the anonymous result needs only an email, on every device', async () => {})
