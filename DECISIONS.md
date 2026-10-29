# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

- Weekend treatment was unclear so I opted for Monday - Sunday weeks. For capacity, I treated Monday - Friday as working days, following Toggl Focus's default. Weekend hours stay visible separately, with a toggle to count them against capacity because the brief doesn't define work schedules. 
- I put the editor beside each person's name because weekly hours belong to the person. With the fixed schemas, edits also change historical weeks. 
- I update the row optimistically, restore only that person's previous hours on failure, then refetch to reconcile with the server. I keep the typed value and show an inline error with a retry button. 
- I return weeks once, with each person's cells aligned to them. I send capacity per cell so future holidays or schedule changes won't need a different response format. 
- I chose server-side pagination and an overallocated filter so overloaded people aren't hidden on other pages. Requests are capped at 26 weeks; longer history requires smaller ranges.

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- The seed's repeated rows looked like duplicates at a first glance but they are booking fragments. I ended up considering them in the sum because dedupe would undercount hours.
- I checked Ana at 40/40 (56/40 with weekends), Dee at 45/40 and Eli at 20/0 (note the 0 at the end. Undivisable). I show Eli as overloaded without dividing by zero. 
- Save errors took about eight seconds to appear because they waited for the refetch retries. I removed that wait. 
- I kept the previous grid when a new range failed, but its label showed the requested dates. I changed the label to show the loaded range. 
- In light mode, exactly full cells stood out more than overloaded ones. I strengthened the red after looking at the grid.

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

- The AI's first test pass checked rollback but did not test whether a successful save reconciles different values returned by the server. I challenged whether the tests covered the agreed flow and the brief, and asked for an audit. That missing case is now covered.

## What would you do differently with a week?

- I'd keep resolved people visible briefly in the filtered view, and put the remaining controls in the URL. 
- Current benchmark timings only cover 500 so I'd benchmark 3,000 people. I'd also isolate the integration test database and run both suites in CI. 
- I'd work through holidays, individual schedules, capacity history and concurrent edits with the team.
