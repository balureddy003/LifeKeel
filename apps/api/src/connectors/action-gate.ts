/**
 * Connector actions that move money or change a brokerage account and therefore must not be
 * reachable from POST /connectors/:id/actions/:action (CLAUDE.md rule 1: no autonomous execution of
 * a financial action without an explicit approval gate).
 *
 * The route authenticates the tenant but does not check live-trading opt-in, caps or a human
 * confirmation; those belong to the dedicated trade path. Until a write action is routed through an
 * approval gate it is refused here. Add connectors as their write actions are reviewed; a test
 * requires every non-GET trading-212 action in the registry to appear below.
 */
export const GATED_CONNECTOR_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  'trading-212': new Set([
    'place_market_order',
    'place_limit_order',
    'place_stop_order',
    'cancel_order',
    'create_pie',
    'update_pie',
  ]),
}

export function isGatedConnectorAction(connectorId: string, actionId: string): boolean {
  return GATED_CONNECTOR_ACTIONS[connectorId]?.has(actionId) ?? false
}
