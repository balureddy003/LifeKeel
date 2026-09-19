import type { Db } from 'mongodb'
import type { Engine } from '@agentoak/engine'
import type { ConnectorLoader, EventGenerator } from '@agentoak/pipeline'
import { queueManager } from './QueueManager.js'
import { persistSignal } from '../signals.js'
import { persistAndDeliverInsights } from '../insights-persist.js'
import type { DeliveryRouter } from '../delivery/delivery-router.js'

export const WEBHOOK_INGEST_QUEUE = 'webhook.ingest'

export interface WebhookIngestJob {
  connectorId: string
  tenantId: string
  payload: Record<string, unknown>
  receivedAt: string
}

export async function enqueueWebhookIngest(job: WebhookIngestJob): Promise<void> {
  await queueManager.publish(WEBHOOK_INGEST_QUEUE, job, { priority: 0 })
}

export function startWebhookWorker(
  engine: Engine,
  connectorLoader: ConnectorLoader,
  eventGenerator: EventGenerator,
  db: Db,
  deliveryRouter?: DeliveryRouter,
): void {
  queueManager.subscribe(WEBHOOK_INGEST_QUEUE, async payload => {
    const job = payload as WebhookIngestJob
    const connector = connectorLoader.get(job.connectorId)
    if (!connector) throw new Error(`Connector not found: ${job.connectorId}`)
    const sourceType = connector.webhooks?.event_type_field
      ? String(job.payload[connector.webhooks.event_type_field] ?? 'unknown')
      : 'webhook.event'
    const canonical = connector.signal_type_map[sourceType] ?? sourceType
    const event = eventGenerator.generateFromWebhook({
      connector,
      tenant_id: job.tenantId,
      payload: job.payload,
      source_event_type: sourceType,
    })
    if (!event) return

    const signalId = await persistSignal({
      id: event.id,
      tenant_id: job.tenantId,
      signal_type: canonical,
      source: job.connectorId,
      external_id: event.id,
      data: event.raw_data,
      received_at: event.received_at,
    }, db)
    const result = await engine.evaluate({
      event_type: canonical,
      tenant_id: job.tenantId,
      event_id: event.id,
      data: event.raw_data,
      derived_from_signals: [signalId],
    })
    if (result.insights.length === 0) return

    await persistAndDeliverInsights(db, result.insights, job.tenantId, deliveryRouter)
  }, { concurrency: 4 })
}
