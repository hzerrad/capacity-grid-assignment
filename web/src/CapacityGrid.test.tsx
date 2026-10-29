import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { CapacityResponse } from './api'
import { CapacityGrid } from './CapacityGrid'

const grid: CapacityResponse = {
  from: '2026-01-05',
  to: '2026-01-11',
  weeks: ['2026-01-05'],
  weekends: 'separate',
  total: 1,
  limit: 50,
  offset: 0,
  people: [{ id: 4, name: 'Dee Okafor', weeklyHours: 40, cells: [{ allocated: 45, weekend: 0, capacity: 40 }] }],
}

afterEach(() => vi.unstubAllGlobals())

it('shows a save optimistically and rolls it back when the server rejects it', async () => {
  let failSave!: () => void
  let loads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          failSave = () => resolve(Response.json({ error: 'database unavailable' }, { status: 500 }))
        })
      }
      // Only the first load answers, so the refetch after the save can't mask a missing rollback.
      return loads++ === 0 ? Promise.resolve(Response.json(grid)) : new Promise<Response>(() => {})
    }),
  )

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CapacityGrid from="2026-01-05" to="2026-01-11" onRangeChange={() => {}} />
    </QueryClientProvider>,
  )

  expect(await screen.findByText('45 / 40')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Weekly hours for Dee Okafor/ }))
  fireEvent.change(screen.getByLabelText('Weekly hours for Dee Okafor'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }))

  expect(await screen.findByText('45 / 50')).toBeInTheDocument()

  failSave()

  expect(await screen.findByText(/Couldn't save 50 h\/wk: database unavailable/)).toBeInTheDocument()
  expect(screen.getByText('45 / 40')).toBeInTheDocument()
})
