/**
 * Account-information providers (PRD-133) — the read-only half of the
 * Action Network. Open Banking account *data* (balances, account types)
 * arrives through an FCA-registered AISP aggregator; payment initiation is
 * a different regulated scope and is deliberately absent here — no code
 * path in this file can move money.
 *
 * Two providers today:
 *
 *   sandbox    — deterministic demo accounts so the whole pipeline
 *                (credentials → sync → read model) is exercisable without
 *                an aggregator contract. Dev/test only by default;
 *                production requires OPEN_BANKING_SANDBOX=1.
 *   truelayer  — real TrueLayer Data API reads (GET /data/v1/accounts)
 *                against a user-consented access token. The OAuth consent
 *                flow that mints the token is the partnership-dependent
 *                piece; this module consumes the token it produces.
 */

import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'open-banking', version: '0.0.0' })

export type AccountType = 'current' | 'savings' | 'credit' | 'mortgage' | 'investment' | 'other'

export interface ExternalAccount {
  provider_account_id: string
  display_name: string
  account_type: AccountType
  currency: string
  balance_minor: number
}

/** Stored credential shape (decrypted on read — access_token is written
 *  through encryptIfNeeded). */
export interface AccountInfoCredential {
  provider: string
  access_token?: string
}

/** The provider rejected the credential — the user needs to reconnect. */
export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderAuthError'
  }
}

/** The provider is unreachable or returned something unexpected. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}

export interface AccountInfoProvider {
  id: string
  listAccounts(credential: AccountInfoCredential): Promise<ExternalAccount[]>
}

// ── Sandbox ──────────────────────────────────────────────────────────────
// Fixed demo accounts — clearly labeled so nothing downstream can mistake
// them for a real bank connection.

export function sandboxAccountInfoAllowed(): boolean {
  return process.env['OPEN_BANKING_SANDBOX'] === '1' || process.env['NODE_ENV'] !== 'production'
}

const sandboxProvider: AccountInfoProvider = {
  id: 'sandbox',
  async listAccounts(credential) {
    if (credential.access_token === 'reject-me') {
      throw new ProviderAuthError('Sandbox token "reject-me" simulates an expired grant')
    }
    return [
      {
        provider_account_id: 'sandbox-current-1',
        display_name: 'Demo Current Account',
        account_type: 'current',
        currency: 'GBP',
        balance_minor: 245_000,
      },
      {
        provider_account_id: 'sandbox-savings-1',
        display_name: 'Demo Easy Saver',
        account_type: 'savings',
        currency: 'GBP',
        balance_minor: 9_000_00,
      },
      {
        provider_account_id: 'sandbox-credit-1',
        display_name: 'Demo Credit Card',
        account_type: 'credit',
        currency: 'GBP',
        balance_minor: -58_000,
      },
    ]
  },
}

// ── TrueLayer ────────────────────────────────────────────────────────────
// Read-only Data API: GET /data/v1/accounts with the user's access token.
// TRUELAYER_API_BASE exists for sandbox-vs-live switching
// (api.truelayer-sandbox.com vs api.truelayer.com) — defaults to live.

const TRUELAYER_TYPE_MAP: Record<string, AccountType> = {
  current: 'current',
  savings: 'savings',
  credit_card: 'credit',
  mortgage: 'mortgage',
  investment: 'investment',
}

const truelayerProvider: AccountInfoProvider = {
  id: 'truelayer',
  async listAccounts(credential) {
    if (!credential.access_token) {
      throw new ProviderAuthError('A TrueLayer access token is required')
    }
    const base = process.env['TRUELAYER_API_BASE'] ?? 'https://api.truelayer.com'
    let res: Response
    try {
      res = await fetch(`${base}/data/v1/accounts`, {
        headers: { Authorization: `Bearer ${credential.access_token}` },
      })
    } catch (err) {
      throw new ProviderUnavailableError(`TrueLayer unreachable: ${(err as Error).message}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthError('The bank connection was revoked or expired — reconnect to refresh it')
    }
    if (!res.ok) {
      throw new ProviderUnavailableError(`TrueLayer returned ${res.status}`)
    }
    const body = (await res.json()) as {
      results?: Array<{ account_id: string; display_name?: string; account_type?: string; currency?: string }>
    }
    const accounts = (body.results ?? []).map((a) => ({
      provider_account_id: a.account_id,
      display_name: a.display_name ?? 'Bank account',
      account_type: TRUELAYER_TYPE_MAP[a.account_type ?? ''] ?? 'other',
      currency: a.currency ?? 'GBP',
      // /accounts doesn't return balances — a follow-up /balance call per
      // account would. Balance stays 0 until a real AISP onboarding makes
      // that round-trip worth its latency; the account list itself is the
      // plumbing being exercised here.
      balance_minor: 0,
    }))
    log.info({ count: accounts.length }, 'TrueLayer accounts listed')
    return accounts
  },
}

const PROVIDERS: Record<string, AccountInfoProvider> = {
  sandbox: sandboxProvider,
  truelayer: truelayerProvider,
}

export function resolveAccountInfoProvider(id: string): AccountInfoProvider | null {
  return PROVIDERS[id] ?? null
}

/**
 * Whether the family app can offer a working Open Banking connect path at
 * all — sandbox (non-prod / explicit opt-in) or a real aggregator token
 * mode (OPEN_BANKING_TOKENS=1 while the OAuth consent flow is still a
 * partnership todo). Drives the connector's comingSoon flag so the UI never
 * offers a button that can only fail.
 */
export function accountInfoAvailable(): boolean {
  return sandboxAccountInfoAllowed() || process.env['OPEN_BANKING_TOKENS'] === '1'
}
