import { connectorRegistry } from '@lifekeel/workflows'

/**
 * POST /connectors/:id/actions/:action authenticates the tenant but has no human approval, live-trading
 * opt-in or cap check, so it is read-only: only an action the registry defines with method GET may run.
 * Everything else (emails, SMS, refunds, public posts, broker orders, 76 actions across 32 connectors at
 * the time of writing) is a write with external effect and needs an approval flow (CLAUDE.md rule 1).
 *
 * Deny-by-default on purpose. A per-connector deny list misses new write actions, and the executor
 * silently aliases some ids (twitter_x create_tweet -> createPosts), so matching on the id the caller
 * sent is not enough: an id that is not exactly a registry GET action never runs.
 */
export type ConnectorActionClass = 'read' | 'write' | 'unknown'

export function classifyConnectorAction(connectorId: string, actionId: string): ConnectorActionClass {
  const action = connectorRegistry.get(connectorId)?.actions.find((a) => a.id === actionId)
  if (!action) return 'unknown'
  return action.method === 'GET' ? 'read' : 'write'
}
