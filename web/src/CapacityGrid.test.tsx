import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapacityResponse } from './api'
import { App } from './App'
import { listWeeks } from './dates'

// A fake API that holds every request until the test answers it, so tests
// control exactly when responses arrive and in which order.
type FakeRequest = {
  url: URL
  method: string
  body: unknown
  answered: boolean
  respond: (body: unknown, status?: number) => void
}

let requests: FakeRequest[] = []

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const req: FakeRequest = {
            url: new URL(input, 'http://localhost'),
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
            answered: false,
            respond: (body, status = 200) => {
              req.answered = true
              resolve(Response.json(body, { status }))
            },
          }
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          requests.push(req)
        }),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function nextRequest(method = 'GET') {
  return waitFor(() => {
    const req = requests.find((r) => !r.answered && r.method === method)
    if (!req) throw new Error(`no pending ${method}`)
    return req
  })
}

function sent(method: string) {
  return requests.filter((r) => r.method === method)
}

type Row = { id: number; name: string; weeklyHours: number; allocated: number[] }

const dee: Row = { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [45] }

function gridFor(req: FakeRequest, rows: Row[], total = rows.length): CapacityResponse {
  const from = req.url.searchParams.get('from')!
  const to = req.url.searchParams.get('to')!
  return {
    from,
    to,
    weeks: listWeeks({ from, to }),
    weekends: req.url.searchParams.get('weekends') === 'count' ? 'count' : 'separate',
    total,
    limit: 50,
    offset: Number(req.url.searchParams.get('offset')),
    people: rows.map((r) => ({
      id: r.id,
      name: r.name,
      weeklyHours: r.weeklyHours,
      cells: r.allocated.map((allocated) => ({ allocated, weekend: 0, capacity: r.weeklyHours })),
    })),
  }
}

async function renderGrid(rows: Row[] = [dee], total?: number) {
  window.history.replaceState(null, '', '/?from=2026-01-05&to=2026-01-11')
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  )
  const first = await nextRequest()
  first.respond(gridFor(first, rows, total))
  await screen.findByText(`${rows[0].allocated[0]} / ${rows[0].weeklyHours}`)
}

function editWeeklyHours(name: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Weekly hours for ${name}`) }))
  fireEvent.change(screen.getByLabelText(`Weekly hours for ${name}`), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }))
}

describe('loading and failures', () => {
  it('shows a skeleton until the first response, then the grid', async () => {
    window.history.replaceState(null, '', '/?from=2026-01-05&to=2026-01-11')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('Loading capacity')).toBeInTheDocument()

    const req = await nextRequest()
    req.respond(gridFor(req, [dee]))

    expect(await screen.findByText('45 / 40')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading capacity')).not.toBeInTheDocument()
  })

  it('offers a retry when the first load fails', async () => {
    window.history.replaceState(null, '', '/?from=2026-01-05&to=2026-01-11')
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    )
    ;(await nextRequest()).respond({ error: 'database unavailable' }, 500)

    expect(await screen.findByText("Couldn't load capacity: database unavailable.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    const retry = await nextRequest()
    retry.respond(gridFor(retry, [dee]))
    expect(await screen.findByText('45 / 40')).toBeInTheDocument()
  })

  it('keeps the last grid on screen while the next range loads', async () => {
    await renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Next week →' }))
    await nextRequest()

    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByText('45 / 40')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading capacity')).not.toBeInTheDocument()
  })

  it('keeps the last grid and explains when a refresh fails', async () => {
    await renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Next week →' }))
    ;(await nextRequest()).respond({ error: 'database unavailable' }, 500)

    expect(await screen.findByText(/Couldn't refresh: database unavailable/)).toBeInTheDocument()
    expect(screen.getByText('45 / 40')).toBeInTheDocument()
  })

  it('ignores a response that arrives after the user has moved on', async () => {
    await renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Next week →' }))
    const slow = await nextRequest()
    fireEvent.click(screen.getByRole('button', { name: 'Next week →' }))
    const latest = await waitFor(() => {
      const r = requests.find((r) => r.url.searchParams.get('from') === '2026-01-19')
      if (!r) throw new Error('no request for 19 Jan')
      return r
    })

    latest.respond(gridFor(latest, [{ ...dee, allocated: [30] }]))
    expect(await screen.findByText('30 / 40')).toBeInTheDocument()

    slow.respond(gridFor(slow, [{ ...dee, allocated: [99] }]))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('99 / 40')).not.toBeInTheDocument()
    expect(screen.getByText('30 / 40')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '19 Jan' })).toBeInTheDocument()
  })
})

describe('editing weekly hours', () => {
  it('updates the row at once, then settles on the numbers the server returns', async () => {
    await renderGrid()
    expect(screen.getByText('⚠ +5h')).toBeInTheDocument()
    expect(screen.getByText('1 week over')).toBeInTheDocument()

    editWeeklyHours('Dee Okafor', '50')

    expect(await screen.findByText('45 / 50')).toBeInTheDocument()
    expect(screen.queryByText('⚠ +5h')).not.toBeInTheDocument()
    expect(screen.queryByText('1 week over')).not.toBeInTheDocument()

    const save = await nextRequest('PATCH')
    expect(save.url.pathname).toBe('/api/people/4')
    expect(save.body).toEqual({ weeklyHours: 50 })
    save.respond({ id: 4, name: 'Dee Okafor', weeklyHours: 50 })

    const refetch = await nextRequest()
    refetch.respond(gridFor(refetch, [{ ...dee, weeklyHours: 50, allocated: [44] }]))
    expect(await screen.findByText('44 / 50')).toBeInTheDocument()
  })

  it('rolls back and keeps the attempted value when the save fails', async () => {
    await renderGrid()
    editWeeklyHours('Dee Okafor', '50')
    expect(await screen.findByText('45 / 50')).toBeInTheDocument()

    ;(await nextRequest('PATCH')).respond({ error: 'database unavailable' }, 500)

    expect(await screen.findByText(/Couldn't save 50 h\/wk: database unavailable/)).toBeInTheDocument()
    // The refetch after the failure is still pending, so only the rollback can restore this.
    expect(screen.getByText('45 / 40')).toBeInTheDocument()
    expect(screen.getByText('⚠ +5h')).toBeInTheDocument()
  })

  it('retries a failed save with the same value', async () => {
    await renderGrid()
    editWeeklyHours('Dee Okafor', '50')
    ;(await nextRequest('PATCH')).respond({ error: 'database unavailable' }, 500)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    const retry = await nextRequest('PATCH')
    expect(retry.body).toEqual({ weeklyHours: 50 })
    expect(await screen.findByText('45 / 50')).toBeInTheDocument()
    retry.respond({ id: 4, name: 'Dee Okafor', weeklyHours: 50 })

    await waitFor(() => expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument())
  })

  it('discarding a failed save leaves the saved value', async () => {
    await renderGrid()
    editWeeklyHours('Dee Okafor', '50')
    ;(await nextRequest('PATCH')).respond({ error: 'database unavailable' }, 500)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(await screen.findByRole('button', { name: /Weekly hours for Dee Okafor: 40/ })).toBeInTheDocument()
    expect(sent('PATCH')).toHaveLength(1)
  })

  it('rejects invalid hours without sending anything, and Escape cancels', async () => {
    await renderGrid()
    editWeeklyHours('Dee Okafor', '200')
    expect(screen.getByText('Must be between 0 and 168')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Weekly hours for Dee Okafor'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: /Weekly hours for Dee Okafor: 40/ })).toBeInTheDocument()

    editWeeklyHours('Dee Okafor', '40')
    expect(sent('PATCH')).toHaveLength(0)
  })
})

describe('range and filters', () => {
  it('moves by one week and refuses ranges over 26 weeks', async () => {
    await renderGrid()
    fireEvent.click(screen.getByRole('button', { name: '← Previous week' }))
    const prev = await nextRequest()
    expect(prev.url.searchParams.get('from')).toBe('2025-12-29')
    expect(prev.url.searchParams.get('to')).toBe('2026-01-04')
    prev.respond(gridFor(prev, [dee]))

    const before = requests.length
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-31' } })
    expect(screen.getByText('Ranges are limited to 26 weeks.')).toBeInTheDocument()
    expect(requests).toHaveLength(before)
  })

  it('sends the filters and returns to the first page when filtering', async () => {
    await renderGrid([dee], 120)
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    const page2 = await nextRequest()
    expect(page2.url.searchParams.get('offset')).toBe('50')
    page2.respond(gridFor(page2, [dee], 120))
    await screen.findByText('51–100 of 120 people')

    fireEvent.click(screen.getByLabelText('Over-allocated only'))
    const filtered = await nextRequest()
    expect(filtered.url.searchParams.get('over')).toBe('true')
    expect(filtered.url.searchParams.get('offset')).toBe('0')
    filtered.respond(gridFor(filtered, [dee]))

    fireEvent.click(screen.getByLabelText('Count weekend hours against capacity'))
    expect((await nextRequest()).url.searchParams.get('weekends')).toBe('count')
  })
})
