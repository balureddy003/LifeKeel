import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { IncomingMessage } from 'node:http'

const DEFAULT_DEPRECATED_AT = 'Sat, 06 Jun 2026 00:00:00 GMT'
const DEFAULT_SUNSET_AT = 'Tue, 06 Jun 2028 00:00:00 GMT'
const SUCCESSOR = 'https://docs.lifekeel.ai/api/v1'

export function rewriteVersionedUrl(request: IncomingMessage): string {
  const url = request.url ?? '/'
  if (url === '/v1') return '/'
  return url.startsWith('/v1/') ? url.slice(3) : url
}

export function registerApiVersioning(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!isUnversionedApiRequest(request)) return
    const deprecatedAt = process.env['API_V1_ALIAS_DEPRECATED_AT'] ?? DEFAULT_DEPRECATED_AT
    const sunsetAt = process.env['API_V1_ALIAS_SUNSET_AT'] ?? DEFAULT_SUNSET_AT
    reply.header('Deprecation', deprecatedAt)
    reply.header('Sunset', sunsetAt)
    reply.header('Link', `<${SUCCESSOR}>; rel="successor-version"`)
    if (Date.now() >= new Date(sunsetAt).getTime()) {
      return reply.status(410).send({
        error: 'This unversioned endpoint has been sunset',
        successor: `/v1${request.url}`,
        migration_guide: SUCCESSOR,
      })
    }
  })

  app.get('/openapi.json', async () => ({
    openapi: '3.1.0',
    info: {
      title: 'LifeKeel API',
      version: '1.0.0',
      description: 'Version 1 compatibility contract. New fields are additive within v1.',
    },
    servers: [{ url: '/v1' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: {
      '/events': { post: { summary: 'Ingest event and evaluate detectors', security: [{ bearerAuth: [] }] } },
      '/insights': { get: { summary: 'List tenant insights', security: [{ bearerAuth: [] }] } },
      '/goals': { get: { summary: 'List tenant goals', security: [{ bearerAuth: [] }] } },
      '/search': { get: { summary: 'Search tenant resources', security: [{ bearerAuth: [] }] } },
      '/query': { post: { summary: 'Run a safe natural-language analytics query', security: [{ bearerAuth: [] }] } },
    },
  }))
  app.get('/docs', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>LifeKeel API</title><h1>LifeKeel API v1</h1><p><a href="/v1/openapi.json">OpenAPI 3.1 specification</a></p>'))
}

function isUnversionedApiRequest(request: FastifyRequest): boolean {
  const original = request.raw.url ?? request.url
  if (original.startsWith('/v1/') || original === '/v1') return false
  return !['/health', '/metrics'].some(path => original.startsWith(path))
}
