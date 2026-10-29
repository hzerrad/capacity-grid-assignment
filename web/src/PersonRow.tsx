import { memo, useState, type CSSProperties } from 'react'
import type { CapacityCell, CapacityPerson, Weekends } from './api'
import { cellStatus, formatHours, parseWeeklyHours } from './capacity'
import { useIsMutating } from '@tanstack/react-query'
import { useUpdateWeeklyHours, weeklyHoursKey } from './queries'

type Props = {
  person: CapacityPerson
  weeks: string[]
  weekends: Weekends
}

export const PersonRow = memo(function PersonRow({ person, weeks, weekends }: Props) {
  const recalculating = useIsMutating({ mutationKey: weeklyHoursKey(person.id) }) > 0
  const overWeeks = recalculating ? 0 : person.cells.filter((c) => cellStatus(c) === 'over').length
  return (
    <tr>
      <th scope="row" className="person-col">
        <div className="person">
          <span className="person-name">{person.name}</span>
          <WeeklyHoursEditor person={person} />
          {overWeeks > 0 && (
            <span className="over-count">
              {overWeeks} {overWeeks === 1 ? 'week' : 'weeks'} over
            </span>
          )}
        </div>
      </th>
      {person.cells.map((cell, i) => (
        <Cell key={weeks[i]} cell={cell} weekends={weekends} recalculating={recalculating} />
      ))}
    </tr>
  )
})

function Cell({ cell, weekends, recalculating }: { cell: CapacityCell; weekends: Weekends; recalculating: boolean }) {
  if (recalculating) {
    return (
      <td className="cell cell--pending" title="Recalculating after the capacity change">
        <span className="sr-only">{formatHours(cell.allocated)} hours allocated, recalculating capacity</span>
        <span aria-hidden="true" className="cell-hours">
          {formatHours(cell.allocated)} / …
        </span>
      </td>
    )
  }
  const status = cellStatus(cell)
  const fill = cell.capacity > 0 ? Math.min(cell.allocated / cell.capacity, 1) : 1
  const over = cell.allocated - cell.capacity
  let label = `${formatHours(cell.allocated)} of ${formatHours(cell.capacity)} hours allocated`
  if (status === 'over') label += `, ${formatHours(over)} over capacity`
  if (cell.weekend > 0) {
    label += weekends === 'count'
      ? `, including ${formatHours(cell.weekend)} on the weekend`
      : `, plus ${formatHours(cell.weekend)} on the weekend`
  }

  return (
    <td className={`cell cell--${status}`} style={{ '--fill': fill } as CSSProperties} title={label}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {status === 'empty' ? (
          <span className="cell-hours muted">–</span>
        ) : (
          <span className="cell-hours">
            {formatHours(cell.allocated)} / {formatHours(cell.capacity)}
          </span>
        )}
        {status === 'over' && <span className="over-by">⚠ +{formatHours(over)}h</span>}
        {cell.weekend > 0 && (
          <span className="weekend">
            {weekends === 'count' ? 'incl. ' : '+'}
            {formatHours(cell.weekend)}h wknd
          </span>
        )}
      </span>
    </td>
  )
}

function WeeklyHoursEditor({ person }: { person: CapacityPerson }) {
  const mutation = useUpdateWeeklyHours(person.id)
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState('')

  function save(raw: string) {
    const value = parseWeeklyHours(raw)
    if (typeof value === 'string') {
      setInvalid(value)
      return
    }
    setInvalid('')
    setDraft(null)
    if (value !== person.weeklyHours) {
      mutation.mutate({ weeklyHours: value, previous: person.weeklyHours })
    }
  }

  function cancel() {
    setDraft(null)
    setInvalid('')
  }

  if (mutation.isError && draft === null) {
    const attempted = mutation.variables.weeklyHours
    return (
      <div className="hours-error" role="alert">
        <span>
          Couldn't save {formatHours(attempted)} h/wk: {mutation.error.message}
        </span>
        <button type="button" onClick={() => mutation.mutate(mutation.variables)}>
          Retry
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(String(attempted))
            mutation.reset()
          }}
        >
          Edit
        </button>
        <button type="button" onClick={() => mutation.reset()}>
          Discard
        </button>
      </div>
    )
  }

  if (draft !== null) {
    return (
      <form
        className="hours-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save(draft)
        }}
      >
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={168}
          step="any"
          autoFocus
          value={draft}
          aria-label={`Weekly hours for ${person.name}`}
          aria-invalid={invalid !== ''}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
          }}
        />
        <button type="submit" aria-label="Save weekly hours">
          ✓
        </button>
        <button type="button" aria-label="Cancel" onClick={cancel}>
          ✕
        </button>
        {invalid && <span className="hours-invalid">{invalid}</span>}
      </form>
    )
  }

  return (
    <button
      type="button"
      className="hours-button"
      disabled={mutation.isPending}
      aria-label={`Weekly hours for ${person.name}: ${formatHours(person.weeklyHours)}. Edit`}
      onClick={() => setDraft(String(person.weeklyHours))}
    >
      {formatHours(person.weeklyHours)} h/wk
      {mutation.isPending && <span className="saving"> · saving…</span>}
    </button>
  )
}
