import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { Engine } from '@kairos/engine'
import { registerDetectorCrudRoutes } from '../detectors-crud.js'

const REPO_ROOT = process.cwd()

describe('Detector CRUD routes', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    app = Fastify()
    app.addHook('onRequest', async (request: { authContext: Record<string, unknown> }) => {
      // Source view is not admin-gated, but other routes may be.
      request.authContext = { user_id: 'test-user', tenant_id: 'test-tenant', roles: ['admin'] }
    })
    const engine = new Engine({ detectorsDir: `${REPO_ROOT}/detectors` })
    await registerDetectorCrudRoutes(app, engine)
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns raw YAML source for a detector living in a subdirectory', async () => {
    const res = await app.inject({ method: 'GET', url: '/detectors/trading_price_drop_alert/source' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload) as { id: string; source: string }
    expect(body.id).toBe('trading_price_drop_alert')
    expect(body.source).toContain('id: trading_price_drop_alert')
    expect(body.source).toContain('severe_price_drop')
  })

  it('404s for a detector id that does not exist anywhere in the catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/detectors/nonexistent_detector/source' })
    expect(res.statusCode).toBe(404)
  })
})
