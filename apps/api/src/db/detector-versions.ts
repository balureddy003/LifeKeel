/**
 * Detector Versions collection management
 * 
 * Provides access to the detector_versions collection with proper indexing
 */

import type { Collection, Db } from 'mongodb'
import type { DetectorVersion } from '@agentoak/engine'

let detectorVersionsCollection: Collection<DetectorVersion> | null = null

export async function getDetectorVersionsCollection(): Promise<Collection<DetectorVersion>> {
  if (detectorVersionsCollection) return detectorVersionsCollection

  // This would normally be initialized in the main server file
  // For now, we'll return a placeholder that should be replaced
  // with the actual MongoDB collection from the server context
  throw new Error('Detector versions collection not initialized. Call this from server context with db.')
}

// Alternative: initialize from db parameter
export function initDetectorVersionsCollection(db: Db): Collection<DetectorVersion> {
  const collection = db.collection<DetectorVersion>('detector_versions')

  // Create indexes
  collection.createIndex({ tenant_id: 1, detector_id: 1, version_number: -1 })
  collection.createIndex({ detector_id: 1, created_at: -1 })
  collection.createIndex({ changed_by: 1, created_at: -1 })

  detectorVersionsCollection = collection
  return collection
}
