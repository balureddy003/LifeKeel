import { createHmac, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [keys.map(quote).join(','), ...rows.map(row => keys.map(key => quote(row[key])).join(','))].join('\n')
}

function minimalPdf(lines: string[]): Buffer {
  const text = lines.map((line, index) => `BT /F1 11 Tf 50 ${780 - index * 16} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

export function registerOutcomeRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { id: string } }>('/outcomes/:id/certificate', async (req, reply) => {
    const contract = await db.collection('outcome_contracts').findOne({ tenant_id: req.authContext.tenant_id, id: req.params.id })
    if (!contract || contract['lifecycle'] !== 'achieved') return reply.status(409).send({ error: 'Only achieved outcomes can be certified' })
    const receipts = await db.collection('action_receipts').find({ tenant_id: req.authContext.tenant_id, goal_id: req.params.id }).toArray()
    const payload = { certificate_id: randomUUID(), tenant_id: req.authContext.tenant_id, outcome_id: req.params.id, name: contract['name'], achieved_at: contract['updated_at'], kpis: contract['kpis'], receipt_ids: receipts.map(item => item['id']), generated_at: new Date().toISOString() }
    const signature = createHmac('sha256', process.env['CERTIFICATE_SIGNING_KEY'] ?? process.env['JWT_SECRET'] ?? 'development-only').update(JSON.stringify(payload)).digest('hex')
    await db.collection('outcome_certificates').insertOne({ ...payload, signature })
    const pdf = minimalPdf(['KAIROS OUTCOME CERTIFICATE', `Outcome: ${payload.name}`, `Contract ID: ${payload.outcome_id}`, `Achieved: ${payload.achieved_at}`, `Actions taken: ${receipts.length}`, `Verify: /verify/${payload.certificate_id}`, `Signature: SHA256:${signature}`])
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="outcome-${req.params.id}.pdf"`).send(pdf)
  })

  app.get<{ Params: { id: string } }>('/verify/:id', async (req, reply) => {
    const certificate = await db.collection('outcome_certificates').findOne({ certificate_id: req.params.id }, { projection: { _id: 0 } })
    if (!certificate) return reply.status(404).send({ valid: false })
    const { signature, ...payload } = certificate
    const expected = createHmac('sha256', process.env['CERTIFICATE_SIGNING_KEY'] ?? process.env['JWT_SECRET'] ?? 'development-only').update(JSON.stringify(payload)).digest('hex')
    return { valid: signature === expected, certificate: payload }
  })

  app.get<{ Params: { resource: string }; Querystring: { from?: string; to?: string; format?: string } }>('/export/:resource', async (req, reply) => {
    const allowed: Record<string, string> = { insights: 'insights', goals: 'goals', 'audit-log': 'audit_log' }
    const collection = allowed[req.params.resource]
    if (!collection) return reply.status(404).send({ error: 'Export resource not found' })
    if (req.params.resource === 'audit-log' && !req.authContext.roles.includes('admin')) return reply.status(403).send({ error: 'Admin role required' })
    const filter: Record<string, unknown> = { tenant_id: req.authContext.tenant_id }
    if (req.query.from || req.query.to) filter['created_at'] = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lte: new Date(req.query.to) } : {}) }
    const rows = await db.collection(collection).find(filter, { projection: { _id: 0 } }).limit(10_000).toArray()
    if (req.query.format === 'csv') return reply.header('Content-Type', 'text/csv').send(csv(rows))
    return { rows }
  })
}
