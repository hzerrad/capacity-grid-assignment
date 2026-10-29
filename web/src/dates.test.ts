import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { endOfWeek, isISODate, listWeeks, shiftRange, snapRange, startOfWeek, weekCount } from './dates'

// The container runs in UTC, which hides local-time bugs; run everything on
// both sides of UTC as well.
describe.each(['UTC', 'Pacific/Honolulu', 'Pacific/Kiritimati'])('week maths in %s', (tz) => {
  beforeAll(() => {
    vi.stubEnv('TZ', tz)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

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

  it('shifts by whole weeks keeping the width, across DST changes', () => {
    expect(shiftRange({ from: '2025-12-29', to: '2026-01-18' }, -1)).toEqual({
      from: '2025-12-22',
      to: '2026-01-11',
    })
    expect(shiftRange({ from: '2026-03-23', to: '2026-03-29' }, 1)).toEqual({
      from: '2026-03-30',
      to: '2026-04-05',
    })
  })

  it('rejects impossible dates', () => {
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
    expect(isISODate('2026-02-28')).toBe(true)
  })
})
