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
- **Checked in the browser** (default range, dark mode): numbers match the API table above. Edit Ana 40→32 re-colours her row instantly (40/32 over by 8) and survives the refetch. With the API stopped: first load shows skeleton → error panel with Retry; a save rolls back to the server value and shows "Couldn't save 40 h/wk: Can't reach the server" with Retry / Edit / Discard; Retry after restarting the API saves and reconciles.
- **Fixed after looking:** the save error first appeared ~8s late — `onSettled` returned the invalidation promise, so the mutation waited for the refetch (and its retries against a dead API). Now fire-and-forget. Vite's proxy answers 502 when the API is down; mapped 502/503/504 to "Can't reach the server" instead of "Request failed (502)". "Exactly full" and "nearly full" were indistinguishable in dark mode; full is now amber.
- **Rollback is targeted, not a cache snapshot:** onError restores only that person's previous hours. Restoring a whole-cache snapshot would also wipe another row's in-flight optimistic edit.
- **Rollback test** makes every load after the first hang, so the refetch can't restore the value and mask a missing rollback — confirmed it fails with the rollback removed.
- **Known, left as is:** with "Over-allocated only" on, a save that fixes someone removes their row on the refetch (correct, but abrupt). Weekends toggle / filter / page aren't in the URL — only the range is.
- **API tests:** validation tests run anywhere (handlers reject before touching the DB); query/PATCH tests need the seeded compose DB and skip without `DATABASE_URL`. Run with:
  `docker run --rm --network capacity-grid-assignment_default -e 'DATABASE_URL=postgres://capacity:capacity@db:5432/capacity?sslmode=disable' -v "$PWD/api":/src -w /src golang:1.26-alpine go test ./...`
  They assert the hand-computed numbers for the five curated people, so a mis-summed or weekend-counting query fails loudly (checked by breaking the weekday filter: 3 tests fail). The PATCH test edits Dee and restores her in `t.Cleanup` — it writes to the shared dev DB, so don't run it against anything you care about.
- **Query cost grows with total history, not the requested range:** the overlap filter `start_date <= to AND end_date >= from` on the existing B-tree `(start_date, end_date)` can only bound one side — `start_date <= to` matches every assignment that started before the range ends. Measured on the seed: June 2025 (start of history) uses the index, reads ~9k rows, 4.6ms; December 2026 (end of history) falls back to a seq scan, reads 126k to keep 7.5k, 14ms. The slow end is the recent weeks managers view most, and at ~3k people × 2 years it's ~750k rows per request. Fix is a GiST index on `daterange(start_date, end_date, '[]')` queried with `&&` — a schema change, so deferred (schema is fixed input).

## Test review

The first round of tests I drafted lacked several edge cases. Houssem pushed back on them: were they testing real behaviour, what we had agreed, and what the brief says it judges (editing flow; loading, failing and late responses; correctness after a save)? They weren't, fully, so at Houssem's request I audited both ends against that and wrote the missing tests. I checked every new test by breaking the behaviour it covers and confirming it fails.

**Frontend — what was missing** (first draft: cell status, date maths in UTC only, one rollback test):
- Date maths only ran in UTC — the container's timezone — so the local-time bug the UTC helpers exist to prevent could never fail. Now runs under UTC, UTC−10 and UTC+14 (Honolulu parses `2025-12-29` as a Sunday with local dates).
- Nothing covered the reconcile half of "optimistic → refetch": a save that succeeds but where the server returns different numbers. Now asserted, plus the ⚠ and "1 week over" clearing when a save fixes the over-allocation.
- No retry, discard, invalid input, Escape, or "unchanged value sends nothing".
- Nothing on loading/failure: skeleton on first load, keeping the old grid during navigation, load failure + retry, refresh failure keeping the old grid.
- Nothing on late responses. The new test answers the newer request first and the older one last; confirmed it fails against a naive `useEffect` fetch without cancellation.
- Nothing on what the controls send: week shift, the 26-week cap, filter params, and "filtering returns to page 1".

**Bugs the new frontend tests found:**
- A range that failed to load replaced the grid with the full error panel. TanStack v5 drops `placeholderData` once the query errors, so `data` goes undefined. The earlier browser check missed it because it failed a refresh of the *same* range. The grid now keeps the last loaded data and shows the "Couldn't refresh" banner. Side effect: while it shows, the range label says the new range and the columns show the old one — the banner says so, left as is.
- `max={168}` on the input let the browser's native validation block submit before ours ran; managers got a native tooltip instead of the inline message. Added `noValidate`.

**Backend — what was missing** (first draft: validation 400s, curated numbers, weekends=count, over filter, a two-page overlap check, 404, PATCH → capacity):
- Range clipping: bookings straddling `from`/`to` must only contribute days inside the range (Bo's Fri→Mon booking: 8h when the range starts Monday 12 Jan, 32h + 16h weekend when it ends Sunday 11 Jan).
- People with no bookings came back in the count but their cells (0 against real capacity) weren't checked.
- Pagination: walking every page must return all 500 people exactly once. The old overlap check passed even with a non-unique `ORDER BY` — removed it, kept its past-the-end case.
- The 26-week cap at its boundary (26 ok, 27 rejected) and a single-day range → one week.
- The over-allocated filter must follow the weekends rule (146 with weekends counted, not 41) — the reason the filter lives on the server.
- PATCH: 0 and 168 must be accepted (only rejections were tested), oversized bodies rejected.
- DB down: both endpoints return a JSON 500 without leaking connection details (tested with a pool pointing at a closed port).
- Mutations checked: off-by-one on the cap and on the hours bound, unclipped day join, filter ignoring weekends mode, inner join dropping idle people, unstable page order, no body cap, leaking DB errors — each fails at least one test.

## Handover — knowingly left unfinished

- **UI state outside the URL:** only the range is in the URL; the weekends toggle, over-allocated filter and page reset on reload.
- **Over-allocated-only view after a fix:** saving hours that resolve someone's over-allocation removes their row on the refetch. Correct, but abrupt; I'd keep the row (marked resolved) until the user moves on.
- **Failed range load:** the grid keeps the last loaded weeks under a "Couldn't refresh" banner, but the range label above shows the requested range. The banner explains it; a cleaner version would show the loaded range on the label too.
- **Domain gaps (schema is fixed):** no holidays or time off (1 Jan counts as a workday), no per-person work schedules (the weekends toggle stands in for them), no history on `weekly_hours` (edits rewrite past weeks), last-write-wins on concurrent edits (no version column for If-Match).
- **Scale:** 26 weeks × 500 people ≈ 115ms. Levers at ~3k people: computing weekday overlap per assignment instead of expanding days; row virtualisation if page sizes grow. Name search and team filter not built.
- **Range index before any query rewrite:** at ~3k people × 2 years the first lever is a range (GiST) index on `daterange(start_date, end_date)`, since the latest weeks already scan all history (see Implementation). Needs a schema change.
- **API integration tests** run against the shared dev database and restore what they change; they should get a throwaway DB or a rolled-back transaction, and both suites belong in CI.

## Final checks

- **Fresh start:** `make reset` (volume wiped, seed reloaded: 126,195 assignments), web container installs TanStack Query from the lockfile on start; grid shows the same numbers for the five curated people.
- **Light mode** (first time checked): over-allocated cells were a pale pink while "exactly full" was saturated amber, so the eye went to the wrong state first. Light-mode red strengthened (text contrast 5.5:1) so over-allocation is the loudest colour in both themes.
- **Range label after a failed load:** now resolved — while the grid is stale the label reads "Showing <loaded range>", so it always matches the columns (covered by the refresh-failure test).
- **Save flow revised:** the optimistic update no longer copies the capacity rule into the client. It updates only the typed weekly hours, shows that row as recalculating ("45 / …"), and after the save refetches just that person per cached view via `GET /api/capacity?person=` (the over-allocated view refetches whole, since membership can change). A failed save needs no refetch: only the typed value changed. Tests updated and mutation-checked (dropping the row refetch or the rollback each fails a test).
