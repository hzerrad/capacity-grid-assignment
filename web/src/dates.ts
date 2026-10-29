// Dates stay YYYY-MM-DD strings; arithmetic runs in UTC so the viewer's
// timezone can never shift a day.

const DAY_MS = 86_400_000

export const MAX_WEEKS = 26

export type DateRange = { from: string; to: string }

function parse(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && format(parse(value)) === value
}

export function addDays(iso: string, days: number): string {
  return format(parse(iso) + days * DAY_MS)
}

export function startOfWeek(iso: string): string {
  const weekday = (new Date(parse(iso)).getUTCDay() + 6) % 7
  return addDays(iso, -weekday)
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6)
}

export function snapRange({ from, to }: DateRange): DateRange {
  return { from: startOfWeek(from), to: endOfWeek(to) }
}

export function weekCount({ from, to }: DateRange): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS + 1) / 7
}

export function listWeeks(range: DateRange): string[] {
  return Array.from({ length: weekCount(range) }, (_, i) => addDays(range.from, 7 * i))
}

export function shiftRange({ from, to }: DateRange, weeks: number): DateRange {
  return { from: addDays(from, 7 * weeks), to: addDays(to, 7 * weeks) }
}

export function todayISO(): string {
  const now = new Date()
  return format(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

const weekLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fullLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatWeek(iso: string): string {
  return weekLabel.format(parse(iso))
}

export function formatDate(iso: string): string {
  return fullLabel.format(parse(iso))
}
