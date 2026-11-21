/**
 * Pinned tiles on home, in the style of Apple Health's Summary: each tile shows
 * one figure from the household's own file, or says plainly that it has no data
 * and what would fill it. Nothing is estimated or invented; every line states
 * what is on file. The tiles themselves are declared per service in services.ts.
 */
import type { FinancialProfile } from './api'
import { SERVICES, tilesFor, runwayMonths as runway, type ServiceDef } from './services'

export interface PinnedTile {
  id: string
  title: string
  /** null = nothing on file yet. */
  value: string | null
  detail: string
  /** What fills an empty tile. */
  emptyHint: string
  href: string
}

export const runwayMonths = runway

export function pinnedTiles(
  profile: FinancialProfile | null,
  services: readonly ServiceDef[] = SERVICES,
): PinnedTile[] {
  return tilesFor(services, { profile, documentCount: 0 })
}
