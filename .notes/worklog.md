# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## Design decisions (agreed before implementation)

- **Weeks:** Monday–Sunday, keyed by the Monday's ISO date (never week numbers — the default range crosses a year boundary). `from`/`to` snap out to whole weeks; the response echoes the snapped range.
- **Aggregation in one SQL query:** weekdays of the range × overlapping assignments, summed per person-week and left-joined onto every person × week pair, so people with no work still get rows. Considered computing weekday overlap per assignment arithmetically (no day expansion) — faster at large scale, but more clever than needed; revisit only on a measured performance problem.
- **Seed rows are fragments, not duplicates:** each booking is split into ~15 rows with identical person/project/dates (e.g. 14×0.5 + 1×1.0 = 8h/day). Must `SUM` every row; `DISTINCT` would silently under-report.
- **Response shape:** weeks listed once; each person carries cells aligned to that list. `capacity` is sent per cell even though today it always equals `weekly_hours` — keeps the contract stable if capacity ever varies per week (holidays, part-time periods), and keeps that rule on the server.
- **After a save:** optimistic update of the edited row, rollback on failure, then refetch the range to reconcile with the server. Brief staleness is acceptable because the refetch corrects it.
- **Scale — server pagination + "over-allocated only" filter:** production is ~3k people × up to 2 years; fetching all and virtualising still ships MB of JSON and leaves server cost unbounded, and paging alone hides over-committed people on other pages. `limit`/`offset` over a stable `name, id` order with a `total`, default 50 (max 200), plus a server-side filter so the manager's actual question ("who is over?") is one click. Weekly-hours edits don't change sort order, so rows don't jump. 50 rows × ≤26 weeks needs no virtualisation; it's the next step if page sizes grow. Name search / team filter deferred (no teams in the schema).
- **Range cap:** 26 weeks per request; larger returns 400.
- **PATCH validation:** strict JSON (unknown fields, trailing data, null, string numbers → 400), 0 ≤ weeklyHours ≤ 168 with fractions allowed, id must fit int32 (400) and exist (404), body size capped. Concurrent edits are last-write-wins — there's no version column and the schema is fixed. Edits rewrite past weeks too: weekly_hours has no history.
- **TanStack Query over React built-ins:** React 19 alone could do this — a `useEffect` + `AbortController` fetch hook for the range, `useOptimistic` inside an async transition for the edit (it reverts on its own when the action throws). It would still leave us hand-writing a per-range cache (instant back-navigation), keeping the previous grid while the next loads, de-duping StrictMode's double effect, retries, and refetch-after-save. TanStack gives these as documented primitives (`placeholderData: keepPreviousData`, `onMutate`/`onError` rollback, `invalidateQueries`), and since this view will share a page with a logged-time timeline, one cache lets an edit invalidate every view of that person.
- **Re-renders:** edit draft lives in the edit cell's local state; rows are `React.memo` with stable props; TanStack structural sharing keeps unchanged person objects identical so an edit/refetch re-renders only changed rows; range→URL via `history.replaceState`; refetch dimming is one class on the table.
- **Editing lives on the person, not the week cell:** weekly hours is a person attribute; editing inside a week cell would imply per-week capacity.
- **Weekends — assumption, not spec:** nothing in the repo says whether weekend days in an assignment carry hours. Toggl Focus models capacity per working day with Mon–Fri as the default (support docs + a community thread where weekend capacity was a known limitation), so weekday hours count against capacity and weekend hours are returned and shown separately per week ("+16h weekend") — never dropped. Measured on the seed: counting all days marks 34.8% of person-weeks over vs 11.8% weekdays-only. My first justification ("8h/day only fits a 5-day week") was my own arithmetic, not from the data; and the old generator (commit 7f6b086) starts every assignment on a Monday with a random 3–13 day length, so weekend overlap is incidental and proves nothing either way.

## Implementation

- **API verified against hand-computed numbers** for the five curated people (Ana 40/0/30 with 16h weekend, Bo 0/32/8, Cem 0/4/12, Dee 0/45/40, Eli 0/20/0 against 0). 41 people over in the default range with weekends separate, 146 with weekends=count.
- **JIT off on the pool:** generate_series' fixed 1000-row estimate inflates plan cost past `jit_above_cost`; ~280ms of JIT compile on a ~20ms query. With JIT off: 3 weeks ≈ 18ms, 26 weeks ≈ 115ms (500 people, 126k assignment rows, index on (start_date, end_date) used). At 3k people the 26-week case is the one to watch.
- **Empty page past the end** still returns `total` (LEFT JOIN LATERAL on the page), so the client can recover from a stale offset.
