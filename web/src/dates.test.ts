import { describe, expect, it } from 'vitest'
import { endOfWeek, isISODate, listWeeks, shiftRange, snapRange, startOfWeek, weekCount } from './dates'

describe('week maths', () => {
  it('snaps to Monday, including across the year boundary', () => {
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29')
    expect(startOfWeek('2025-12-29')).toBe('2025-12-29')
    expect(startOfWeek('2026-01-04')).toBe('2025-12-29')
    expect(endOfWeek('2026-01-16')).toBe('2026-01-18')
  })

  it('snaps a range out to whole weeks', () => {
    const range = snapRange({ from: '2025-12-31', to: '2026-01-16' })
    expect(range).toEqual({ from: '2025-12-29', to: '2026-01-18' })
    expect(weekCount(range)).toBe(3)
    expect(listWeeks(range)).toEqual(['2025-12-29', '2026-01-05', '2026-01-12'])
  })

  it('shifts by whole weeks keeping the width', () => {
    expect(shiftRange({ from: '2025-12-29', to: '2026-01-18' }, -1)).toEqual({
      from: '2025-12-22',
      to: '2026-01-11',
    })
  })

  it('rejects impossible dates', () => {
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
    expect(isISODate('2026-02-28')).toBe(true)
  })
})
