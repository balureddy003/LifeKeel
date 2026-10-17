import { createHash, randomUUID } from 'node:crypto'

export type LlmGuardEventType =
  'prompt_injection' | 'pii_redaction' | 'forbidden_output' | 'format_warning'

export interface LlmGuardEvent {
  tenant_id: string
  call_id: string
  type: LlmGuardEventType
  field_path: string
  original_hash: string
  action: string
  timestamp: Date
}

export interface LlmGuardOptions {
  tenantId?: string
  callId?: string
  piiFields?: string[]
  forbiddenPatterns?: RegExp[]
  onEvent?: (event: LlmGuardEvent) => void | Promise<void>
}

export interface GuardResult<T> {
  value: T
  events: LlmGuardEvent[]
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+the\s+above/i,
  /new\s+instructions?/i,
  /\b(system|assistant|user)\s*:/i,
  /pretend\s+you\s+are/i,
  /\bDAN\b/,
  /\[\/?INST\]/i,
  /<\|im_(?:start|end)\|>/i,
  /-{3,}|#{3,}/,
]
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE = /(?<!\w)(?:\+\d{7,15}|\(?\d{3,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4})(?!\w)/g
const CARD = /\b(?:\d[ -]*?){13,19}\b/g
const DEFAULT_PII_FIELDS = ['customer_name', 'contact_name', 'full_name', 'email', 'phone']
const DEFAULT_FORBIDDEN = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bpk_live_[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/g,
]

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

abstract class BaseGuard {
  protected readonly tenantId: string
  protected readonly callId: string
  protected readonly events: LlmGuardEvent[] = []

  constructor(protected readonly options: LlmGuardOptions = {}) {
    this.tenantId = options.tenantId ?? 'unknown'
    this.callId = options.callId ?? randomUUID()
  }

  protected event(
    type: LlmGuardEventType,
    fieldPath: string,
    original: string,
    action: string,
  ): void {
    const event: LlmGuardEvent = {
      tenant_id: this.tenantId,
      call_id: this.callId,
      type,
      field_path: fieldPath,
      original_hash: hash(original),
      action,
      timestamp: new Date(),
    }
    this.events.push(event)
    void this.options.onEvent?.(event)
  }
}

export class LlmInputGuard extends BaseGuard {
  guard<T>(input: T): GuardResult<T> {
    const piiFields = new Set([...(this.options.piiFields ?? []), ...DEFAULT_PII_FIELDS])
    const visit = (value: unknown, path: string): unknown => {
      if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}.${index}`))
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            visit(item, path ? `${path}.${key}` : key),
          ]),
        )
      }
      if (typeof value !== 'string') return value
      if (INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
        this.event('prompt_injection', path, value, 'quarantined')
        return '[FIELD REDACTED: POLICY]'
      }
      const field = path.split('.').at(-1)?.toLowerCase() ?? ''
      if (piiFields.has(field) && value.trim()) {
        this.event('pii_redaction', path, value, 'pseudonymised')
        return `[CONTACT_REF:${hash(value).slice(0, 16)}]`
      }
      return this.redactPatterns(value, path)
    }
    return { value: visit(input, '') as T, events: [...this.events] }
  }

  private redactPatterns(value: string, path: string): string {
    let result = value
      .replace(EMAIL, (match) => {
        this.event('pii_redaction', path, match, 'replaced_email')
        return '[EMAIL]'
      })
      .replace(PHONE, (match) => {
        this.event('pii_redaction', path, match, 'replaced_phone')
        return '[PHONE]'
      })
      .replace(CARD, (match) => {
        if (!luhn(match)) return match
        this.event('pii_redaction', path, match, 'replaced_card')
        return '[CARD]'
      })
    // eslint-disable-next-line no-control-regex
    result = result.replace(/[\u0000-\u001f\u200b-\u200f\ufeff]/g, '')
    return result.slice(0, 4_000)
  }
}

export class LlmOutputGuard extends BaseGuard {
  guard(output: string): GuardResult<string> {
    let value = output
      .replace(EMAIL, (match) => {
        this.event('pii_redaction', 'output', match, 'replaced_email')
        return '[EMAIL]'
      })
      .replace(PHONE, (match) => {
        this.event('pii_redaction', 'output', match, 'replaced_phone')
        return '[PHONE]'
      })
    for (const pattern of [...DEFAULT_FORBIDDEN, ...(this.options.forbiddenPatterns ?? [])]) {
      value = value.replace(pattern, (match) => {
        this.event('forbidden_output', 'output', match, 'redacted')
        return '[REDACTED]'
      })
    }
    if (value.length < 50 || value.length > 500) {
      this.event('format_warning', 'output', value, 'flagged_for_review')
    }
    return { value, events: [...this.events] }
  }
}
