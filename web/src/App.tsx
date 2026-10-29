import { useEffect, useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { isISODate, MAX_WEEKS, snapRange, weekCount, type DateRange } from './dates'

const DEFAULT_RANGE: DateRange = { from: '2025-12-29', to: '2026-01-16' }

function rangeFromURL(): DateRange {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!isISODate(from) || !isISODate(to) || to < from) return snapRange(DEFAULT_RANGE)
  const range = snapRange({ from, to })
  return weekCount(range) <= MAX_WEEKS ? range : snapRange(DEFAULT_RANGE)
}

export function App() {
  const [range, setRange] = useState(rangeFromURL)

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('from', range.from)
    url.searchParams.set('to', range.to)
    window.history.replaceState(null, '', url)
  }, [range])

  return (
    <main>
      <h1>Team capacity</h1>
      <CapacityGrid from={range.from} to={range.to} onRangeChange={setRange} />
    </main>
  )
}
