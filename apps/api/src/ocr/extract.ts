/**
 * OCR processing module — extracts structured data from financial documents.
 *
 * Uses a vision-capable chat model (GPT-4o class) to extract key fields from
 * uploaded documents (insurance policies, pension statements, mortgage
 * letters, etc.). Tries OPENAI_API_KEY first, then falls back to Azure
 * OpenAI (AZURE_OPENAI_*) — the same credentials the rest of the app's LLM
 * calls use via @agentoak/platform's createLlmRouter. That router's LlmFn is
 * text-only (no image content), so it can't be reused directly here; this
 * builds an Azure-pointed OpenAI SDK client the same way llm.ts's callAzure
 * does, but sends vision message content instead of plain text.
 * Falls back gracefully when neither provider is configured — the document
 * is stored with status 'stored' and can be reprocessed later.
 *
 * Future: swap for Google Document AI or AWS Textract for higher-volume
 * pipelines. The interface (extractDocumentFields) stays the same.
 */

import { randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection, isValidAzureEndpoint, isAzureFoundryEndpoint } from '@agentoak/platform'

const log = createLogger({ service: 'ocr', version: '0.0.0' })

interface VisionClientConfig {
  client: import('openai').default
  model: string
  provider: 'openai' | 'azure'
}

/**
 * Resolves a vision-capable OpenAI-compatible client from whichever provider
 * is configured. Mirrors packages/platform/src/llm.ts's callAzure endpoint
 * handling (classic Azure OpenAI vs. AI Foundry's /openai/v1 surface) so a
 * document upload works with the exact same Azure resource the rest of the
 * app already talks to.
 */
async function resolveVisionClient(): Promise<VisionClientConfig | null> {
  const { default: OpenAI } = await import('openai')

  const openaiKey = process.env['OPENAI_API_KEY']
  if (openaiKey) {
    return { client: new OpenAI({ apiKey: openaiKey }), model: 'gpt-4o', provider: 'openai' }
  }

  const azureKey = process.env['AZURE_OPENAI_API_KEY']
  const azureEndpoint = process.env['AZURE_OPENAI_ENDPOINT']
  if (azureKey && azureEndpoint) {
    const normalizedEndpoint = azureEndpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')
    if (!isValidAzureEndpoint(normalizedEndpoint)) {
      log.warn({ azureEndpoint }, 'AZURE_OPENAI_ENDPOINT is set but not a recognized Azure endpoint format')
      return null
    }
    const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o'
    const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-10-21'
    const foundry = isAzureFoundryEndpoint(normalizedEndpoint)
    const baseURL = foundry
      ? `${normalizedEndpoint}/openai/v1`
      : `${normalizedEndpoint}/openai/deployments/${deployment}`
    const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: azureKey,
      baseURL,
      defaultHeaders: { 'api-key': azureKey },
    }
    if (!foundry) {
      clientOpts.defaultQuery = { 'api-version': apiVersion }
    }
    return { client: new OpenAI(clientOpts), model: deployment, provider: 'azure' }
  }

  return null
}

export interface ExtractedField {
  key: string
  value: string
  confidence: number
}

export interface ExtractionResult {
  category: string
  fields: Record<string, string>
  rawText: string
}

const CATEGORY_PROMPT = `You are a financial document analyzer. Analyze the provided document image and extract structured information.

First, classify the document into one of these categories:
- insurance (policy documents, renewal notices, coverage statements)
- pension (pension statements, retirement plan documents)
- mortgage (mortgage statements, rate change notices, refinance offers)
- investment (investment statements, portfolio summaries, trade confirmations)
- tax (tax returns, tax notices, W-2/1099 forms)
- will (will, estate planning documents, trust documents)
- other (anything that doesn't fit above)

Then extract all relevant fields you can identify. Common fields include:
- provider (company name)
- policy_number / account_number
- premium / amount (in the document's currency)
- renewal_date / maturity_date / due_date
- coverage_amount / balance / value
- interest_rate
- beneficiary
- period (e.g. "Q3 2024", "January 2025")

Return ONLY a JSON object with this shape:
{"category":"<category>","fields":{"<key>":"<value>",...},"rawText":"<brief summary of the document>"}

If you cannot read the document clearly, return:
{"category":"other","fields":{},"rawText":"Unable to extract text from document"}`

/**
 * Extract structured fields from a document image or PDF using OpenAI vision.
 *
 * @param fileBuffer - Raw file bytes (image or PDF)
 * @param mimeType - MIME type of the file
 * @param filename - Original filename for logging
 * @returns ExtractionResult with category, fields, and raw text
 */
export async function extractDocumentFields(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const vision = await resolveVisionClient()
  if (!vision) {
    log.warn({ filename }, 'Neither OPENAI_API_KEY nor AZURE_OPENAI_* configured — skipping OCR extraction')
    return {
      category: 'other',
      fields: {},
      rawText: 'OCR not configured — document stored without extraction',
    }
  }

  try {
    const { client, model, provider } = vision
    const base64 = fileBuffer.toString('base64')
    const imageUrl = `data:${mimeType};base64,${base64}`

    log.info({ filename, provider, model }, 'Starting OCR extraction')
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: CATEGORY_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content ?? ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn({ filename, content_length: content.length }, 'No JSON in OCR response')
      return { category: 'other', fields: {}, rawText: content.slice(0, 500) }
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractionResult
    log.info({ filename, category: parsed.category, field_count: Object.keys(parsed.fields).length }, 'OCR extraction complete')
    return parsed
  } catch (err) {
    log.error({ err, filename }, 'OCR extraction failed')
    return {
      category: 'other',
      fields: {},
      rawText: `Extraction error: ${(err as Error).message}`,
    }
  }
}

/**
 * Process a document asynchronously — called after the file is stored.
 * Updates the document record in MongoDB with extraction results.
 */
export async function processDocument(
  db: import('mongodb').Db,
  documentId: string,
  tenantId: string,
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<void> {
  const docId = documentId || randomUUID()
  const documents = getTenantCollection<Record<string, unknown>>(db, 'documents', tenantId)

  try {
    // Update status to processing
    await documents.updateOne(
      { id: docId },
      { $set: { status: 'processing', processing_started_at: new Date() } },
    )

    const result = await extractDocumentFields(fileBuffer, mimeType, filename)

    // Update with extracted data
    await documents.updateOne(
      { id: docId },
      {
        $set: {
          status: 'extracted',
          category: result.category,
          extracted_data: result.fields,
          raw_text: result.rawText,
          processing_completed_at: new Date(),
        },
      },
    )

    log.info({ documentId: docId, category: result.category }, 'Document processed successfully')
  } catch (err) {
    log.error({ err, documentId: docId }, 'Document processing failed')
    await documents.updateOne(
      { id: docId },
      {
        $set: {
          status: 'error',
          error_message: (err as Error).message,
          processing_completed_at: new Date(),
        },
      },
    )
  }
}
