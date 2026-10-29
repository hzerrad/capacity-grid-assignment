import { useState } from 'react'
import type { Weekends } from './api'
import {
  addDays,
  endOfWeek,
  formatDate,
  formatWeek,
  listWeeks,
  MAX_WEEKS,
  shiftRange,
  startOfWeek,
  todayISO,
  weekCount,
  type DateRange,
} from './dates'
import { PersonRow } from './PersonRow'
import { useCapacity } from './queries'

const PAGE_SIZE = 50

type Props = {
  from: string
  to: string
  onRangeChange: (range: DateRange) => void
}

export function CapacityGrid({ from, to, onRangeChange }: Props) {
  const [weekends, setWeekends] = useState<Weekends>('separate')
  const [overOnly, setOverOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const {
    data: fresh,
    error,
    isPending,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useCapacity({ from, to, weekends, overOnly, limit: PAGE_SIZE, offset })

  // placeholderData is dropped once a query errors, so keep the last grid ourselves.
  const [lastLoaded, setLastLoaded] = useState(fresh)
  if (fresh && fresh !== lastLoaded) setLastLoaded(fresh)
  const data = fresh ?? lastLoaded
  const stale = isPlaceholderData || fresh === undefined

  return (
    <section className="capacity" aria-busy={isFetching}>
      <RangeControls from={from} to={to} onRangeChange={onRangeChange} shown={data && { from: data.from, to: data.to }} />

      <div className="filters">
        <label>
          <input
            type="checkbox"
            checked={overOnly}
            onChange={(e) => {
              setOverOnly(e.target.checked)
              setOffset(0)
            }}
          />
          Over-allocated only
        </label>
        <label>
          <input
            type="checkbox"
            checked={weekends === 'count'}
            onChange={(e) => setWeekends(e.target.checked ? 'count' : 'separate')}
          />
          Count weekend hours against capacity
        </label>
        <span className="status" role="status">
          {isFetching && data ? 'Updating…' : ''}
        </span>
      </div>

      {error && data && (
        <div className="banner banner--error" role="alert">
          <span>
            Couldn't refresh: {error.message}. Showing the last numbers that loaded.
          </span>
          <button type="button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {isPending ? (
        <SkeletonGrid weeks={listWeeks({ from, to })} />
      ) : !data ? (
        <div className="panel panel--error" role="alert">
          <p>Couldn't load capacity: {error?.message}.</p>
          <button type="button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : data.people.length === 0 ? (
        <div className="panel">
          {data.total > 0 ? (
            <>
              <p>No one on this page.</p>
              <button type="button" onClick={() => setOffset(0)}>
                Back to first page
              </button>
            </>
          ) : (
            <p>{overOnly ? 'No one is over-allocated in this range.' : 'No people to show.'}</p>
          )}
        </div>
      ) : (
        <>
          <div className={`grid-scroll${stale ? ' is-stale' : ''}`}>
            <table className="grid">
              <caption className="sr-only">Allocated hours against capacity, per person, per week</caption>
              <thead>
                <tr>
                  <th scope="col" className="person-col">
                    Person · weekly hours
                  </th>
                  {data.weeks.map((week) => (
                    <th scope="col" key={week}>
                      {formatWeek(week)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => (
                  <PersonRow key={person.id} person={person} weeks={data.weeks} weekends={data.weekends} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} offset={data.offset} onOffsetChange={setOffset} />
        </>
      )}

      <Legend />
    </section>
  )
}

function RangeControls({ from, to, onRangeChange, shown = { from, to } }: Props & { shown?: DateRange }) {
  const [notice, setNotice] = useState('')
  const weeks = weekCount({ from, to })

  function change(next: DateRange) {
    if (weekCount(next) > MAX_WEEKS) {
      setNotice(`Ranges are limited to ${MAX_WEEKS} weeks.`)
      return
    }
    setNotice('')
    onRangeChange(next)
  }

  return (
    <div className="range-controls">
      <div className="range-nav">
        <button type="button" onClick={() => change(shiftRange({ from, to }, -1))}>
          ← Previous week
        </button>
        <button
          type="button"
          onClick={() => {
            const start = startOfWeek(todayISO())
            change({ from: start, to: addDays(start, 7 * weeks - 1) })
          }}
        >
          This week
        </button>
        <button type="button" onClick={() => change(shiftRange({ from, to }, 1))}>
          Next week →
        </button>
      </div>
      <label>
        From
        <input
          type="date"
          value={from}
          onChange={(e) => {
            if (!e.target.value) return
            const start = startOfWeek(e.target.value)
            change({ from: start, to: to < start ? endOfWeek(start) : to })
          }}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={to}
          onChange={(e) => {
            if (!e.target.value) return
            const end = endOfWeek(e.target.value)
            change({ from: end < from ? startOfWeek(end) : from, to: end })
          }}
        />
      </label>
      <span className="range-summary">
        {shown.from === from && shown.to === to ? '' : 'Showing '}
        {formatDate(shown.from)} – {formatDate(shown.to)} · {weekCount(shown)} {weekCount(shown) === 1 ? 'week' : 'weeks'}
      </span>
      {notice && (
        <span className="range-notice" role="status">
          {notice}
        </span>
      )}
    </div>
  )
}

function Pagination({
  total,
  offset,
  onOffsetChange,
}: {
  total: number
  offset: number
  onOffsetChange: (offset: number) => void
}) {
  const last = Math.min(offset + PAGE_SIZE, total)
  return (
    <nav className="pagination" aria-label="People pages">
      <button type="button" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}>
        ← Previous
      </button>
      <span>
        {offset + 1}–{last} of {total} people
      </span>
      <button type="button" disabled={last >= total} onClick={() => onOffsetChange(offset + PAGE_SIZE)}>
        Next →
      </button>
    </nav>
  )
}

function SkeletonGrid({ weeks }: { weeks: string[] }) {
  return (
    <div className="grid-scroll" aria-label="Loading capacity">
      <table className="grid grid--skeleton">
        <thead>
          <tr>
            <th scope="col" className="person-col">
              Person · weekly hours
            </th>
            {weeks.map((week) => (
              <th scope="col" key={week}>
                {formatWeek(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, row) => (
            <tr key={row}>
              <th scope="row">
                <span className="skeleton-bar" />
              </th>
              {weeks.map((week) => (
                <td key={week}>
                  <span className="skeleton-bar" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="swatch cell--under" /> Booked, with room left
      </li>
      <li>
        <span className="swatch cell--full" /> Exactly at capacity
      </li>
      <li>
        <span className="swatch cell--over" /> ⚠ Over capacity
      </li>
      <li>
        <span className="weekend">wknd</span> Hours booked on Saturday/Sunday
      </li>
    </ul>
  )
}
