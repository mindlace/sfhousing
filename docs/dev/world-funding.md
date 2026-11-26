# World funding

Public money in the month-step engine: `src/lib/sim/world/funding/`. It plugs into world-core's
`FundingSystem` hook (see [world-core.md](world-core.md), "The funding hook") through
`createFundingSystem()`. Lots apply for money in the month their funded clock passes, the line is
served once a month, and each money event of an awarded project is written at the project's own
stage event. Spec:
[2026-11-13-world-funding-design.md](../superpowers/specs/2026-11-13-world-funding-design.md)
(rules 1 to 21). The old engine's code (`scenario/funded.ts`, `line.ts`, `funding.ts`, `money.ts`)
is imported, never changed; rules defined by unexported code (`segValue`, `fundingOf`, `remake`,
`respell`) are written again here and held by the tests.

## Files

| File             | What                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `system.ts`      | `createFundingSystem()`: the hook methods, each a thin call into the files below.                                                                            |
| `columns.ts`     | `FundLine`, `FundPools`: the line, spell and shadow tables, the pool counters and money rows; `initFunding`, `fundOf`, row helpers.                          |
| `clocks.ts`      | The market and affordable funded clocks of a free lot (rules 2 to 5, 7), the size in a view (`sizeIn`). Nothing stored.                                      |
| `apply.ts`       | `planLotMonth` (the hook's `planLot`), `applyLots`, `joinLine` (rule 9 order), `remakeRow` (rule 17), `leaveLine` (rule 8), `fundableAny`, the rowless memo. |
| `serve.ts`       | `serveLine` (rule 10, grouped by default), `awardDay` (rule 11, T17), `fundedStartOf`; `awardRow` is the one award site.                                     |
| `pools.ts`       | `moneyIn` (rule 12), `commitAward`, `moneyOnEvent` (rule 13), `availableOf`.                                                                                 |
| `closing.ts`     | `closeSpent`, `reopenArrivals`, `lastArrivalOf`, `closedTimeline`: pool closing (below).                                                                     |
| `policy.ts`      | `policyChanged` (rules 17 to 19): re-make or lapse each waiting row, respell, plan again.                                                                    |
| `shadow.ts`      | `shadowAward`, `stepShadows` (rule 20), then the line's (amortized) compaction.                                                                              |
| `frame-money.ts` | `frameMoney` (one frame's offers, bundles and money key, memoised per timeline and frame id), `sameMoney`.                                                   |
| `line-index.ts`  | Indices of the line kept outside the world (by lot, by award group), keyed by `FundLine` in a `WeakMap`; `compact` (amortized).                              |
| `test/`          | `fixtures.ts` (browser-safe: mini city money, `runFunded`, `moneyTimeline`, `benchMoney`), `cities.node.ts` (Node), `identities.ts`.                         |

## The columns

`World.line` is a `FundLine`, `World.pools` a `FundPools` (`columns.ts`); both are filled by
`initFunding` at `create` (or at the first funded hook when money starts after month 1). Every
column is a typed array or a `string[]`. Between steps a programme or pool is named by its id:
`bundle` and `mProg` hold programme ids (a bundle joined with `','`), `id` and `mPool` pool ids.
Frame indices exist only inside a step (`frameMoney`, `rowOf` in `serve.ts`).

**Line rows** (one per waiting application, in line order): `lot`, `kind` (0 market, 1
affordable), `month` (model month applied, rule 9's first key), `applied` (day), `keyDay`
(Int32, capped at `NEVER_KEY_DAY`), `key` (`lineKey`), `bundle`, `f`, `units`, `stories`,
`level`, `viewMonth` (whose view gave the size), `gone` (1 = left the line), `seq` (ascending along
the line, kept by compaction). Line scalars: `n`, `nextSeq`, `version`, `appliedThrough` (the last
month whose `apply` ran). Side tables on the line: spells (`spellLot`, `spellKind`, `spellK`,
`spellR`, sorted by lot then kind: a respelled kind's attempt and the day before its new spell)
and shadows (`shadowLot`, `shadowRow`, `shadowK`, `shadowR`, `shadowExisting`, `shadowMonth`).

**Pools**: one row per pool id (`id`, `received`, `committed`, `spentGrant`, `outLoan`,
`lostLoan`, `lostGuarantee`, `moneyDay`, `moneyMonth`: the latest money that reached it;
`closedDay`: the first day the pool is closed, `NO_DAY` while open), and one
money row per (awarded project, paying programme) with events still to come, by project row
ascending (`mRow`, `mProg`, `mPool`, `mInstr`, `mGrant`, `mLent`, `mReserve`, `mGuaranteed`,
`mLoss` = the award frame's `terms.lossOnExit`).

**Shut rows** (`FundPools`, one per time a pool closed, oldest first; `shutN` rows): `shutRow` (the
world pool row), `shutFrom` (the first day closed, a model month's first day), `shutTo` (the first
day open again, a model month's first day, or `NO_DAY` while closed). `addShutRow` opens a row and
sets `closedDay`; `reopenPool` closes it with `shutTo` and clears `closedDay`. No row is ever
removed, one whose `shutTo` equals its `shutFrom` included.

**`version` and the caches.** `line-index.ts` and `frameMoney` keep caches in `WeakMap`s outside
the world; a `structuredClone` is a new object and builds its own, so clones stay exact. The line
index is valid while its `version` equals `line.version`. `addLineRow`, `compactLine`, `joinLine`,
`leaveLine` and `policyChanged` bump it. **Any writer of line row columns bumps `version` after
writing**, or the index goes stale silently (a write without a bump is not detected).

## How the rules map to code

- **Clocks over frames** (rules 2 to 4): `kindClock` evaluates a kind's total over the frames the
  lot has lived through since its spell began, then the current frame continuing, as world-core's
  `ordinaryStart` does (segments merged as `rates.ts` merges them). Recomputed on demand, never
  stored. A kind none of the frames it reads can fund has no clock (`fundableAny`): in each
  frame the kind is not offered, its chance is nil, or the lot's largest size is below the least
  `minHomes` offered. Every segment's rate is finite: the bundle's shift is `cappedShift`
  (coverage above 1 shifts as coverage 1), and a fully funded bundle has no `−Infinity` rate and
  no first-day rule; its day is drawn in the lot-month like any other (funding award rule, R2).
- **Spent spells** (rule 5): a total that passes in a lot-month whose bundle is empty spends the
  spell; planning again never makes it apply later. `appliedThrough`: a kind whose day falls in a
  month whose `apply` already ran is lost (it counts as 0), without hiding the other kind.
- **Key day** (rule 7): the first day of the lot-month in which the ordinary (market) or unshifted
  affordable total passes, evaluated when the lot applies; `NEVER_KEY_DAY` when never.
- **Line order** (rule 9): `joinLine` appends a month's applications after every waiting row, in
  key order. Order is (month applied, key); `applied` orders nothing.
- **Once-a-month scan** (rule 10): `serve` runs once after the month's applications joined; money
  that moves after it waits for next month. Money returned during the scan (a release or repayment
  by an award's chain) waits for next month's scan too, and does not set the pool's money day;
  commits and losses apply at once (`holdingReturns`, `heldOf` in `pools.ts`). Grouped serving (rule 1's decision): per award group
  (kind, bundle, market prototype) the largest passing size H, then the earliest member at most H
  in line order, confirmed with `awardPasses`; every H is dropped after an award.
- **Award rule** (rule 16 as amended 2026-11-25): `awardSet` and `awardPasses`
  (`scenario/funding.ts`) leave every programme of a short pool out, in rounds, and award what is
  left when it is not empty and its level is above 0, so a spent or short pool never keeps an
  application waiting while other pools can pay ([finance-engine.md](finance-engine.md), The award
  rule).
- **Award day T17** (rule 11): `awardDay` is the later of `applied` (this month) or the month's
  first day, and the latest money day this month of any pool the award asks.
- **Every pool pays only from what it received** (rule 12): `availableOf` (`pools.ts`) is
  `leverage × received − committed − spentGrant − outLoan − lostLoan − lostGuarantee` for every
  pool, the federal pool included; it has no infinite case. The money track
  (`policy/money.ts`) makes arrivals for every pool of the frame, and a release or repayment to
  any pool of the frame is returned money (rule 10).
- **Money events at stage events** (rule 13): `moneyOnEvent` writes spend and lend on entering
  construction, repayment on completion, release or loss on dropping out, with today's amounts and
  `LedgerEvent`s.
- **Respell on the month's first day** (rule 18): a lapsed kind's spell starts on the month's first
  day on the same draws; its lot is planned again (`planAgain`).
- **Shadows** (rule 20): `shadowAward` records the lot's attempt and free day before the funded
  start; `stepShadows` re-evaluates a shadow only in a frame-change month, and in the month holding
  its ordinary start day calls `displace` once. Nothing cancels a shadow.

### Readings accepted by the conductor

- **Funded starts are made only in `serve`.** `startProject` returns `world.projects.n` read just
  before the call, that row complete before any chain event; `serve` predicts it, commits the
  money rows first and asserts the returned row.
- **`'award'` comes after the started chain's events** (the chain is emitted inside
  `startProject`). World-score reads the award by row, not by position.
- **`FundLine.appliedThrough`** (rule 5): a kind whose application day falls in a month whose
  apply already ran is lost, without hiding the other kind; path-independent of replans.
- **The lazy done-lot guard** (rule 8): a lot that is no longer free has its rows dropped only
  when one of them would be awarded. On a policy change they leave the line; they are never
  respelled or replanned (lapse and replan never `due.put` a lot that is not free).
- **Remake on join**: an application whose lot-month began before a money change and whose day
  falls after it is re-made (or lapses) as it joins, since it waits under the new frame.
- **Ledger order across projects** follows the core's event order; compare ledgers per project.
- **`'displaced'` units** use the lot's existing homes recorded at the award (`shadowExisting`),
  not the view `startRow` reads at the ordinary start.

## Hook calls by system

| System   | Hook             | Funding work                                                                                                  |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| create   | `create`         | `initFunding` with the frame's pool ids.                                                                      |
| before 1 | `beforeStep`     | `reopenArrivals`, then the timeline the step runs under (`closedTimeline`).                                   |
| 1 policy | `policyChanged`  | Unless view and money identity (`sameMoney`) are unchanged: re-make or lapse.                                 |
| 2        | `moneyIn`        | The frame's `finance.arrivals` into the pools (rule 12).                                                      |
| 3, 5, 6  | `onProjectEvent` | `'start'` of an ordinary lot start: its rows leave the line. Else money events.                               |
| 4        | `apply`          | The due lots' applications, joined in key order; `appliedThrough`.                                            |
| 5        | `serve`          | Grouped scan, awards (`startProject` with a `FundedStart`), `'award'`, then the closing check (`closeSpent`). |
| 7        | `shadow`         | Shadow starts and `'displaced'`, then the amortized compaction.                                               |
| any      | `planLot`        | The first month the lot applies, or 0. Pure (it may build caches).                                            |
| planning | `timelineOf`     | The timeline `planDue` plans under (`closedTimeline`); changes nothing.                                       |

**Compaction** (`line-index.ts` `compact`, perf): a line of `COMPACT_MIN` (1024) rows or more is
compacted only once an eighth of it is `gone`; a shorter one whenever it holds a `gone` row. So
`gone` rows may survive a step on a long line; every reader skips them. The count comes from the
index (rebuilt from columns when stale), so a clone compacts in the same months.

## Pool closing

A pool that has received its last arrival and cannot pay a waiting application is closed: the
world then steps and plans as if the pool's programmes were switched off. Spec:
[2026-11-22-pool-closing-design.html](../superpowers/specs/2026-11-22-pool-closing-design.html).
`closing.ts`.

**The last arrival** (`lastArrivalOf(pool, asOf)`): the last day the frame's pool definition
receives money, from `inflowArrivals` over each inflow with dollars above 0 (a `once` inflow's
day, a `yearly` inflow's last anniversary up to its `to`); `NO_DAY` when no arrival falls on or
after `asOf`; null when a `yearly` inflow with dollars above 0 has `to: null` (the pool never
stops). Memoised per pool object and `asOf`. It reads the definition's `inflows`, the one read of
them (`pools.spec.ts` guards that nothing else reads them).

**The four conditions** (`closeSpent`), judged per pool of the month's frame in world pool row
order, cheap ones first. The pool closes when:

1. it is open (`closedDay` is `NO_DAY`);
2. the month begins after its last arrival (`last` not null and before `ctx.firstDay`);
3. no money row of it is a loan or a guarantee (no loan out, no reserve held);
4. some waiting row of a free lot, whose bundle (as the frame offers it whole) holds a programme
   of the pool, asks it more than 0, and no such row asks it for serving's available money or
   less (`asksOf` for the whole bundle; `spentAmong`: one ask that fits holds the pool open).

**Where the check runs.** In system 5, inside `serveLine`'s `holdingReturns`, after the scan's last
row (`serveLine(ctx, { closing })`): money returned during the scan has not reached the pool, and
the pool is judged against the money the scan held out. The closed day is `ctx.lastDay + 1`: the
next month's first day. In the month of its last arrival a short application closes nothing.

**The `shut` history.** `closeSpent` calls `addShutRow(pools, q, closedDay)`; the pool's
`closedDay` is the open row's `shutFrom`. A pool opened again keeps its row with `shutTo` set. The
history only grows: a closing adds a row, an opening sets that row's `shutTo`, and no row is
removed, so the money rows of a calendar month already final read the same after every later
month. A pool found spent in month m and opened by an arrival in month m + 1 keeps a row whose
`shutTo` equals its `shutFrom`: it closes no month (a month's closed set needs
`shutFrom ≤ monthFirstDay(asOf, k) < shutTo`) and adds no change month to the view, and records
that the pool was found spent in month m. The columns are in the world, so a `structuredClone`
carries them and a rewind needs nothing more.

**The closed view** (`closedTimeline(timeline, pools, asOf)`): the base timeline with, in each
month whose first day falls in a shut row, the programmes of the closed pools offered 0 (a frame
with a new id from the base's id and the closed ids; the other programmes are unchanged). Its
`changes()` are the base's plus each month where the set of closed pools of the frame changes;
`touched(k)` is the base's at a base change and empty at a closing or opening month; the core
still replans every free lot there, because money is in force (`world.ts`). `readyThrough` is the base's. It is the switched-off path: the world's
`policyChanged` re-makes each waiting row whose bundle held the pool without it, or lapses the
row, exactly as a policy that switches the programmes off does. Views are cached per timeline by
the shut rows' signature (the same object while the history is unchanged); with no shut row it is
the timeline itself. `beforeStep` hands the step this view and `timelineOf` hands it to `planDue`,
both through `withFunding` (`world.ts`).

**Opening again.** `reopenArrivals(world, statics, timeline)` runs in `beforeStep`, before the
view is taken: for each arrival of the base frame of the month about to step with dollars above 0
whose pool is closed, `reopenPool` at the month's first day. The month then steps with the pool's
programmes offered; it can close again later. Nothing runs past `timeline.readyThrough()`.

Money returned to a closed pool (a release or repayment) is booked as usual and stays in it: no
offered programme draws on it, so it is never awarded, and it does not open the pool.

**Edits and rewind.** Closing reads only the world and the frames; it draws nothing. A pool whose
last arrival changes because the policy changed is judged again from the month the change takes
effect: an edit that gives a pool a later arrival before it closes keeps it open (condition 2
reads the current frame), and a closed pool that receives a new arrival opens from that arrival's
month. A restore to a month before a closing re-steps and closes it again in the same month; an
edit after it keeps the history.

**`WorldOptions.poolClosing`** (default true; `createFundingSystem(opts)`): false makes
`serveLine` skip the check, so no pool closes. `runFunded` (`test/fixtures.ts`) takes
`poolClosing`. The specs that test serving, re-making and caching on the base timeline run with it
false: `funded.spec.ts`'s rule 16 as amended, `policy.spec.ts`'s rule 16 case and random
finances, `retained.spec.ts`'s six worlds and `apply.spec.ts`'s kind whose day fell in an applied
month.
`closing.spec.ts` holds closing itself; `referee-ledger.spec.ts` runs with closing on, since
closing moves no money.

## Rule 1's measurement (Task 1)

Decision: **grouped serving** (8a); per-lot rate tables (8b) are not built. Measured 2026-11-13,
quiet (lock held), seeds 1 to 5, months 1 to 480, from the old engine's kernels on its own runs.
Bench city = `synthCity` with the bench finance; live = `2026-11-10-6ee5a23d`.

| µs per world-month, p90          | synthCity | live  |
| -------------------------------- | --------- | ----- |
| Direct line scan                 | 18,409    | 1,823 |
| Grouped scan                     | 0.8       | 0.7   |
| Direct rates                     | 3.8       | 0.4   |
| Estimate, direct rates + grouped | 9.6       | 6.0   |

- Month 1 burst (the opening wave applies: 19k applications on synthCity, 2.3k live): rates cost
  **5.4 ms per world** on synthCity (2.7 ms with tables), **0.6 ms** live. Not held to the budget;
  the runner slices it.
- Whole-city replan, eligibility-gated, direct: **11.1 ms** synthCity, **3.5 ms** live; ungated
  upper bound (both kinds on every candidate) **49.6 ms** and **43.0 ms**.

The numbers above are the record of this measurement.

## Cost

`funded-month.perf.spec.ts`, perf project, under the measurement lock:

```
npx vitest --run --project perf src/lib/sim/world/funding/funded-month.perf.spec.ts
```

synthCity with its bench baseline money (`benchFunded('baseline')`), seeds 1 to 8 stepped untimed
to month 120, then months 121 to 240 timed one `step` at a time per world (the whole step: core
and funding). Bar: **mean at most 90 µs per world-month** (the 9 ms constraint is a sum over two
worlds, the plan's and its twin's; the per-world-month bar is unchanged). It also prints each hook's share and the whole-city replan month, unasserted.

Task 8 (synthCity, bench baseline money; hooks only, months 2 to 120, quiet, lock held), after
grouped serving, the line index and the lazy guard: serve mean 9.1 to 13.0 µs, apply 3.9 to 9.6,
planLot 50.4 to 57.7 (about 48 calls a month), their sum 65.0 to 79.0 (p90 88.0 to 102.4);
compaction 50 to 100 µs outside the sum. Month 1: serve 0.16 to 1.4 ms, apply 28 to 34 ms, planLot
26 to 32 ms. Before grouping, the direct serve was about 21 ms per month.

Task 12, 2026-11-13, synthCity, quiet (lock held):

| µs per world-month                | p50        | p90         | mean            | max     |
| --------------------------------- | ---------- | ----------- | --------------- | ------- |
| Whole step, compaction every step | 154.8      | 196.4       | 161.6           | 604     |
| Whole step, amortized compaction  | 99.3–100.8 | 130.5–132.1 | 105.8–107.2     | 747–814 |
| Whole step, plus eligibility skip | 98.4–99.0  | 132.3–135.0 | **104.3–104.7** | 627–709 |
| Plus eligibility before spells    | 99.8–102.6 | 138.0–147.0 | 107.9–111.9     | 664–716 |

The last row's window was noisier: the core's share, whose code did not change, read 71.7–73.6
µs in it against 61–63 µs before, so that row says nothing for or against the change on an
ordinary month (planLot 30.2–30.5 µs either way: most lots that reach `planLot` in an ordinary
month are fundable).

Split (hooks wrapped, both perf changes, two runs): core alone mean 61.0–63.2, planLot 27.6–31.2
(42.1–44.8 before the eligibility skip), onProjectEvent 13.1–13.5, serve 6.6–6.7, apply 3.6–3.7,
shadow and compaction 0.5 (50.5 before amortizing), moneyIn 0.1–0.2. **The bar misses** (mean
about 104.5 µs); the core's own share is about 56 to 63 µs.

The whole-city replan month (a frame change at month 121 on a timeline otherwise the same): about
146k `planLot` calls per world (every free lot: world-core's skip shortcut spares only the
ordinary clock, and the hook cannot see the due list's `through`): 133 to 137 ms per world before
the eligibility skip, 57 to 61 ms with it, and **47.8 to 57.7 ms** with eligibility checked before
spells (the noisier window above), against Task 1's 11.1 ms gated estimate and the 50 ms slice.

**Eligibility before spells** (`clocksOf`): each kind's eligibility is read on its spell start
alone (the lot row's free day, or the respelled day from the spell table, without the stream); a
lot neither kind can fund gets no spells and no stream. `eligibility.spec.ts` checks `planLot`'s
answer is the same with and without it over a whole-city replan month (synthCity, bench set).

**Eligibility skip** (`apply.ts` `fundableAny`): a kind gets no clock when no frame its spell
reads (the segments `kindClock` walks) has money offering the kind, gives the lot a chance
(`logit` not -Infinity) and offers a least `minHomes` the lot's largest size in that view meets:
today's `eligibleOf` (`funded.ts:232-256`) per frame, per lot, on offered programmes. Exact,
since such a clock has no day and callers read only the day; `eligibility.spec.ts` holds it.

### Funded planning (the rowless memo, `bundleOf`, no per-call closures)

Most of a funded `planDue` or replan month was `fundableAny` on lots no frame can fund (live
`2026-11-10-6ee5a23d`: 151,810 of 154,391 `planLot` calls in one `planDue`). Three changes, no
change to world-core's hook, results identical:

- **The rowless memo** (`apply.ts`, `rowlessBits`). For a free lot with **no lot row** (free since
  the dataset date, attempt 0), `fundableAny(ctx, asOf, kind, lot)` reads only the timeline, the
  month and the lot's static data: the frame of `first = min(monthOfDay(asOf, asOf + 1), month)`
  and of each change in `(first, month]` (their view's chance and yields, their money's offers and
  least `minHomes`). No draw, no seed, nothing of the world: the same answer in every world of the
  timeline. **Keyed on** the `PolicyTimeline` object (a `WeakMap`), then on `(asOf, lot count,
first, last)`, `last` being the latest change in `(first, month]`: those fix the frames read. A
  `Uint8Array` per key, a byte per lot (asked, market fundable, affordable fundable), filled
  lazily. **Invalidated by** nothing within a timeline's lifetime: its frames up to the ready
  month never change; a new timeline object gets a new memo. It lives outside the world, so a kept
  copy (`structuredClone(world)`) never carries it. **A lot with a row never reads it**: its own
  free day and attempt (`r`, `k`) and its existing homes (demolished) differ, so it takes the path
  above unchanged. A rowless lot respelled after a lapse (rule 18) starts later; the frames
  `fundableAny` reads from that start are a subset of those it reads from `asOf`, so the memo is
  read for it only as "not fundable" and "fundable" is checked again from the respelled start.
  **Memory**: a byte per lot per (first month, last change read) met; live, a timeline with no
  change 155,020 bytes, with one change 310,040 (2 tables).
- **`bundleOf`** (`frame-money.ts`) answers from an array per kind indexed by units, capped at the
  largest `minHomes` offered (rounded up), instead of a string-keyed map; the same canonical
  arrays.
- **No per-call closures** in `fundableAny`, `clocksOf`, `spellsOf` and `kindClock`: a toolchain
  with esbuild `keepNames` (tsx) wraps each closure made per call in `__name`, about 3.4 times the
  cost of the bundled code.

`memo.spec.ts` holds the results: events and ledger (an FNV hash) equal the hashes recorded from
the build before the change, memo on and off, on synthCity seeds 1 and 2 (baseline money and the
bench set) and live seeds 1 to 3 (`SFH_WORLD_LIVE`), each `createWorld`, `planDue` through 480
and 130 steps with every free lot replanned at month 120. On the mini city it runs a money
timeline with a programme switched off and on, and a compiled timeline (`compileTimeline`) whose
money changes three times and whose zoning changes at month 30 (a painted policy touching lots):
events, ledger and world equal memo on and off, every memo answer agrees with `fundableAny`, and
lots with a row and respelled rowless lots are both met. The 200-seed referee (retired on 2026-11-25,
below) gave the table below unchanged.

2026-11-13, quiet (lock held), one process per row, Node v24 on an Apple M5 Pro; "bundle" is an
esbuild bundle without `keepNames` (as a Vite build); "vitest" the perf project. The change month
is month 120 after a market step (+0.25 from month 120: every free lot replanned). The
96-world and 48-world rows were taken with 48 + 48 worlds on 2026-11-13; `/sim` now runs one world per side.

| Measurement                                            | bundle before | bundle after | vitest before | vitest after |
| ------------------------------------------------------ | ------------- | ------------ | ------------- | ------------ |
| live, funded `planDue` per world, median ms            | 15.0          | 5.8          | 27.6          | 8.0          |
| live, 96 worlds' `planDue`, ms                         | 1,484         | 591          | 2,682         | 799          |
| live, change month per world, median ms (48 worlds)    | 26.8          | 6.7          | 40.6          | 8.7          |
| synthCity baseline, world-month mean µs (bar 90)       | 75.8          | 79.3         | 87.1          | 83.1         |
| synthCity bench set, `planDue` per world, median ms    | 109.3         | 72.8         | 158.3         | 120.4        |
| synthCity bench set, change month per world, median ms | 157.1         | 120.5        | 215.8         | 172.0        |
| synthCity bench set, world-month mean µs               | 222.0         | 208.3        | 272.6         | 256.1        |

With the bench set (rich money: most lots fundable for both kinds) the memo has little to skip;
`planDue` (72.8 ms) and the change month (120.5 ms) stay over a 50 ms unit from the bundle. The
`StepCtx.through` bound (the planning proposal) is what would cut them further; it is a change to
world-core's hook, not taken here.

### Memory per world

What funding keeps outside a world is per **timeline object**: the rowless memo and `frameMoney`
(`WeakMap`s keyed on the `PolicyTimeline`). The line index is per world (keyed on its line), the
size table per view. So a host shares one timeline object across the worlds of an ensemble and one
funding system may serve them all; a timeline wrapped per world gets its own caches (on live about
1.3 MB per world, most of it outside funding).

Live `2026-11-10-6ee5a23d`, `DEFAULT_POLICY4` compiled (no change in 480 months), worlds stepped to
month 480 on one timeline, heap plus array buffers after a forced GC, per world: 4.25 to 4.50 MB
before the memo and after it alike (1, 8 and 48 worlds; world 2.2 MB of typed arrays, due list
0.6 MB). The memo adds 155,020 bytes per timeline, nothing per world.

A rise from +428 MB to +701 MB in ensemble-runner's measurement (96 worlds, 48 + 48, 2026-11-10, no copies kept) was not
the memo: the script's last dropped copy (`structuredClone` of every world at month 480) stayed
reachable from a dead local in the measuring function, depending on how V8 compiled it. Both builds
give either figure from run to run; with the copy taken in a function of its own both give
+427.5 to +427.7 MB every run.

`retained.spec.ts` guards it: six worlds on one timeline, each with its own funding system, leave
the memo's tables and `frameMoney`'s frames as the first world left them, within a table of a byte
per lot per (first month, last change read); a world and its due list hold the same typed-array
bytes with the memo on and off.

## Tests

All in `src/lib/sim/world/funding/`. Server project (signoff) unless noted.

- **Units**: `columns`, `clocks`, `frame-money` (`sameMoney` agrees with `policy/money.ts`),
  `apply`, `serve` (line order, award day, the done-lot guard), `pools` (rule 12, money events),
  `policy` (rules 5, 17 to 19, off pools, raised arrivals), `shadow`, `compaction`, `eligibility`,
  `memo` (the rowless memo and `bundleOf`: results as recorded, memo on and off; above),
  `retained` (caches outside the world per timeline, not per world; above).
- **End to end** `funded.spec.ts`: E1 to E7 after every step on 200 random finances (mini city),
  rule 21, rule 14, rule 16, `structuredClone`, a permuted lot table, the money series I1 to I5
  (E6 and I6 are retired: every pool receives its arrivals).
- **Bounds** `bounds.spec.ts`: fixture-0's pools receive what their bounds give over 480 months
  (the last arrival of each ending pool, none for a pool with no programme, arrivals to the end
  for the continuing ones); on the older-format calibration the federal pool (ten trillion a year)
  never falls below 99% of it and no waiting row is short on it, also with it switched off for
  months 13 to 24.
- **Closing** `closing.spec.ts`: `lastArrivalOf`, the four conditions, the closed day and `shut`
  rows, equality with a switched-off pool, re-make and lapse, opening again, `closedTimeline`,
  `poolClosing: false`, grouped and direct serving, clone and restore.
- **Remedies** `remedies.spec.ts`: grouped serving equals the direct scan (events, ledger, world),
  warm and cold caches equal across a clone.
- **Golden**: `funded.golden.test.ts` (server) and `funded.golden.svelte.spec.ts` (client) against
  `fixtures/funded-events-mini-seed1.json`. Regenerate deliberately, never from signoff:
  `env -C <worktree> node_modules/.bin/tsx src/lib/sim/world/funding/fixtures/build-funded-golden.ts`.
- **Ledger identities in signoff** `referee-ledger.spec.ts`: E1 to E7 after every step to month
  480, seeds 1 to 3, on synthCity (baseline money and the bench set) and fixture-0 (baseline).
- **Tolerance referee**: retired on 2026-11-25 (below).
- **Perf** `funded-month.perf.spec.ts` (above).

## Tolerance referee (retired)

Until 2026-11-25 `tolerance.referee.spec.ts` ran this engine and the old scenario engine
(`scenario/funded.ts`) over seeds 1 to 200 to month 480 and compared net homes, awards and funded
homes at years 5, 10, 20 and 40; `score/money.spec.ts` held a per-seed comparison of the two
engines' money ("rule 12 against today's engine"). Both were retired with the fallback award
(rule 16 as amended, [the spec](../superpowers/specs/2026-11-25-funding-award-rule-design.html)),
by the owner's decision of 2026-11-25: the old engine no longer runs in production (`/sim` runs
this engine; no client sends `initScenario`). Under the fallback award a partial award is not
certain and may exit, and the two engines then differ by construction: this engine serves once a
month with the month's arrivals in (rule 10, T17) and re-applies a lot freed after `apply` only
from the next month, where the old engine serves and re-applies day by day. The measured residual
before retiring: synthCity baseline net mean r 0.0134 at year 5 (tolerance 0.01); rule 12 equal
money on 32 of 50 seeds (record 49). The old engine's own tests and goldens stay. The table of the
last passing run (2026-11-13, before the fallback award) is kept for the record:

| Case                | Year | net new  | net sd  | net old  | old sd  | mean r | sd r  | awards new | awards old | aw r  | funded new | funded old | fu r  |
| ------------------- | ---- | -------- | ------- | -------- | ------- | ------ | ----- | ---------- | ---------- | ----- | ---------- | ---------- | ----- |
| synthCity baseline  | 5    | 85201.8  | 3914.6  | 85203.0  | 3915.1  | 0.0000 | 0.000 | 24.64      | 24.59      | 0.002 | 4653.5     | 4653.1     | 0.000 |
|                     | 10   | 196535.8 | 7447.0  | 196536.0 | 7446.9  | 0.0000 | 0.000 | 39.97      | 39.93      | 0.001 | 7770.2     | 7770.3     | 0.000 |
|                     | 20   | 411972.3 | 11924.0 | 411982.1 | 11921.5 | 0.0000 | 0.000 | 78.14      | 78.09      | 0.001 | 15572.0    | 15572.5    | 0.000 |
|                     | 40   | 814565.0 | 16162.0 | 814567.7 | 16160.2 | 0.0000 | 0.000 | 153.99     | 153.94     | 0.000 | 31171.7    | 31171.4    | 0.000 |
| synthCity bench set | 5    | 85557.4  | 3957.4  | 85580.1  | 3911.1  | 0.0003 | 0.012 | 85.70      | 67.33      | 0.273 | 6875.0     | 6726.0     | 0.022 |
|                     | 10   | 197837.0 | 7496.0  | 197834.0 | 7495.6  | 0.0000 | 0.000 | 128.25     | 108.34     | 0.184 | 10858.4    | 10673.5    | 0.017 |
|                     | 20   | 414900.1 | 11969.2 | 414870.3 | 11970.0 | 0.0001 | 0.000 | 216.69     | 198.96     | 0.089 | 20631.3    | 20445.6    | 0.009 |
|                     | 40   | 820533.4 | 16222.3 | 820542.3 | 16246.2 | 0.0000 | 0.001 | 389.04     | 375.16     | 0.037 | 40182.0    | 40005.0    | 0.004 |
| live baseline       | 5    | 16552.0  | 3898.5  | 16552.0  | 3898.5  | 0.0000 | 0.000 | 25.39      | 25.38      | 0.001 | 4651.6     | 4651.3     | 0.000 |
|                     | 10   | 36143.7  | 5364.8  | 36144.8  | 5364.6  | 0.0000 | 0.000 | 41.52      | 41.52      | 0.000 | 7772.0     | 7772.1     | 0.000 |
|                     | 20   | 58564.9  | 5311.7  | 58569.4  | 5310.2  | 0.0001 | 0.000 | 81.67      | 81.68      | 0.000 | 15570.3    | 15570.4    | 0.000 |
|                     | 40   | 86256.8  | 6061.7  | 86267.9  | 6073.8  | 0.0001 | 0.002 | 160.97     | 160.95     | 0.000 | 31167.6    | 31168.1    | 0.000 |

T3 (funded here, ordinary there in the same month): synthCity baseline 8, bench set 2925, live 1.

## Known differences from today

- **T3**: within one month the world may fund a lot that today's engine starts ordinarily (or the
  reverse), because the ordinary start and serving are ordered by system, not by day.
- **R5**: two applications of one month are served in key order, not by day, so their order can
  differ from today's.
- **A month's first-day bundle**: the offer is read on the first day of the month (S5 `offered`);
  today's engine reads each day.
- **Replan cost**: every free lot's `planLot` runs in a frame-change month (see Cost).
- **Spent pools**: the step engine closes a spent pool (see Pool closing); today's engine keeps
  an application waiting on it.
