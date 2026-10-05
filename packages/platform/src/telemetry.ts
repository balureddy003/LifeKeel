/**
 * Observability — OTel spans on every critical path (ADR-0060)
 *
 * Pattern: Instrument before first line of business logic.
 * Every pipeline stage (ingest, detect, skill, action) gets a named span
 * with tenant_id attribute — never log PII in span attributes.
 *
 * Call `initTelemetry()` at startup to bridge to the real OTel SDK.
 * If the SDK isn't configured (no OTEL_EXPORTER_OTLP_ENDPOINT), spans
 * are still created via `@opentelemetry/api` but routed to the NoopTracer
 * inside the API itself — so there's zero overhead in dev mode.
 */

import { trace, SpanStatusCode, type Span as OtelSpan } from '@opentelemetry/api'

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: { code: number; message?: string }): void
  recordException(error: Error): void
  end(): void
}

export interface Tracer {
  startSpan(name: string): Span
}

class OtelSpanAdapter implements Span {
  constructor(private readonly inner: OtelSpan) {}
  setAttribute(key: string, value: string | number | boolean) {
    this.inner.setAttribute(key, value)
    return this
  }
  setStatus(status: { code: number; message?: string }) {
    const otelStatus = status.message
      ? { code: status.code === 2 ? SpanStatusCode.ERROR : SpanStatusCode.OK, message: status.message }
      : { code: status.code === 2 ? SpanStatusCode.ERROR : SpanStatusCode.OK }
    this.inner.setStatus(otelStatus)
    return this
  }
  recordException(error: Error) {
    this.inner.recordException(error)
    return this
  }
  end() { this.inner.end() }
}

class OtelTracerAdapter implements Tracer {
  startSpan(name: string): Span {
    return new OtelSpanAdapter(trace.getTracer('lifekeel').startSpan(name))
  }
}

let _tracer: Tracer = new OtelTracerAdapter()

export function setTracer(tracer: Tracer): void {
  _tracer = tracer
}

export function getTracer(): Tracer {
  return _tracer
}

/**
 * Initialise OpenTelemetry tracing.
 *
 * When `@opentelemetry/sdk-trace-base` is available **and**
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans are exported via OTLP.
 * Otherwise the `@opentelemetry/api` global NoopTracerProvider is used
 * (zero overhead).
 *
 * Call once at server startup before any spans are created.
 */
export async function initTelemetry(serviceName = 'lifekeel-api'): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return // Noop — OTel API's default NoopTracerProvider

  try {
    const { BasicTracerProvider, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base' as string
    ) as {
      BasicTracerProvider: new (opts: { resource: unknown }) => {
        addSpanProcessor(p: unknown): void
        register(): void
      }
      SimpleSpanProcessor: new (exporter: unknown) => unknown
    }
    const { OTLPTraceExporter } = await import(
      '@opentelemetry/exporter-trace-otlp-proto' as string
    ) as {
      OTLPTraceExporter: new (opts: { url: string }) => unknown
    }
    const { Resource } = await import(
      '@opentelemetry/resources' as string
    ) as {
      Resource: new (attrs: Record<string, string>) => unknown
    }

    const resource = new Resource({ 'service.name': serviceName })
    const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
    const provider = new BasicTracerProvider({ resource })
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    provider.register()
  } catch {
    // OTel SDK not installed — fall through to default NoopTracerProvider
  }
}

/** Wrap an async operation in a named OTel span */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = _tracer.startSpan(name)
  for (const [k, v] of Object.entries(attributes)) {
    span.setAttribute(k, v)
  }
  try {
    const result = await fn(span)
    span.setStatus({ code: 1 }) // OK
    return result
  } catch (err) {
    span.setStatus({ code: 2, message: String(err) }) // ERROR
    if (err instanceof Error) span.recordException(err)
    throw err
  } finally {
    span.end()
  }
}
