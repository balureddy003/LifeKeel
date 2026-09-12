/**
 * POST /webhooks/:connectorId — receive webhook, verify HMAC signature,
 *                               generate event, run detectors
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine } from '@kairos/engine'
import type { ConnectorLoader, EventGenerator } from '@kairos/pipeline'
import { WebhookSignatureVerifier } from '../middleware/webhook-signature.js'
import { enqueueWebhookIngest } from '../queue/WebhookQueue.js'

export async function registerWebhookRoutes(
  app: FastifyInstance,
  _engine: Engine,
  connectorLoader: ConnectorLoader,
  _eventGenerator: EventGenerator,
  db: Db | null = null,
): Promise<void> {
  const verifier = db ? new WebhookSignatureVerifier(db) : null

  app.post<{ Params: { connectorId: string } }>('/webhooks/:connectorId', async (request, reply) => {
    const { connectorId } = request.params
    const tenant_id = request.authContext?.tenant_id
      ?? (request.headers['x-kairos-tenant-id'] as string | undefined)
      ?? ((request.query as Record<string, string | undefined>)?.['tenant_id'])

    if (!tenant_id) {
      return reply.status(400).send({ error: 'Missing tenant context for webhook' })
    }

    const connector = connectorLoader.get(connectorId)
    if (!connector) {
      return reply.status(404).send({ error: `Connector not found: ${connectorId}` })
    }

    // ── Signature verification ────────────────────────────────────────────────
    // Uses the raw bytes before JSON parsing so HMAC matches what the provider signed.
    if (verifier && connector.webhooks) {
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}))
      try {
        await verifier.verify(request, tenant_id, connectorId, {
          ...(connector.webhooks.signature_header && { signature_header: connector.webhooks.signature_header }),
          ...(connector.webhooks.signature_algorithm && { signature_algorithm: connector.webhooks.signature_algorithm }),
        }, rawBody)
      } catch (err) {
        request.log.warn({ tenant_id, connector_id: connectorId, err: String(err) }, '[webhook] Signature verification failed')
        return reply.status(401).send({ error: `Webhook signature invalid: ${String(err)}` })
      }
    }

    const payload = request.body as Record<string, unknown>
    await enqueueWebhookIngest({
      connectorId,
      tenantId: tenant_id,
      payload,
      receivedAt: new Date().toISOString(),
    })
    return reply.status(200).send({
      status: 'queued',
      connector_id: connectorId,
    })
  })
}
