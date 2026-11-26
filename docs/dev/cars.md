# Car ownership

Households own cars; homes built change who lives where, and so how many cars the city has and
how much parking new buildings need. Parking in turn moves start odds. Spec:
`docs/superpowers/specs/2026-11-24-car-ownership-design.html`. Sources, checked one by one:
[cars-data.md](cars-data.md). Pipeline step: [pipeline.md](pipeline.md) (Car zones and
households). Engine hook: [world-core.md](world-core.md) (The car hook). Series:
[world-score.md](world-score.md) (`cars`).

## Sources and their ranks

Ranked as in the evidence hierarchy: per-record data, then official aggregates, then inferences,
then literature. Tier is the provenance tier in `calibration.json`'s `cars`.

| Input                                     | Source                                                                            | Rank                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| Household terms, move rates, new-home mix | ACS PUMS 5-year households (2020-2024; 2009-2013 for the held-out fit)            | per-record (tier 1)                      |
| Location terms, zone constants, margins   | ACS 5-year block-group tables, releases 2005-2009 to 2020-2024                    | official aggregate (tier 1, fitted)      |
| Back-cast start                           | 2000 Census SF3 H044 by block group, Census 2000 → 2010 → 2020 relationship files | official aggregate                       |
| Transit access by year                    | Archived Muni, BART, Caltrain GTFS (below)                                        | per-record                               |
| Spaces built per space used, 1.4          | King County Metro, Right Size Parking (2015)                                      | literature (tier 3)                      |
| Cost per space                            | Strategic Economics 2017 (below grade), Seifel 2012 (podium), in 2026 dollars     | inference from cited SF figures (tier 2) |
| Cars registered                           | CA DMV light-duty vehicles by ZIP                                                 | cross-check only                         |

GTFS archive coverage (the feed in force on 1 April): Muni 2009 on, BART 2008 on, Caltrain 2009
on. A year without an operator's own feed takes its next year's (Muni 2014, 2023, 2024; BART 2009,
2014, 2024; Caltrain 2014); before the first archive a year takes the earliest, after the last
today's feed. Nothing keyless exists before 2008.

## The population

Zones are the 681 block groups of ACS 2020-2024 (2020 vintage) in 8 PUMAs; 31 lots fall in none.
Each zone holds `round(occupied × homes)` households: 334,652 on 383,825 assessor homes. Types: 96
(size 1/2/3/4+, workers 0/1/2+, income quartile, own or rent). The PUMA's PUMS records are raked to
the zone's margins (B25009, B19001, and the choice's shrunk vehicle shares). Start: 32.1% with no
car (ACS B25044: 30.2%; the start holds the model's shrunk shares).

Per-zone fitted constants (one per car level) live in `cars.bin` (`sfh-cars/1`, column
`constant`), not in `calibration.json` (ruling P14): they are 681 × 3 numbers keyed to the zones,
which `cars.bin` already carries. `calibration.json` holds the shared terms.

## The choice

A multinomial logit over 0, 1, 2 and 3+ cars, in the structure of MTC Travel Model Two and
ActivitySim, refitted to SF. Stage 1 fits household terms on 17,071 PUMS households; stage 2 fixes
them and fits constants, density and transit access over the block groups. Each block group's
B25044 shares are shrunk toward the model's (empirical Bayes, n0 = 50.85) before its constant is
fitted. The full tables are the calibration report's section 14.

## Moves, fills and the refill

- **Moves.** Owners 6.0% a year, renters 24.4% (PUMS, moved in within 12 months), by type.
- **Refill.** Rate-based and stationary: an out-mover's home takes a household of the same type, in
  proportion to the zone's departures (each type's rate times its households). With no homes built
  or lost, a zone keeps its type mix. Arrivals re-choose cars; stayers keep theirs.
- **Fills.** A completed project's homes fill from PUMS households that moved into homes built in
  the last ten years: market, or by affordable tier (very low, low, moderate). Occupancy is the
  zone's share, rounded systematically.
- **Losses.** Homes lost at a start remove households from the zone, at its occupied share.

## The hook and its order

`createCarSystem(data, model, { link })` (`src/lib/sim/world/cars/`) plugs into `withFunding(f,
cars)`. The car step runs between systems 3 and 4 every month; every event of systems 1 to 7
reaches `cars.onEvent`. Details: [world-core.md](world-core.md), The car hook.

## Parking frames and the off path

Each refresh (every `refreshMonths`, 12) compares a zone's predicted spaces per new market home with
month 0's. A change becomes a frame from the next month: the lot's start odds shift by
`signedOddsShift(-delta × cost per space)` on the frame's slope. Spaces per new home are predicted
cars per household of the new-home mix × 1.4; market today 1.154 citywide.

Cost per space (hard cost, 2026 dollars): below grade $120,083, podium $48,756, surface none (zero
shift). The conversion is `cost_y × I(min(2026, 2023)) / I(y) × CPI(2026) / CPI(y)`. The Controller
cost index is a real index, so the deflator is an assumption: real index × SF CPI-U (BLS
`CUURS49BSA0`; 2025 stands in for 2026).

Cross-check, never used: the Controller's 2026 $/GSF × about 400 sq ft. $245/GSF is the at-grade
low end; below grade alone ($322-$360/GSF) gives about $128,800-$144,000. The escalated
below-grade figure, $120,083 in 2026 dollars, is under that range by 7% to 17%.

Off path: `costPerSpace` null, `{ link: false }`, or `reach-check --cars off` (no car system at
all). With the link off every event equals the run without cars.

## Series, Details, map, About

- Series: `WorldSeries` `cars` rows per calendar month, `TimelineView.cars` (`CarsView`);
  [world-score.md](world-score.md).
- Details on `/sim`: `carsRow` (`src/lib/timeline/cars-row.ts`), cars today → playhead and the change
  per household.
- Map: layer `cars-per-household` on source `car-zones` (`src/lib/map/cars-layer.ts`), from
  `car-zones.json`, loaded on first turn-on.
- About: the cars lines in `src/lib/about/copy.ts`.

## The back-cast

The model stepped monthly from the 2000 Census households to the latest ACS, with each month's
completions and losses and each year's transit access (calibration report section 15). No-car
share, model minus ACS:

| Over                     | Model − ACS        |
| ------------------------ | ------------------ |
| Citywide, 2005-2024      | +0.34 to +1.65 pts |
| Nested zones (375)       | +1.38 to +2.71 pts |
| Held out (2009-2013 fit) | +0.74 to +1.94 pts |

The model runs slightly carless of ACS throughout, most since 2018. By tract (2020-2024): mean
absolute error 6.03 pts, correlation 0.934. Possible follow-up: add the SF3 2000 size and income
tables to the back-cast start, which today rakes each zone's PUMA records to its 2000 tenure by
cars only.

## Current law with and without cars

`npx tsx scripts/reach-check.ts <datasetDir> --cars on|off` (default on) runs both questions with or
without the car system and ends with the opening fill's time. Measured on dataset `2026-11-25-76c90397` (current law, goal 82,069 homes by Oct 2066):

| Run                       | Goal reached | Fill (s) |
| ------------------------- | ------------ | -------- |
| Cars on (parking link on) | Jun 2065     | 3.9-4.0  |
| Cars on, parking link off | Jul 2065     | 3.5      |
| `--cars off`              | Jul 2065     | 2.3      |

Cars move the goal one month earlier, all of it through the parking link.

## Measured cost

2026-11-25, live build `2026-11-25-76c90397`, the earlier level 2 check's fill line, now `reach-check`'s (two worlds, 480 months,
baseline money), three runs each at load average 3.7-4.0 on 15 cores:

- Cars off 2.3 s; cars on with the link off 3.5 s; cars on 3.9-4.0 s. The parking link adds about
  0.4 s and the car step about 1.2 s. Before the incremental parking change (below) cars on took
  8.6-8.8 s at load 1.5-3.
- `cars.perf.spec.ts` (`SFH_WORLD_LIVE`): car step per world-month median 0.715 ms, p90 1.111 ms;
  480 months 655 ms with cars against 7 ms without.
- **Incremental parking changes.** A parking change used to replan every free lot in a funded
  month, with a whole-city `skipBound` and the funded clocks of every lot: about 5 s over the two
  worlds. A month whose frame differs from the month before only in `parking`
  (`PolicyTimeline.parkingOnly`, given by the parking view and kept by funding's closing view when
  no pool opens or closes then) now replans only `touched` (the changed zones' lots), funded month
  or not: every other lot's ordinary and funded clocks are unchanged (its new segment has the old
  rate and the same money). `ordinaryStart` skips the bound of a change that leaves a lot's rate
  alone, and the parking view caches each month's frame. Every event and ledger entry equals the
  whole-city replan (`parking.property.spec.ts`, funded bench city, 480 months).
- What is left of the car system's cost is mostly the car step (`stepZone`: one move draw per
  zone and household type a month). Cutting it would change the draws, so it is left as is.

The cost of a restore or rewind with cars is not printed by any spec.
