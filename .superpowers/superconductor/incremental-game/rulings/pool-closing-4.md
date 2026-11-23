# Ruling pool-closing-4
Package commit: 35fcb904
Changes design: yes
Changes contract: no
## Ruling
The shut history only grows. A closing adds a `shut` row and an opening sets that row's `shutTo`. No row is ever removed. A pool found spent in model month m and opened by an arrival in month m + 1 keeps a row whose `shutTo` equals its `shutFrom`.

That row closes no month: a month's closed set needs `shutFrom ≤ monthFirstDay(asOf, k) < shutTo`, so no frame leaves out the pool's programmes and nothing about the engine's awards changes. The row records that the pool was found spent in month m.

The money view stays a function of a history that never rewrites the past, so a calendar month already made final reads the same after every later step. For such a pool:
- `MoneyView.closed` holds the row's `shutFrom`, and Details lists "{label}: ran out {Mon YYYY}". The pool did run out under the policy then in force.
- `shut` is true only in the calendar month that holds the last day of model month m, and only when that calendar month ends on that day. That is F3's rule exactly: true from the month that found it spent through the last calendar month before it opens again.
- When model month m ends mid-calendar-month, the pool opens again in that same calendar month, and `shut` is false everywhere.

The one empty bar that `funding-measures` draws in the month-end case is correct, and nothing else changes for that unit. F3's interface text is unchanged.

The code change in pool-closing: `reopenPool` in `src/lib/sim/world/funding/columns.ts` sets `shutTo` and `closedDay = NO_DAY` and never deletes the row. The test "a pool closed and opened in the same month leaves no shut row" becomes the test in § sec-tests-engine. The closed view's cache signature already includes `shutTo`, so a zero-length row gives a view with the same frames.
## Re-read
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-design-reopen
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-tests-engine
## Affected units
- pool-closing: clarification (a fix round: `reopenPool` keeps the row, and its test is rewritten as in § sec-tests-engine; approach and interfaces stand)
## Build graph
- pool-closing
