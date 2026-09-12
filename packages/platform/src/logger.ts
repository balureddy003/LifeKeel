export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  service: string
  version: string
  trace_id?: string
  span_id?: string
  tenant_id?: string
  request_id?: string
  event_id?: string
  workflow_id?: string
  workflow_run_id?: string
  detector_id?: string
  goal_id?: string
}

export interface StructuredLogger {
  trace(fields: Record<string, unknown>, message: string): void
  debug(fields: Record<string, unknown>, message: string): void
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
  child(fields: Partial<LogContext>): StructuredLogger
}

export function createLogger(context: LogContext): StructuredLogger {
  const write = (level: LogLevel, fields: Record<string, unknown>, message: string): void => {
    const record = {
      level,
      time: Date.now(),
      ...context,
      ...fields,
      message,
    }
    const line = JSON.stringify(record, (_key, value) =>
      value instanceof Error
        ? { message: value.message, stack: value.stack, ...(value.cause ? { cause: String(value.cause) } : {}) }
        : value)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    trace: (fields, message) => write('trace', fields, message),
    debug: (fields, message) => write('debug', fields, message),
    info: (fields, message) => write('info', fields, message),
    warn: (fields, message) => write('warn', fields, message),
    error: (fields, message) => write('error', fields, message),
    child: fields => createLogger({ ...context, ...fields }),
  }
}
