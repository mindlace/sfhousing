# Question finite-funding-2 — from incremental-game-finite-funding

## Question
The spec says an older dataset's federal pool, read as one yearly inflow of `LEGACY_UNCAPPED_DOLLARS` ($100 billion), "never binds: such a policy plays as it did". Task 4's tests show $100 billion a year can bind: on the synthetic test city, a year's federal asks pass $100 billion and first-day applications wait (118,993 of them). Can a published older policy reach that, and if so what should `LEGACY_UNCAPPED_DOLLARS` be (or what rule replaces "never binds")?

## What the package says
- §sec-design-pool-types (spec line 603): "`model.ts` exports `LEGACY_UNCAPPED_DOLLARS = 100_000_000_000` and `isNoCeiling(dollars)` … true when `dollars >= LEGACY_UNCAPPED_DOLLARS`."
- Spec line 608: "In the engines an older dataset's federal pool receives $100 billion a year from the dataset date and never closes, so it never binds: such a policy plays as it did."
- Spec line 680 (§sec-design-reach): fixtures' uncapped pool gets a yearly 100_000_000_000 inflow "which no test reaches".
- Spec line 113 (F2 row): the loader "never refuses the calibration".

## What I found
- Task 4 review: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game-finite-funding/.superpowers/sdd/2026-11-22-finite-funding.html/task-4-review.md` (Important 1). Implementer report `task-4-report.md` concern 5.
- `src/lib/sim/scenario/engine-finance.spec.ts:438-442` (at 962bd406): the "unlimited money" test needed 10^15 a year; at 100 billion a year 118,993 first-day applications wait on synthCity (implementer's run; not re-run by me).
- Reviewer's reasoning (unverified by me): added pools go up to `MAX_DOLLARS` (100 billion each) and added programmes may sit on baseline pools, so a published policy that makes City and state money effectively unlimited makes the federal pool the binding limit; the threshold also equals `MAX_DOLLARS`, which is what `isNoCeiling` compares against (Tasks 3, 5, 7: "No ceiling" display). Whether the live SF dataset's federal asks in any year can approach $100 billion was not checked: unexamined. Rough scale (unverified inference): federal asks are $443,108 per home, so $100 billion a year is about 225,000 funded homes a year.

## Options I see
1. Keep $100 billion; reword line 608 to "binds only past about 225,000 federally funded homes a year, which no SF policy reaches" (needs a check of the live dataset's worst case, which I can run as a test on fixture-0 only, not live).
2. Raise `LEGACY_UNCAPPED_DOLLARS` (e.g. 10^15, as the synthCity test uses), keep "never binds"; `isNoCeiling` then no longer equals `MAX_DOLLARS`, so a 100-billion added pool is not "No ceiling". Precision: sums past 2^53 (~9×10^15) lose exactness; 10^15 a year over 40 years is 4×10^16 received — past 2^53.
3. Keep the value and accept that an extreme older policy may play differently; say so in the docs.

## Blocking
Nothing held now. Tasks 5-7 write their tests through the `LEGACY_UNCAPPED_DOLLARS` constant, so a value change lands as a later fix round (Task 3's constant, its tests, the docs) without rework. If the ruling changes the rule rather than the value, Tasks 5 and 7 (the "No ceiling" display and `levelSet`'s skip) may need a fix round.
