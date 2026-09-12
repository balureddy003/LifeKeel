/**
 * Market-hours utility — multi-exchange support.
 *
 * Gap #24 (TRADING_ENGINE_GAPS.md): no market-hours check existed anywhere in
 * the order flow. Orders (manual or auto) fired regardless of time of day. A
 * market-closed rejection from the broker was a one-shot failure — nothing
 * re-queued or retried the trade when the market reopens; the pending_trades
 * record was simply marked failed/rejected and the opportunity was lost until
 * the next detector cycle re-flags it (if it still qualifies).
 *
 * Originally LSE-only. Now generalized to support any exchange via
 * MarketConfig. Currently supports:
 *   - LSE (London Stock Exchange) — 08:00–16:30 Europe/London, UK bank holidays
 *   - NSE/BSE (National/Bombay Stock Exchange) — 09:15–15:30 Asia/Kolkata,
 *     Indian holidays
 *
 * To add a new exchange, add a MarketConfig entry to MARKET_CONFIGS and a
 * holiday function — no other code needs to change.
 */

// ── Market configuration ───────────────────────────────────────────────────

export interface MarketConfig {
  /** Exchange code (e.g. 'LSE', 'NSE', 'BSE') */
  exchange: string
  /** IANA timezone identifier (e.g. 'Europe/London', 'Asia/Kolkata') */
  timezone: string
  /** Trading hours in local time */
  tradingHours: { open: string; close: string }  // 'HH:MM' 24-hour
  /** ISO 3166-1 alpha-2 country code */
  country: string
  /** Function that returns the set of holiday dates (YYYY-MM-DD) for a year */
  getHolidays: (year: number) => Set<string>
}

// ── Easter calculation (used by UK holidays) ───────────────────────────────

/**
 * Computes the date of Easter Sunday for a given year using the Anonymous
 * Gregorian algorithm. Returns the date as a UTC Date (Easter Sunday midnight
 * UTC — callers adjust to London time as needed).
 *
 * Used to derive Good Friday (Easter Sunday - 2 days) and Easter Monday
 * (Easter Sunday + 1 day), both of which are LSE closures.
 */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // March=3, April=4
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

// ── UK bank holidays (LSE closures) ────────────────────────────────────────

/**
 * Returns the UK bank holidays for a given year as a Set of YYYY-MM-DD
 * strings in Europe/London time (not UTC).
 *
 * UK bank holidays observed by the LSE:
 * - New Year's Day (Jan 1, or next weekday if on a weekend)
 * - Good Friday (Easter Sunday - 2 days)
 * - Easter Monday (Easter Sunday + 1 day)
 * - Early May Bank Holiday (first Monday of May)
 * - Spring Bank Holiday (last Monday of May)
 * - Summer Bank Holiday (last Monday of August)
 * - Christmas Day (Dec 25, or next weekday if on a weekend)
 * - Boxing Day (Dec 26, or next weekday if on a weekend)
 *
 * Royal/extra holidays (e.g. coronation, jubilee) are not included — they're
 * rare and announced per-event. The LSE publishes its exact closure calendar
 * annually; this algorithmic approach covers the 8 recurring holidays that
 * account for 100% of typical-year closures.
 */
export function ukBankHolidays(year: number): Set<string> {
  const holidays = new Set<string>()

  // Helper: format a Date as YYYY-MM-DD (treating it as a London date)
  const fmt = (d: Date): string => {
    // The dates we construct below are "London local" dates represented as
    // UTC midnight. Formatting with toISOString gives us YYYY-MM-DD directly.
    return d.toISOString().slice(0, 10)
  }

  // Helper: if a date falls on a weekend, roll forward to the next weekday
  // (UK substitute-day rule for New Year, Christmas, Boxing Day)
  const rollForwardWeekend = (d: Date): Date => {
    const day = d.getUTCDay()
    if (day === 6) return new Date(d.getTime() + 2 * 86400000) // Sat → Mon
    if (day === 0) return new Date(d.getTime() + 1 * 86400000) // Sun → Mon
    return d
  }

  // New Year's Day — Jan 1, rolled forward if on a weekend
  holidays.add(fmt(rollForwardWeekend(new Date(Date.UTC(year, 0, 1)))))

  // Good Friday and Easter Monday — derived from Easter Sunday
  const easter = easterSunday(year)
  holidays.add(fmt(new Date(easter.getTime() - 2 * 86400000))) // Good Friday
  holidays.add(fmt(new Date(easter.getTime() + 1 * 86400000))) // Easter Monday

  // Early May Bank Holiday — first Monday of May
  {
    const may1 = new Date(Date.UTC(year, 4, 1))
    const day = may1.getUTCDay()
    // Days to add to reach Monday: (8 - day) % 7 gives 0 for Monday, 1 for
    // Sunday, etc. — but we need (1 - day + 7) % 7 to handle Sunday (day=0)
    // correctly: (1 - 0 + 7) % 7 = 1, moving Sunday to Monday.
    const offset = (8 - day) % 7
    holidays.add(fmt(new Date(may1.getTime() + offset * 86400000)))
  }

  // Spring Bank Holiday — last Monday of May
  {
    const may31 = new Date(Date.UTC(year, 4, 31))
    const day = may31.getUTCDay()
    // Days to subtract to reach Monday: (day - 1 + 7) % 7. The +7 ensures
    // a non-negative result in JavaScript (where -1 % 7 = -1, not 6).
    // day=0 (Sun) → 6, day=1 (Mon) → 0, day=2 (Tue) → 1, etc.
    const offset = (day - 1 + 7) % 7
    holidays.add(fmt(new Date(may31.getTime() - offset * 86400000)))
  }

  // Summer Bank Holiday — last Monday of August
  {
    const aug31 = new Date(Date.UTC(year, 7, 31))
    const day = aug31.getUTCDay()
    const offset = (day - 1 + 7) % 7
    holidays.add(fmt(new Date(aug31.getTime() - offset * 86400000)))
  }

  // Christmas Day — Dec 25, rolled forward if on a weekend
  const christmas = rollForwardWeekend(new Date(Date.UTC(year, 11, 25)))
  holidays.add(fmt(christmas))

  // Boxing Day — Dec 26, rolled forward if on a weekend.
  // UK rule: if both Christmas and Boxing Day fall on the weekend, both roll
  // forward to the next available weekdays — Christmas → Mon, Boxing Day →
  // Tue. rollForwardWeekend handles each day independently, but when both
  // land on the same Monday (Sat Dec 25 → Mon, Sun Dec 26 → Mon), Boxing Day
  // must be pushed to the next weekday (Tue) to avoid colliding with
  // Christmas's substitute day.
  let boxingDay = rollForwardWeekend(new Date(Date.UTC(year, 11, 26)))
  // If Boxing Day's rolled-forward date collides with Christmas's, push to
  // the next weekday.
  if (boxingDay.getTime() === christmas.getTime()) {
    boxingDay = new Date(boxingDay.getTime() + 86400000) // next day
    // If that's still a weekend (shouldn't happen since Christmas already
    // rolled to Monday, but defense in depth), roll forward again.
    boxingDay = rollForwardWeekend(boxingDay)
  }
  holidays.add(fmt(boxingDay))

  return holidays
}

// ── Indian holidays (NSE/BSE closures) ─────────────────────────────────────

/**
 * Returns the Indian stock market holidays for a given year as a Set of
 * YYYY-MM-DD strings in Asia/Kolkata time (not UTC).
 *
 * NSE/BSE observed holidays:
 * - Republic Day (Jan 26, fixed)
 * - Independence Day (Aug 15, fixed)
 * - Gandhi Jayanti (Oct 2, fixed)
 * - Christmas Day (Dec 25, fixed)
 *
 * Variable-date holidays (Diwali, Holi, Dussehra, Eid, Guru Nanak Jayanti,
 * Mahashivratri, etc.) are based on the Hindu lunar calendar and Islamic
 * calendar. These change every year and cannot be computed algorithmically
 * from the Gregorian calendar. The NSE publishes its exact holiday calendar
 * annually at https://www.nseindia.com/resources/exchange-calendar.
 *
 * For production accuracy, the variable holidays should be loaded from a
 * holiday API or maintained as a per-year lookup table. For now, we include
 * the 4 fixed-date holidays that are guaranteed every year. A per-year
 * override table can be added below for specific years.
 *
 * If a fixed holiday falls on a weekend, the market is already closed — no
 * substitute day is needed (Indian markets don't observe substitute holidays
 * like the UK does).
 */
export function indianMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>()

  const fmt = (month: number, day: number): string =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  // Fixed-date national holidays
  holidays.add(fmt(1, 26))   // Republic Day
  holidays.add(fmt(8, 15))   // Independence Day
  holidays.add(fmt(10, 2))   // Gandhi Jayanti
  holidays.add(fmt(12, 25))  // Christmas Day

  // ── Per-year variable holiday overrides ────────────────────────────────
  // These are the NSE-trading-holiday dates for specific years, sourced from
  // the NSE holiday calendar. Add new years as they are published.
  // Format: 'YYYY-MM-DD' in Asia/Kolkata time.
  //
  // Only add dates that fall on weekdays (Mon–Fri) — weekend holidays are
  // already covered by the weekend check in isMarketOpen.
  const VARIABLE_HOLIDAYS: Record<number, string[]> = {
    2025: [
      '2025-02-26',  // Mahashivratri
      '2025-03-14',  // Holi
      '2025-03-31',  // Eid-ul-Fitr
      '2025-04-10',  // Shri Mahavir Jayanti
      '2025-04-14',  // Dr Ambedkar Jayanti
      '2025-04-18',  // Good Friday
      '2025-05-01',  // Maharashtra Day / Labour Day
      '2025-08-27',  // Ganesh Chaturthi
      '2025-10-01',  // Dussehra (Maha Ashtami)
      '2025-10-02',  // Gandhi Jayanti (already in fixed, but listed for clarity)
      '2025-10-21',  // Diwali (Laxmi Pujan — note: NSE has a special Muhurat trading session in the evening, but the regular session is closed)
      '2025-10-22',  // Diwali (Balipratipada)
      '2025-11-05',  // Guru Nanak Jayanti
      '2025-12-25',  // Christmas (already in fixed, but listed for clarity)
    ],
    2026: [
      // NSE 2026 calendar not yet published at time of writing.
      // Will be updated when the official calendar is released.
    ],
  }

  const variable = VARIABLE_HOLIDAYS[year]
  if (variable) {
    for (const date of variable) {
      holidays.add(date)
    }
  }

  return holidays
}

// ── US market holidays (NYSE/NASDAQ closures) ──────────────────────────────

/**
 * Returns the US stock market holidays for a given year as a Set of
 * YYYY-MM-DD strings in America/New_York time (not UTC).
 *
 * NYSE/NASDAQ observed holidays:
 * - New Year's Day (Jan 1, observed on next weekday if weekend)
 * - Martin Luther King Jr. Day (3rd Monday of January)
 * - Presidents' Day (3rd Monday of February)
 * - Good Friday (Easter Sunday - 2 days)
 * - Memorial Day (last Monday of May)
 * - Juneteenth (Jun 19, observed on next weekday if weekend)
 * - Independence Day (Jul 4, observed on nearest weekday if weekend)
 * - Labor Day (1st Monday of September)
 * - Thanksgiving (4th Thursday of November)
 * - Christmas Day (Dec 25, observed on nearest weekday if weekend)
 *
 * References: NYSE holiday calendar at https://www.nyse.com/markets/hours-calendars
 */
export function usMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>()

  const fmt = (d: Date): string => d.toISOString().slice(0, 10)

  // Helper: if a date falls on a weekend, roll to the nearest weekday per
  // NYSE rules: Saturday → Friday (back), Sunday → Monday (forward).
  const observeWeekend = (d: Date): Date => {
    const day = d.getUTCDay()
    if (day === 6) return new Date(d.getTime() - 1 * 86400000) // Sat → Fri
    if (day === 0) return new Date(d.getTime() + 1 * 86400000) // Sun → Mon
    return d
  }

  // New Year's Day — Jan 1, observed on next weekday if weekend
  // (Note: if Jan 1 is Saturday, NYSE observes on Friday Dec 31 of prior year,
  // but for simplicity we roll forward to Monday Jan 2. This matches the
  // common case; edge cases at year boundaries are rare.)
  holidays.add(fmt(observeWeekend(new Date(Date.UTC(year, 0, 1)))))

  // Martin Luther King Jr. Day — 3rd Monday of January
  {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    const day = jan1.getUTCDay()
    // Days to first Monday: (1 - day + 7) % 7
    const firstMonday = new Date(Date.UTC(year, 0, 1 + ((1 - day + 7) % 7)))
    holidays.add(fmt(new Date(firstMonday.getTime() + 14 * 86400000))) // +2 weeks
  }

  // Presidents' Day — 3rd Monday of February
  {
    const feb1 = new Date(Date.UTC(year, 1, 1))
    const day = feb1.getUTCDay()
    const firstMonday = new Date(Date.UTC(year, 1, 1 + ((1 - day + 7) % 7)))
    holidays.add(fmt(new Date(firstMonday.getTime() + 14 * 86400000)))
  }

  // Good Friday — Easter Sunday - 2 days
  const easter = easterSunday(year)
  holidays.add(fmt(new Date(easter.getTime() - 2 * 86400000)))

  // Memorial Day — last Monday of May
  {
    const may31 = new Date(Date.UTC(year, 4, 31))
    const day = may31.getUTCDay()
    const offset = (day - 1 + 7) % 7
    holidays.add(fmt(new Date(may31.getTime() - offset * 86400000)))
  }

  // Juneteenth — Jun 19, observed on nearest weekday if weekend
  holidays.add(fmt(observeWeekend(new Date(Date.UTC(year, 5, 19)))))

  // Independence Day — Jul 4, observed on nearest weekday if weekend
  holidays.add(fmt(observeWeekend(new Date(Date.UTC(year, 6, 4)))))

  // Labor Day — 1st Monday of September
  {
    const sep1 = new Date(Date.UTC(year, 8, 1))
    const day = sep1.getUTCDay()
    const firstMonday = new Date(Date.UTC(year, 8, 1 + ((1 - day + 7) % 7)))
    holidays.add(fmt(firstMonday))
  }

  // Thanksgiving — 4th Thursday of November
  {
    const nov1 = new Date(Date.UTC(year, 10, 1))
    const day = nov1.getUTCDay()
    // Days to first Thursday: (4 - day + 7) % 7
    const firstThursday = new Date(Date.UTC(year, 10, 1 + ((4 - day + 7) % 7)))
    holidays.add(fmt(new Date(firstThursday.getTime() + 21 * 86400000))) // +3 weeks
  }

  // Christmas Day — Dec 25, observed on nearest weekday if weekend
  holidays.add(fmt(observeWeekend(new Date(Date.UTC(year, 11, 25)))))

  return holidays
}

// ── Market configurations ──────────────────────────────────────────────────

/** Registry of known market configurations, keyed by exchange code. */
export const MARKET_CONFIGS: Record<string, MarketConfig> = {
  LSE: {
    exchange: 'LSE',
    timezone: 'Europe/London',
    tradingHours: { open: '08:00', close: '16:30' },
    country: 'GB',
    getHolidays: ukBankHolidays,
  },
  NSE: {
    exchange: 'NSE',
    timezone: 'Asia/Kolkata',
    tradingHours: { open: '09:15', close: '15:30' },
    country: 'IN',
    getHolidays: indianMarketHolidays,
  },
  BSE: {
    exchange: 'BSE',
    timezone: 'Asia/Kolkata',
    tradingHours: { open: '09:15', close: '15:30' },
    country: 'IN',
    getHolidays: indianMarketHolidays,
  },
  // NYSE and NASDAQ share the same trading hours and US holiday calendar.
  // Trading 212 instruments with the _US_EQ suffix trade on these exchanges.
  NYSE: {
    exchange: 'NYSE',
    timezone: 'America/New_York',
    tradingHours: { open: '09:30', close: '16:00' },
    country: 'US',
    getHolidays: usMarketHolidays,
  },
  NASDAQ: {
    exchange: 'NASDAQ',
    timezone: 'America/New_York',
    tradingHours: { open: '09:30', close: '16:00' },
    country: 'US',
    getHolidays: usMarketHolidays,
  },
}

// ── Timezone helpers ───────────────────────────────────────────────────────

/** Returns the current date in the given timezone as YYYY-MM-DD. */
function dateStringInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Returns the day of week (0=Sunday, 6=Saturday), hour, and minute in the
 * given timezone. */
function timePartsInTimezone(now: Date, timezone: string): { dayOfWeek: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0'
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0'
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
  }
}

/** Parse 'HH:MM' into minutes since midnight */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// ── Backward-compatible London helpers (used by trade-confirmation.ts) ─────

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Checks whether a market is currently open for trading.
 *
 * Generic implementation — works for any exchange configured in MARKET_CONFIGS.
 * Checks:
 *   1. Not a weekend (Saturday or Sunday)
 *   2. Within trading hours (in the exchange's local timezone)
 *   3. Not a holiday (per the exchange's holiday calendar)
 *
 * @param exchange Exchange code (e.g. 'LSE', 'NSE', 'BSE')
 * @param now Override for testing; defaults to current time
 * @returns true if the market is open, false if closed
 */
export function isMarketOpen(exchange: string, now: Date = new Date()): boolean {
  const config = MARKET_CONFIGS[exchange]
  if (!config) {
    throw new Error(`Unknown exchange: ${exchange}. Known: ${Object.keys(MARKET_CONFIGS).join(', ')}`)
  }

  const { dayOfWeek, hour, minute } = timePartsInTimezone(now, config.timezone)

  // Weekend — Saturday (6) or Sunday (0)
  if (dayOfWeek === 0 || dayOfWeek === 6) return false

  // Trading hours
  const minutesSinceMidnight = hour * 60 + minute
  const openMinutes = parseTimeToMinutes(config.tradingHours.open)
  const closeMinutes = parseTimeToMinutes(config.tradingHours.close)
  if (minutesSinceMidnight < openMinutes) return false
  if (minutesSinceMidnight >= closeMinutes) return false

  // Holidays
  const dateStr = dateStringInTimezone(now, config.timezone)
  const year = parseInt(dateStr.slice(0, 4), 10)
  const holidays = config.getHolidays(year)
  if (holidays.has(dateStr)) return false

  return true
}

/**
 * Checks whether the LSE is currently open for trading.
 *
 * LSE trading hours: 08:00–16:30 Europe/London time, Monday–Friday,
 * excluding UK bank holidays.
 *
 * Backward-compatible wrapper around isMarketOpen('LSE'). Existing callers
 * (trade-confirmation.ts, tests) don't need to change.
 *
 * @param now Override for testing; defaults to current time
 * @returns true if the LSE is open, false if closed
 */
export function isLseMarketOpen(now: Date = new Date()): boolean {
  return isMarketOpen('LSE', now)
}

/**
 * Checks whether NSE (National Stock Exchange of India) is currently open.
 *
 * NSE trading hours: 09:15–15:30 Asia/Kolkata time, Monday–Friday,
 * excluding Indian market holidays.
 *
 * @param now Override for testing; defaults to current time
 * @returns true if NSE is open, false if closed
 */
export function isNseMarketOpen(now: Date = new Date()): boolean {
  return isMarketOpen('NSE', now)
}

/**
 * Checks whether BSE (Bombay Stock Exchange) is currently open.
 * BSE has the same hours and holidays as NSE.
 *
 * @param now Override for testing; defaults to current time
 * @returns true if BSE is open, false if closed
 */
export function isBseMarketOpen(now: Date = new Date()): boolean {
  return isMarketOpen('BSE', now)
}

/**
 * Returns the appropriate market-open check for a given connector + ticker.
 *
 * Trading 212 instruments encode their exchange via a suffix:
 *   - `_US_EQ`  → NYSE/NASDAQ (US equities)
 *   - `_LSE_EQ` → LSE (UK equities, when supported)
 *   - `_DE_EQ`, `_NL_EQ`, ... → European exchanges (not yet configured)
 *
 * The previous implementation hardcoded Trading 212 → LSE, which was wrong:
 * the live account trades US equities (AAPL_US_EQ, MU_US_EQ, ...), so the
 * market-hours check used the wrong exchange's hours and holidays. This
 * caused trades to be deferred when the US market was open but LSE was
 * closed, or to fire when LSE was open but the US market was closed.
 *
 * For connectors without a ticker (e.g. a connector-level pre-check), the
 * connector's primary exchange is used as the default.
 *
 * @param connectorId The connector id (e.g. 'trading-212', 'zerodha')
 * @param ticker Optional instrument ticker (e.g. 'AAPL_US_EQ') — when
 *               present, the exchange is derived from the ticker suffix.
 * @returns function that checks if the market is open
 */
export function getMarketOpenChecker(
  connectorId: string,
  ticker?: string,
): (now?: Date) => boolean {
  // Derive the exchange from the ticker suffix when available.
  if (ticker) {
    const exchange = exchangeFromTicker(ticker)
    if (exchange) return (now?: Date) => isMarketOpen(exchange, now)
  }

  // Fall back to the connector's primary exchange.
  const CONNECTOR_EXCHANGE: Record<string, string> = {
    'trading-212': 'NYSE', // Trading 212's primary universe is US equities
    'zerodha': 'NSE',
  }
  const exchange = CONNECTOR_EXCHANGE[connectorId] ?? 'LSE'
  return (now?: Date) => isMarketOpen(exchange, now)
}

/**
 * Maps a Trading 212 instrument ticker to its exchange code based on the
 * suffix. Returns undefined for unknown/unsupported suffixes.
 *
 * Examples:
 *   'AAPL_US_EQ'  → 'NYSE'  (US equities trade on NYSE/NASDAQ — same hours)
 *   'BP_LSE_EQ'   → 'LSE'
 *   'SAP_DE_EQ'   → undefined (German exchange not yet configured)
 */
export function exchangeFromTicker(ticker: string): string | undefined {
  if (ticker.endsWith('_US_EQ')) return 'NYSE' // NYSE/NASDAQ share hours/holidays
  if (ticker.endsWith('_LSE_EQ')) return 'LSE'
  // Add more exchange mappings as Trading 212 instruments are supported.
  return undefined
}
