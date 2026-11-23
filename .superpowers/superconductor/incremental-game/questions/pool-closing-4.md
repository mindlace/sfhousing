# Question pool-closing-4 — from incremental-game-pool-closing
## Question
When a pool is found spent in model month m, and an arrival in month m+1 opens it again, the spec deletes the shut row ("closed and opened in the same month leaves no shut row"). If the calendar month that found it spent was already made final, and its money row already carries `closed: D, shut: true`, what should `MoneyView.shut` and `closed` read for that month? Should an emitted row be rewritten, should the shut row be kept, or should the one `true` stand?

## What the package says
- F3: `shut[id][i]` is true from the calendar month the pool ran out (the month that found it spent) through the last calendar month before it opens again. `MoneyView.closed` is the last row's `closed`.
- §sec-tests-engine: "A pool closed and opened in the same month leaves no shut row." §sec-design-closed: the pool is closed from the first day of the month after it is found spent.
- §sec-design-money: chunks cut on a rewind re-read the history. The spec is silent on a final chunk whose shut row is later deleted with no rewind.

## What I found
- This comes from the final whole-branch review (`.superpowers/sdd/2026-11-22-pool-closing.html/final-review.md:96-108` in the pool-closing worktree), at medium confidence. I have not traced it myself, so it is **unverified**.
- Claimed mechanism, `score/money.ts:37-75` with `columns.ts` `reopenPool`:
  - Model month m ends exactly on a calendar month's last day, so `finalTable` makes that calendar month final after step m.
  - The pool is found spent in m, and is opened by an arrival in m+1, which removes the shut row.
  - The final row keeps `shut: true` and `closed: D`. Later rows read false and null.
- Effect: Details is consistent, because `MoneyView.closed` is the last row, so null. But `funding-measures` would draw one empty bar.
- Reach: rare when `asOf` is mid-month. Common when `asOf` is near a month's end, and only with an added pool whose next span's arrival falls in the very next month.

## Options I see
A. The shut row stays when the closing month was already reported: an opening in the next month sets `shutTo` instead of deleting the row. Engine change in `columns.ts` `reopenPool`, plus a spec line.
B. Accept it as is. One month reads empty, and the pool really was found spent that month. Add a spec line saying so.
C. Defer the finality of a calendar month to one step later when a pool was found spent at its end. This touches chunk finality, outside this unit's model.

## Blocking
None of this unit's tasks. It may matter to `funding-measures` (its pool bars read `MoneyView.shut`).
