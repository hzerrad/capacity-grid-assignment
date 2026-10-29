import type { CapacityCell } from './api'

export const MAX_WEEKLY_HOURS = 168

export type CellStatus = 'empty' | 'under' | 'full' | 'over'

export function cellStatus({ allocated, capacity }: CapacityCell): CellStatus {
  if (allocated > capacity) return 'over'
  if (allocated === 0) return 'empty'
  if (allocated === capacity) return 'full'
  return 'under'
}

const hours = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

export function formatHours(n: number): string {
  return hours.format(n)
}

export function parseWeeklyHours(raw: string): number | string {
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value)) return 'Enter a number of hours'
  if (value < 0 || value > MAX_WEEKLY_HOURS) return `Must be between 0 and ${MAX_WEEKLY_HOURS}`
  return value
}
