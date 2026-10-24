import { z } from 'zod'

// ─── Raw Event (output of every connector) ────────────────────────────────────

export const RawEventSchema = z.object({
  id: z.string(),
  tenant_id: z.string(), // always from auth — never from connector data
  connector_id: z.string(),
  event_type: z.string(), // canonical type after mapping
  source_event_type: z.string(), // original type from provider
  raw_data: z.record(z.string(), z.unknown()),
  event_hash: z.string(), // SHA-256 dedup key
  received_at: z.date().default(() => new Date()),
  processed: z.boolean().default(false),
})
export type RawEvent = z.infer<typeof RawEventSchema>

// ─── Connector YAML Definition ────────────────────────────────────────────────

export const FieldMappingSchema = z.object({
  source_field: z.string(),
  target_field: z.string(),
  transform: z
    .enum(['to_minor_units', 'to_string', 'to_number', 'to_boolean', 'iso_date', 'to_lowercase'])
    .optional(),
})

export const SignalTypeMapSchema = z.record(z.string(), z.string()) // provider_type → canonical_type

export const OAuthConfigSchema = z.object({
  authorization_url: z.string(),
  token_url: z.string(),
  scopes: z.array(z.string()),
})

export const ConnectorResourceSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  method: z.enum(['GET', 'POST']).default('GET'),
  pagination: z
    .object({
      type: z.enum(['cursor', 'page', 'offset', 'link']),
      param: z.string().optional(),
      response_key: z.string().optional(),
    })
    .optional(),
  params: z.record(z.string(), z.string()).optional(),
  event_type_field: z.string().optional(), // which field tells us the event type
  date_filter_param: z.string().nullable().optional(), // query param for incremental date filter (e.g. "DateFrom")
  page_size_param: z.string().optional(), // query param for page size (e.g. "pageSize")
  page_size: z.number().int().optional(), // number of records per page (default: 100)
  response_shape: z.enum(['list', 'object']).default('list'), // whether the API returns an array or a single object
})

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  status: z.enum(['planned', 'beta', 'ga']).default('planned'),
  category: z.enum([
    'payments',
    'accounting',
    'ecommerce',
    'crm',
    'marketing',
    'analytics',
    'cloud_storage',
    'finance',
    'property',
    'social_media',
    'generic',
  ]),
  base_url: z.string(),
  live_base_url: z.string().optional(),
  auth: z.object({
    type: z.enum([
      'oauth2',
      'api_key',
      'bearer',
      'basic',
      'http_basic',
      'oauth2_aisp',
      'partner_feed',
      'multi_oauth',
      'bot_token',
      'none',
    ]),
    oauth: OAuthConfigSchema.optional(),
    header: z.string().optional(), // e.g. "Authorization"
    prefix: z.string().optional(), // e.g. "Bearer"
    param: z.string().optional(), // query param name for api_key auth (e.g. "apikey")
    notes: z.string().optional(),
  }),
  resources: z.array(ConnectorResourceSchema).optional(),
  webhooks: z
    .object({
      path: z.string(),
      signature_header: z.string().optional(),
      signature_algorithm: z.enum(['hmac-sha256', 'hmac-sha1']).optional(),
      event_type_field: z.string(), // JSON path to event type in webhook body
    })
    .optional(),
  signal_types: z.array(z.string()), // canonical event types this connector emits
  signal_type_map: SignalTypeMapSchema.default({}), // provider_type → canonical_type (optional for cloud storage)
  field_mappings: z.array(FieldMappingSchema).default([]),
  // Cloud storage specific
  download_url_template: z.string().nullable().optional(), // URL template for file download
  // Multi-country support — ISO 3166-1 alpha-2 country codes where this
  // connector is available. Empty array (default) means global.
  supported_countries: z.array(z.string()).default([]),
})
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>
