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

| File             | What                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `system.ts`      | `createFundingSystem()`: the hook methods, each a thin call into the files below.                                                          |
| `columns.ts`     | `FundLine`, `FundPools`: the line, spell and shadow tables, the pool counters and money rows; `initFunding`, `fundOf`, row helpers.        |
| `clocks.ts`      | The market and affordable funded clocks of a free lot (rules 2 to 5, 7), the size in a view (`sizeIn`). Nothing stored.                    |
| `apply.ts`       | `planLotMonth` (the hook's `planLot`), `applyLots`, `joinLine` (rule 9 order), `remakeRow` (rule 17), `leaveLine` (rule 8), `fundableAny`. |
| `serve.ts`       | `serveLine` (rule 10, grouped by default), `awardDay` (rule 11, T17), `fundedStartOf`; `awardRow` is the one award site.                   |
| `pools.ts`       | `moneyIn` (rule 12), `commitAward`, `moneyOnEvent` (rule 13), `availableOf`.                                                               |
| `policy.ts`      | `policyChanged` (rules 17 to 19): re-make or lapse each waiting row, respell, plan again.                                                  |
| `shadow.ts`      | `shadowAward`, `stepShadows` (rule 20), then the line's (amortized) compaction.                                                            |
| `frame-money.ts` | `frameMoney` (one frame's offers, bundles and money key, memoised per timeline and frame id), `sameMoney`.                                 |
| `line-index.ts`  | Indices of the line kept outside the world (by lot, by award group), keyed by `FundLine` in a `WeakMap`; `compact` (amortized).            |
| `test/`          | `fixtures.ts` (browser-safe: mini city money, `runFunded`, `moneyTimeline`, `benchMoney`), `cities.node.ts` (Node), `identities.ts`.       |

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
`lostLoan`, `lostGuarantee`, `moneyDay`, `moneyMonth`: the latest money that reached it), and one
money row per (awarded project, paying programme) with events still to come, by project row
ascending (`mRow`, `mProg`, `mPool`, `mInstr`, `mGrant`, `mLent`, `mReserve`, `mGuaranteed`,
`mLoss` = the award frame's `terms.lossOnExit`).

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
  `minHomes` offered.
- **Spent spells** (rule 5): a total that passes in a lot-month whose bundle is empty spends the
  spell; planning again never makes it apply later. `appliedThrough`: a kind whose day falls in a
  month whose `apply` already ran is lost (it counts as 0), without hiding the other kind.
- **Key day** (rule 7): the first day of the lot-month in which the ordinary (market) or unshifted
  affordable total passes, evaluated when the lot applies; `NEVER_KEY_DAY` when never.
- **Line order** (rule 9): `joinLine` appends a month's applications after every waiting row, in
  key order. Order is (month applied, key); `applied` orders nothing.
- **Once-a-month scan** (rule 10): `serve` runs once after the month's applications joined; money
  that moves after it waits for next month. Grouped serving (rule 1's decision): per award group
  (kind, bundle, market prototype) the largest passing size H, then the earliest member at most H
  in line order, confirmed with `awardPasses`; every H is dropped after an award.
- **Award day T17** (rule 11): `awardDay` is the later of `applied` (this month) or the month's
  first day, and the latest money day this month of any pool the award asks.
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

| System   | Hook             | Funding work                                                                    |
| -------- | ---------------- | ------------------------------------------------------------------------------- |
| create   | `create`         | `initFunding` with the frame's pool ids.                                        |
| 1 policy | `policyChanged`  | Unless view and money identity (`sameMoney`) are unchanged: re-make or lapse.   |
| 2        | `moneyIn`        | The frame's `finance.arrivals` into the pools (rule 12).                        |
| 3, 5, 6  | `onProjectEvent` | `'start'` of an ordinary lot start: its rows leave the line. Else money events. |
| 4        | `apply`          | The due lots' applications, joined in key order; `appliedThrough`.              |
| 5        | `serve`          | Grouped scan, awards (`startProject` with a `FundedStart`), `'award'`.          |
| 7        | `shadow`         | Shadow starts and `'displaced'`, then the amortized compaction.                 |
| any      | `planLot`        | The first month the lot applies, or 0. Pure (it may build caches).              |

**Compaction** (`line-index.ts` `compact`, perf): a line of `COMPACT_MIN` (1024) rows or more is
compacted only once an eighth of it is `gone`; a shorter one whenever it holds a `gone` row. So
`gone` rows may survive a step on a long line; every reader skips them. The count comes from the
index (rebuilt from columns when stale), so a clone compacts in the same months.

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
and funding). Bar: **mean at most 90 µs per world-month** (the 9 ms constraint is a sum over 96
worlds). It also prints each hook's share and the whole-city replan month, unasserted.

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

## Tests

All in `src/lib/sim/world/funding/`. Server project (signoff) unless noted.

- **Units**: `columns`, `clocks`, `frame-money` (`sameMoney` agrees with `policy/money.ts`),
  `apply`, `serve` (line order, award day, the done-lot guard), `pools` (rule 12, money events),
  `policy` (rules 5, 17 to 19, off pools, raised arrivals), `shadow`, `compaction`, `eligibility`.
- **End to end** `funded.spec.ts`: E1 to E7 after every step on 200 random finances (mini city),
  rule 21, rule 14, rule 16, `structuredClone`, a permuted lot table, the money series I1 to I6.
- **Remedies** `remedies.spec.ts`: grouped serving equals the direct scan (events, ledger, world),
  warm and cold caches equal across a clone.
- **Golden**: `funded.golden.test.ts` (server) and `funded.golden.svelte.spec.ts` (client) against
  `fixtures/funded-events-mini-seed1.json`. Regenerate deliberately, never from signoff:
  `env -C <worktree> node_modules/.bin/tsx src/lib/sim/world/funding/fixtures/build-funded-golden.ts`.
- **Ledger identities in signoff** `referee-ledger.spec.ts`: E1 to E7 after every step to month
  480, seeds 1 to 3, on synthCity (baseline money and the bench set) and fixture-0 (baseline).
- **Perf** `funded-month.perf.spec.ts` (above).

## Tolerance referee

The full referee is **held**: it is not on the branch yet. It waits on the partner's ruling on the
bench-set awards miss (below). When it lands, `tolerance.referee.spec.ts` will run both engines over
seeds 1 to 200 to month 480 and compare, at years 5, 10, 20 and 40, the mean of completed net homes
(1%), its standard deviation (15%) and the mean awards and funded homes (3%), with E1 to E7 checked
after every step. It takes about 4 minutes, so it will run only behind an env switch
(`SFH_WORLD_FUNDING_REFEREE=1`), never in signoff. The live case will need a dataset directory
(`SFH_WORLD_LIVE`, a directory with `manifest.json` and `scenarios/fzp/*`; `npm run data:local`
fills local R2 only, not a directory).

Signoff keeps `referee-ledger.spec.ts` (above). The record of the held referee's run of 2026-11-13
(synthCity; live `2026-11-10-6ee5a23d`; after the award-day fix); "r" is |new − old| / old:

| Case                | Year | net new  | net sd  | net old  | old sd  | mean r | sd r  | awards new | awards old | aw r  | funded new | funded old | fu r  |
| ------------------- | ---- | -------- | ------- | -------- | ------- | ------ | ----- | ---------- | ---------- | ----- | ---------- | ---------- | ----- |
| synthCity baseline  | 5    | 85201.8  | 3914.6  | 85203.0  | 3915.1  | 0.0000 | 0.000 | 24.64      | 24.59      | 0.002 | 4653.5     | 4653.1     | 0.000 |
|                     | 10   | 196535.8 | 7447.0  | 196536.0 | 7446.9  | 0.0000 | 0.000 | 39.97      | 39.93      | 0.001 | 7770.2     | 7770.3     | 0.000 |
|                     | 20   | 411972.3 | 11924.0 | 411982.1 | 11921.5 | 0.0000 | 0.000 | 78.14      | 78.09      | 0.001 | 15572.0    | 15572.5    | 0.000 |
|                     | 40   | 814565.0 | 16162.0 | 814567.7 | 16160.2 | 0.0000 | 0.000 | 153.99     | 153.94     | 0.000 | 31171.7    | 31171.4    | 0.000 |
| synthCity bench set | 5    | 85558.6  | 3956.9  | 85580.1  | 3911.1  | 0.0003 | 0.012 | 85.84      | 67.33      | 0.275 | 6877.2     | 6726.0     | 0.022 |
|                     | 10   | 197840.4 | 7495.8  | 197834.0 | 7495.6  | 0.0000 | 0.000 | 128.05     | 108.34     | 0.182 | 10857.4    | 10673.5    | 0.017 |
|                     | 20   | 414895.8 | 11959.7 | 414870.3 | 11970.0 | 0.0001 | 0.001 | 216.75     | 198.96     | 0.089 | 20631.9    | 20445.6    | 0.009 |
|                     | 40   | 820518.8 | 16248.9 | 820542.3 | 16246.2 | 0.0000 | 0.000 | 388.43     | 375.16     | 0.035 | 40184.5    | 40005.0    | 0.004 |
| live baseline       | 5    | 16552.0  | 3898.5  | 16552.0  | 3898.5  | 0.0000 | 0.000 | 25.39      | 25.38      | 0.001 | 4651.6     | 4651.3     | 0.000 |
|                     | 10   | 36143.7  | 5364.8  | 36144.8  | 5364.6  | 0.0000 | 0.000 | 41.52      | 41.52      | 0.000 | 7772.0     | 7772.1     | 0.000 |
|                     | 20   | 58564.9  | 5311.7  | 58569.4  | 5310.2  | 0.0001 | 0.000 | 81.67      | 81.68      | 0.000 | 15570.3    | 15570.4    | 0.000 |
|                     | 40   | 86256.8  | 6061.7  | 86267.9  | 6073.8  | 0.0001 | 0.002 | 160.97     | 160.95     | 0.000 | 31167.6    | 31168.1    | 0.000 |

T3 (funded here, ordinary there in the same month): synthCity baseline 8, bench set 2908, live 1.
synthCity baseline and live pass every tolerance. **The bench set misses mean awards** at every
year (0.275, 0.182, 0.089, 0.035 against 0.03); net homes and funded homes pass. The extra awards
are small uncertain ones (`u-bench-afford` alone, `u-bench-loan`). The miss is with the partner; no
rule was changed to meet it.

Investigation of 2026-11-13 (synthCity, bench set, seeds 1 to 200, run before the award-day fix):
T3 does not explain the miss. Counting T3's 2911 awards as ordinary still leaves awards 0.066 off
at year 5 and 0.051 at year 10. Every seed diverges in month 1, day 1, and the cause is R5: the
month-1 scan serves in key order, so small `u-bench-loan` and `u-bench-afford` applications dated
later in the month drain `u-bench-fund` before a large day-1 certain application is tested. Today's
engine serves by day.

## Known differences from today

- **T3**: within one month the world may fund a lot that today's engine starts ordinarily (or the
  reverse), because the ordinary start and serving are ordered by system, not by day.
- **R5**: two applications of one month are served in key order, not by day, so their order can
  differ from today's.
- **A month's first-day bundle**: the offer is read on the first day of the month (S5 `offered`);
  today's engine reads each day.
- **Replan cost**: every free lot's `planLot` runs in a frame-change month (see Cost).
