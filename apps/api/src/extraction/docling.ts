/**
 * Docling parsing worker client (intent 97, slice 3) — FLAG-OFF SCAFFOLD.
 *
 * Calls the internal Docling service (infra/docling-service) only when
 * DOCLING_SERVICE_URL is configured. The worker's hosting and cost ceiling
 * are an open owner decision, so the default is off and this module is inert
 * until then. The service is internal/service-network-only — never a
 * consumer endpoint — and receives the document bytes directly; queue
 * payloads still carry only {documentId, tenantId}.
 *
 * Never throws and never logs content: any failure returns null and the
 * caller falls back to the existing local text-layer path. Output is
 * structured text for the job only — it is not persisted anywhere new.
 */
import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'docling-client', version: '0.0.0' })

const TIMEOUT_MS = 120_000 // parsing is CPU-bound; generous but bounded
const TEXT_LIMIT = 12_000 // same cap as the local PDF text path

/**
 * Parsed text via the Docling worker, or null when the flag is off or the
 * worker fails — callers must treat null as "use the existing path".
 */
export async function doclingParseText(data: Buffer, mimeType: string): Promise<string | null> {
  const base = process.env['DOCLING_SERVICE_URL']
  if (!base) return null
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/v1/parse-document`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-document-mime': mimeType,
      },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      log.warn({ status: res.status }, 'Docling worker returned non-OK')
      return null
    }
    const body = (await res.json()) as { text?: unknown }
    if (typeof body.text !== 'string' || !body.text.trim()) return null
    return body.text.trim().slice(0, TEXT_LIMIT)
  } catch (err) {
    log.warn({ err: String(err) }, 'Docling worker unreachable — falling back')
    return null
  }
}
