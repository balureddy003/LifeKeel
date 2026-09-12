/**
 * Signal Enrichment Pipeline
 * 
 * Enriches signals with additional data such as geolocation, entity extraction, etc.
 */

export interface EnrichmentConfig {
  enable_geolocation?: boolean
  enable_entity_extraction?: boolean
  enable_timezone_normalization?: boolean
}

export interface EnrichedSignal {
  original: Record<string, unknown>
  enriched: Record<string, unknown>
  enrichment_metadata: {
    geolocation?: { country: string; region: string; city: string }
    entities?: Array<{ type: string; value: string; confidence: number }>
    timezone?: string
    enriched_at: Date
  }
}

export class SignalEnricher {
  private config: EnrichmentConfig

  constructor(config: EnrichmentConfig = {}) {
    this.config = {
      enable_geolocation: true,
      enable_entity_extraction: false, // Disabled by default (requires ML model)
      enable_timezone_normalization: true,
      ...config,
    }
  }

  async enrich(signal: Record<string, unknown>): Promise<EnrichedSignal> {
    const enriched = { ...signal }
    const metadata: EnrichedSignal['enrichment_metadata'] = {
      enriched_at: new Date(),
    }

    // Geolocation enrichment
    if (this.config.enable_geolocation) {
      const geo = await this.extractGeolocation(signal)
      if (geo) {
        enriched['geo_country'] = geo.country
        enriched['geo_region'] = geo.region
        enriched['geo_city'] = geo.city
        metadata.geolocation = geo
      }
    }

    // Entity extraction (placeholder - would require NLP model)
    if (this.config.enable_entity_extraction) {
      const entities = await this.extractEntities(signal)
      if (entities.length > 0) {
        enriched['extracted_entities'] = entities
        metadata.entities = entities
      }
    }

    // Timezone normalization
    if (this.config.enable_timezone_normalization) {
      const timezone = await this.normalizeTimezone(signal)
      if (timezone) {
        enriched['normalized_timezone'] = timezone
        metadata.timezone = timezone
      }
    }

    return {
      original: signal,
      enriched,
      enrichment_metadata: metadata,
    }
  }

  private async extractGeolocation(signal: Record<string, unknown>): Promise<{ country: string; region: string; city: string } | null> {
    // Extract IP address from signal
    const ip = signal['ip_address'] as string | undefined
    if (!ip) return null

    // Placeholder for actual geolocation service (e.g., MaxMind, IPInfo)
    // In production, integrate with a real geolocation API
    return {
      country: 'US',
      region: 'CA',
      city: 'San Francisco',
    }
  }

  private async extractEntities(signal: Record<string, unknown>): Promise<Array<{ type: string; value: string; confidence: number }>> {
    const entities: Array<{ type: string; value: string; confidence: number }> = []

    // Simple rule-based entity extraction (placeholder)
    // In production, use NER model like spaCy or Hugging Face
    for (const [_key, value] of Object.entries(signal)) {
      if (typeof value === 'string') {
        // Email addresses
        if (value.includes('@') && value.includes('.')) {
          entities.push({ type: 'email', value, confidence: 0.9 })
        }
        // URLs
        if (value.startsWith('http://') || value.startsWith('https://')) {
          entities.push({ type: 'url', value, confidence: 0.95 })
        }
        // Phone numbers (simple pattern)
        if (/^\+?[\d\s-()]+$/.test(value) && value.replace(/\D/g, '').length >= 10) {
          entities.push({ type: 'phone', value, confidence: 0.8 })
        }
      }
    }

    return entities
  }

  private async normalizeTimezone(signal: Record<string, unknown>): Promise<string | null> {
    // Extract timestamp from signal
    const timestamp = signal['occurred_at'] as Date | string | undefined
    if (!timestamp) return null

    // Placeholder for timezone normalization
    // In production, use libraries like moment-timezone or luxon
    return 'UTC'
  }
}

// Global enricher instance
let globalEnricher: SignalEnricher | null = null

export function getSignalEnricher(): SignalEnricher {
  if (!globalEnricher) {
    globalEnricher = new SignalEnricher()
  }
  return globalEnricher
}

export function setSignalEnricher(enricher: SignalEnricher): void {
  globalEnricher = enricher
}
