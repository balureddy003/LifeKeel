/**
 * Account-info sync (PRD-133) — pulls the provider's account list into the
 * tenant-scoped `external_accounts` read model and maintains credential
 * health (last_synced_at / needs_reauth), mirroring the email connector's
 * pattern. Read-only end to end: nothing here writes back to a provider.
 */

import type { Db } from 'mongodb'
import { createLogger, getTenantCollection, decryptIfNeeded } from '@agentoak/platform'
import {
  ProviderAuthError,
  resolveAccountInfoProvider,
  type AccountInfoCredential,
  type ExternalAccount,
} from './providers.js'

const log = createLogger({ service: 'open-banking', version: '0.0.0' })

export interface ExternalAccountDoc extends Record<string, unknown> {
  tenant_id: string
  provider: string
  provider_account_id: string
  display_name: string
  account_type: string
  currency: string
  balance_minor: number
  synced_at: Date
}

export interface AccountSyncResult {
  ok: boolean
  accounts?: number
  needsReauth?: boolean
  error?: string
}

export async function syncAccountInfo(
  db: Db,
  tenantId: string,
  credDoc: Record<string, unknown>,
): Promise<AccountSyncResult> {
  const providerId = credDoc['provider'] as string
  const provider = resolveAccountInfoProvider(providerId)
  if (!provider) return { ok: false, error: `Unknown account-info provider "${providerId}"` }

  const credential: AccountInfoCredential = {
    provider: providerId,
    access_token: credDoc['access_token'] ? decryptIfNeeded(credDoc['access_token'] as string) : undefined,
  }

  let accounts: ExternalAccount[]
  try {
    accounts = await provider.listAccounts(credential)
  } catch (err) {
    if (err instanceof ProviderAuthError) {
      await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
        .updateOne({ connector_id: 'open-banking' }, { $set: { needs_reauth: true } })
      return { ok: false, needsReauth: true, error: err.message }
    }
    log.error({ err, tenantId }, 'Account-info sync failed')
    return { ok: false, error: (err as Error).message }
  }

  const col = getTenantCollection<ExternalAccountDoc>(db, 'external_accounts', tenantId)
  const now = new Date()
  const seen = new Set<string>()
  for (const account of accounts) {
    seen.add(account.provider_account_id)
    await col.updateOne(
      { provider_account_id: account.provider_account_id, provider: providerId },
      {
        $set: {
          tenant_id: tenantId,
          provider: providerId,
          provider_account_id: account.provider_account_id,
          display_name: account.display_name,
          account_type: account.account_type,
          currency: account.currency,
          balance_minor: account.balance_minor,
          synced_at: now,
        },
      },
      { upsert: true },
    )
  }
  // Closed accounts disappear from the provider list — drop their rows so
  // the read model never shows an account that no longer exists.
  await col.deleteMany({ provider: providerId, provider_account_id: { $nin: [...seen] } })

  await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
    .updateOne(
      { connector_id: 'open-banking' },
      { $set: { last_synced_at: now, needs_reauth: false } },
    )

  return { ok: true, accounts: accounts.length }
}
