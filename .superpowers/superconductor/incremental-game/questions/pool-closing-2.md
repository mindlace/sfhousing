# Question pool-closing-2 — from incremental-game-pool-closing
## Question
With closing on by default, six existing tests inside this unit's write set (`src/lib/sim/world/funding/**`) fail. None compares against the older engine. May this unit change them, and how — switch each to `poolClosing: false`, rewrite it to read the timeline the world steps under, or (for the `pools.spec.ts` guard) allow the closing check to read `inflows`?

## What the package says
- §sec-design-option: "With `poolClosing` false no pool is ever closed … an application waits on a spent pool, as the older engine's does." Only the tolerance referee and `score/money.spec.ts`'s rule-12 comparison are named as running with `poolClosing: false`; `referee-ledger.spec.ts` runs with closing on.
- §sec-design-last / sec-tests-engine: the last arrival is `lastArrivalOf(def, asOf)` on the frame's pool definition, which reads `inflows`.
- §sec-write-set-files lists the changed files; none of the six below is listed. The spec is silent on existing funding specs that pin behaviour closing changes.
- The plan (t3-s5) says: a failing world test that does not compare with the older engine → stop and report; do not loosen an assertion.

## What I found
Report: `.superpowers/sdd/2026-11-22-pool-closing.html/task-3-report.md:123-128` in the pool-closing worktree (implementer's run, not re-verified by me). Closing spec passes 24/24; golden unmoved; referee-ledger and rule-12 pass; 12 tests in these six describes fail, 1291 pass. Work is uncommitted in the worktree.
1. `funding/funded.spec.ts:139` "rule 16: the known limit — an application waits on a spent pool" — `expect(line.n).toBe(4)` got 0: the pool now closes and the rows lapse. Pins exactly the behaviour the spec keeps only under `poolClosing: false`.
2. `funding/policy.spec.ts:440` "rule 16 continued: ending the spent programme" — `was.length > 0` got 0 at month 23; same cause.
3. `funding/policy.spec.ts:653` (random finances 1-120) — `line.viewMonth[i]` got 67, expected 79: the test reads base timeline `t` (`sameMoney(t.frameAt(...))`, `kindClock(s, t, …)`) while the world steps under the closed view.
4. `funding/pools.spec.ts:450` "nothing reads pools[q].inflows" — throws from `lastArrivalOf` ← `closeSpent`. The guard forbids what the spec requires.
5. `funding/retained.spec.ts:74` "six worlds on one timeline … leave the caches one world left" — `{frames:1, memo tables:1}` became 4/4: each seed closes a pool in a different month and touches a different number of base frames; the per-timeline bound (≤ changes + 1) still holds (implementer's claim, unverified).
6. `funding/apply.spec.ts:489` "a kind whose day fell in a month already applied is lost but never hides the other kind" — got `[]`: a closing between the two months replans the lot; the test replans with base `t`.

## Options I see
A. (recommended) 1, 2: run with `poolClosing: false` (they pin the older behaviour the spec keeps under false). 3, 5, 6: run with `poolClosing: false` too — they test serving/caching mechanics, not closing, and closing has its own coverage in `closing.spec.ts`. 4: narrow the guard to allow the closing check's read of the frame definition's `inflows` (spec-mandated), keeping the guard for serving.
B. As A, but 3, 5, 6 are rewritten to read the timeline the world steps under (`timelineOf`) and keep closing on; 5's expectation becomes the per-timeline bound. More faithful, more work, and changes what those tests assert.
C. Leave closing off by default in these fixtures (`runFunded` default false) — contradicts §sec-design-option's default true.

## Blocking
Task 3 (commit), and through it Tasks 4–8 (all depend on Task 3's `closeSpent`/system hooks). Row F3 waits on this.
