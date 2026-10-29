import { describe, expect, it } from 'vitest'
import { cellStatus, parseWeeklyHours } from './capacity'

describe('cellStatus', () => {
  it.each([
    [0, 40, 'empty'],
    [30, 40, 'under'],
    [40, 40, 'full'],
    [45, 40, 'over'],
    [0, 0, 'empty'],
    [20, 0, 'over'],
  ] as const)('%d of %d is %s', (allocated, capacity, status) => {
    expect(cellStatus({ allocated, capacity, weekend: 0 })).toBe(status)
  })
})

describe('parseWeeklyHours', () => {
  it('accepts fractions within 0–168', () => {
    expect(parseWeeklyHours('37.5')).toBe(37.5)
    expect(parseWeeklyHours('0')).toBe(0)
  })

  it('rejects blanks and out-of-range values', () => {
    expect(typeof parseWeeklyHours('')).toBe('string')
    expect(typeof parseWeeklyHours('-1')).toBe('string')
    expect(typeof parseWeeklyHours('169')).toBe('string')
  })
})
