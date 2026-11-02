# /lesscars pipeline

`/lesscars` plays one fixed fewer-cars plan from 2028 to 2068 against a no-plan baseline. The
spec is `docs/superpowers/specs/2026-11-01-lesscars-design.md`; the plan for this part is
`docs/superpowers/plans/2026-11-01-lesscars-1-pipeline.md`. The pipeline does all the work: it
checks the plan, carves freed land, runs the engine in Node over paired seeds and writes four
files. The page only plays them back.

Source map:

| Area                                      | Code                                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| Plan format and parser                    | `src/lib/data/lesscars/plan.ts`                             |
| Schedule and plan rules (`checkPlan`)     | `src/lib/data/lesscars/schedule.ts`                         |
| Network by day (`networkAt`)              | `src/lib/data/lesscars/network.ts`                          |
| Output files (codec)                      | `src/lib/data/lesscars/codec.ts`                            |
| Parameters with evidence (`LC`)           | `pipeline/lesscars-config.ts`                               |
| Freed-land carving                        | `pipeline/steps/lesscars-sql.ts`, `pipeline/sql/84_*.sql`   |
| Freed sites and their zoning              | `pipeline/lib/lesscars/sites.ts`                            |
| SB 79 by year and regimes                 | `pipeline/lib/lesscars/regimes.ts`, `pipeline/sql/85_*.sql` |
| Builds, paired runs, summary, timeline    | `pipeline/lib/lesscars/runs.ts`                             |
| The build step (`writeLessCars`)          | `pipeline/steps/lesscars.ts`                                |
| Engine inputs (`regimes`, `reservedFrom`) | `src/lib/sim/scenario/types.ts`, `engine.ts`                |

## The plan format

A plan is JSON (`LessCarsPlan`, schema 1): `id`, `label`, `capacity` rules and `projects`. The
live plan is `pipeline/enrichment/lesscars/plan.json` (it does not exist yet; plan 3 of the
lesscars work adds it). The fixture plan is
`pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`, one project of most kinds on the mini
city. Every number in a plan is a `Param`, a `value` with a `Provenance` (tier 0 per-record to 4
invented, label, sources, method), so the page can show its evidence.

Every project has `id`, `label`, `kind`, `startYear`, `durationMonths` and `dependsOn`. The kinds
and their own fields:

| Kind                 | Fields                                                      | Homes            |
| -------------------- | ----------------------------------------------------------- | ---------------- |
| `transit-line`       | `mode` (subway, tram, brt), `stops`, `peakTph`, `alignment` | no (moves SB 79) |
| `tram-priority`      | `routeIds`, `segments`, `peakTph`                           | no               |
| `bus-lane`           | `routeIds`, `stopIds`, `segments`, `peakTph`                | no (moves SB 79) |
| `street-change`      | `segments`, `lanes`                                         | no               |
| `highway-truncation` | `segments`, `rowHalfWidthM`, `build`                        | freed land       |
| `street-removal`     | `segments`, `rowHalfWidthM`, `build`                        | freed land       |
| `parking-conversion` | `parcel`, `build`                                           | parking site     |
| `edge-garage`        | `site` (`{ project }` or `{ parcel }`), `spaces`            | no               |
| `car-shuttle`        | `garages`, `alignment`, `peakTph`                           | no               |

A segment is `{ cnn: [...] }` (DataSF street centrelines, `src_streets`) or a drawn
`{ line, provenance }` in [lng, lat]. A stop is `{ id, name, lngLat }`; `lngLat` null names an
existing transit.json stop.

Id spaces: `routeIds` are bare GTFS route ids (transit.json `Pattern.routeId`, for example `14`,
`N`). Existing stop ids carry the operator prefix (transit.json `Stop.id`, for example
`muni:m1`). Stops the plan adds use the `lc:` prefix.

Builder's calls on the format (Task 2):

- A project starts on 1 January of `startYear`; it opens `durationMonths` later.
- A parking conversion's own start and duration are its clearance; its `build` is the housing.
- A garage is always an `edge-garage` that references a site, so a freed project whose land holds
  a garage has `build: null`.
- A parking conversion or garage names exactly one parcel. The engine keeps or voids each dated
  reservation per parcel, and a half-voided multi-lot site would leave lots idle.
- A `car-shuttle` draws on transit capacity: it is rail construction.

Builder's calls on the schedule (Task 3): a project closes its street to cars on its start day
(removals, truncations, and street changes with no `car` lane), and the Fillmore check fails a
closure that starts before every transit project it depends on has opened. A removal, truncation
or parking conversion's site is available on its open day.

## Checks

`writeLessCars` throws one `BuildError` listing every problem as `project.field: message` lines
before it writes anything.

From the plan alone (`checkPlan`, field = problem code): duplicate ids, unknown dependencies,
cycles, dates outside 2028-01-01 to 2068-12-31, a start before a dependency opens, a car closure
with no transit dependency, **`fillmore`** (a closure before its transit opens), a build before
its site is available, a garage on a site that is not a build-free removal, a reused site, a stop
defined twice, capacity (`maxConcurrent` per capacity kind), and a parking conversion with no
transit dependency.

Against this dataset:

- every CNN is in `src_streets` (`segments`);
- every existing stop id is in transit.json, and every `lc:` stop id is placed by a transit line
  of the plan (`stops`, `stopIds`);
- every `routeIds` entry has a pattern in transit.json in the project's mode family (tram
  priority: light rail and streetcar; bus lane: bus), the patterns `networkAt` raises (`routeIds`);
- every parking and garage parcel is in parcels.bin with no existing homes: the plan demolishes no
  housing (`parcel`, `site`);
- every parking conversion is served: some stop of one of its direct transit dependencies (a
  transit line's stops, a bus lane's `stopIds`, the stops of a tram priority's routes) is within
  `SQL_VARS.tod_half_m` (½ mile) of the parcel's DataSF outline (`geom_orig`, EPSG:7131), the
  distance `pol_tod` measures (`dependsOn`).

## Engine regimes and dated reservations

The engine (`runEngine`) takes two optional inputs that only `/lesscars` sets
([sim-levers.md](sim-levers.md) notes `/sim` never does):

- `regimes`: from `regimes[k].day` the view `regimes[k].parcels` (envelopes, yields, Local
  Program) is in force. A simulated project runs on the view of the month it initiated in;
  in-flight rows keep the base parcels.
- `reservedFrom`: per T11 row, the day a parcel is reserved from (0 = none). A reservation is kept
  unless a project began on the row before that day and had not exited by it; a kept one stops
  simulated initiations on or after the day. The sink's `reservation(row, kept)` reports each.

The engine runs under Node through `tsx` (Task 4). Resolution needed nothing special: tsx resolves
the engine's `$lib` imports through the root `tsconfig.json`, which extends
`.svelte-kit/tsconfig.json` and its `$lib` paths (as `scripts/bench-levers.ts` relies on). No
resolve hook and no headless browser. It needs `svelte-kit sync` to have run (`npm install`'s
`prepare` does it). `pipeline/test/fixtures/engine-node-smoke.ts` is the smoke test.

## The step

`writeLessCars` (`pipeline/steps/lesscars.ts`) runs in `build` after the policy step. Inputs: the
plan file (`LESSCARS_PLAN_JSON`: the fixture plan for `fixture-<n>` versions, the live path
otherwise), parcels.bin, policy.bin, projects.json, calibration.json and transit.json from the out
dir, and from DuckDB `src_streets`, `parcels`, `pol_tod` and the scenario tables. No plan file:
nothing is written, no counts, no manifest key. That is the live build until the live plan lands.

Order: parse, schedule, check (above), carve, sites, regimes, builds, paired runs, write.
`buildRegimes` runs only after the policy step and the carve, because it reads `pol_tod` and
`lc_site`.

### Streets and freed land

Street centrelines are the `datasf-streets` source (DataSF Streets, active centrelines,
`data.sf.gov/d/3psu-pn9h`), normalised to `src_streets` (cnn, streetname, classcode, layer, geom
in EPSG:7131). It is optional in a lock: without it `src_streets` is empty and any CNN fails the
check. It is listed in `docs/dev/pipeline.md`.

`carveFreedLand` (`84_lesscars_sites.sql`) cuts removed right-of-way into sites from the parcels
and the land mask, with no right-of-way source:

```
freed = (land_mask − ∪ buffer(parcel outline, accessM)) ∩ buffer(removed lines, rowHalfWidthM)
        − ∪ buffer(every other centreline, keepHalfM)
```

keeping the parts that touch a removed line, cut across it every `lotMaxM` at most, and dropping
pieces under `minPieceM2`. Parameters (`LC`, all tier 4 invented): `keepHalfM` 10 m, `accessM`
6 m, `lotMaxM` 60 m, `minPieceM2` 100 m², `neighbourM` 40 m. Sites are `lc:<project>:<k>`.

A freed site's zoning is its most permissive neighbour within `neighbourM` (most FZP stories, then
no density cap over a cap, then the smaller parcel id): before the switch, FZP on that zoning;
from the switch, the larger of that and SB 79 on the site's own reach to stops.

### Regimes

The law (spec "Law"): FZP until `LC.switchDay` (2032-01-31, an owner-accepted assumption), then
each lot gets the larger of FZP and SB 79, SB 79 where its status is `applies`, the lot is not
permanently exempt and SB 79 is more permissive. The Local Program stays in force.

- **Baseline:** one regime on the switch day, SB 79 on today's network (policy.bin's columns).
- **Plan:** the switch day with the network as the plan has built it then, then each later
  transit opening day that changes some lot's row. SB 79 is recomputed only for lots whose best
  standard differs from policy.bin's; a regime equal to the previous one is dropped.
- Network snapshots are not stored: transit.json plus plan.json rebuild any day through
  `networkAt`.
- A lot is **transit-unlocked** when its engine row (stories, yields, hostable) in the last plan
  regime differs from the baseline's.

### Builds and reservations

The initiative builds on freed sites and parking sites itself (spec "The initiative builds"):

- Each freed site of a removal or truncation with a `build`, and each parking conversion, gets
  one scheduled build at its project's build start, of the top fill yield of the row in force on
  that day.
- A build that adds no homes is dropped. A freed sliver whose envelope holds none counts in
  `lesscars.sites.zero_yield`. A parking build that adds none still keeps its reservation (ruling
  4: the plan named the lot); it counts in `lesscars.sites.zero_gain_parking` with a build
  warning, not a failure.
- A parking conversion reserves its parcel from the conversion's start (clearance), not its build
  start: until then it is an ordinary lot in both arms. An edge garage on a parcel reserves from
  its start; a garage on freed land reserves nothing.
- In a seed where the market already began building on a reserved lot, the reservation is voided
  and the parking build does not happen in that seed.

### Paired runs and attribution

The plan arm (plan regimes, reservations, kept builds) and the baseline arm (baseline regime) run
on the same seeds `bandSeed(i)`, `i < profile.lesscarsSeeds`: **101** on live builds (odd, so the
representative is one run), **5** on the fixture. "Homes by year" is cumulative net completions
since `asOf`, the engine's own measure, at each 31 December 2028 to 2068.

Each future's extra homes are split by source (spec "Goals" 2):

- **freed**: initiative builds on freed sites;
- **parking**: everything on a reserved row, in both arms, kept or not, plus its build;
- **transitUnlocked**: market homes on transit-unlocked lots;
- **other**: the rest, so the parts add to the whole.

A market schedule counts to the source of its first parcel (smallest id); a parcel parcels.bin
lacks counts as other. The summary's means are integer sums over seeds divided by the seed count,
so the four sources add to the total exactly; the band is the nearest-rank p10, p50 and p90 of the
per-seed differences. The representative seed is the pair whose 2068 difference is the median;
its plan arm is the stored timeline.

## Output files

Under `scenarios/lesscars/` (`LESSCARS_FILES`, `pipeline/lib/scenario-files.ts`), every file
tagged `format: 'sfh-lesscars/1'` and named in the manifest as `scenarios.lesscars` (`plan`,
`sites`, `summary`, `timeline`), a sibling of `scenarios.fzp`. `upload` and `verify` check every
file the manifest names.

| File           | Content                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `plan.json`    | the plan, each project's dated times, and each named CNN's [lng, lat] lines  |
| `sites.json`   | freed sites: id, project, parcel record, outline in [lng, lat]               |
| `summary.json` | paired-run summary: extra homes (mean, band) and by source, per year end     |
| `timeline.bin` | the representative future: columnar JSON, deflate-raw level 9, as policy.bin |

`timeline.bin` is bound to parcels.bin by `count` and `idsHash`; decoding it against another
parcels.bin throws. Codecs: `parsePlanFile`, `parseSitesFile`, `parseSummary`,
`decodeTimelinePayload` (`src/lib/data/lesscars/codec.ts`).

Counts in report.json: `lesscars.projects`, `lesscars.sites`, `lesscars.sites.zero_yield`,
`lesscars.sites.zero_gain_parking`, `lesscars.regimes`, `lesscars.seeds`,
`lesscars.extra_2068.mean` (rounded), `lesscars.unlocked_lots`, `lesscars.bytes.timeline_payload`,
and `lesscars.bytes.timeline` on live builds only (deflate bytes vary by zlib).

Goldens: `pipeline/test/fixtures/mini/golden/scenarios/lesscars/{plan,sites,summary}.json` are
compared byte for byte, and `timeline.decoded.json` against the decoded timeline. Regenerate them
only with `npm run pipeline -- fixture --update-golden`.

## Invariant V35

`checkV35` (`pipeline/steps/check-lesscars.ts`) re-reads the published files in `check` and in
`build`: see Invariants in [pipeline.md](pipeline.md). A build whose manifest has no
`scenarios.lesscars` passes with "no plan".

## Running it

- **Fixture:** `npm run pipeline -- fixture` builds fixture-0 with the mini plan and 5 seeds; the
  step adds well under a second. `npm run test:pipeline` covers it
  (`pipeline/test/lesscars-step.test.ts` and the golden test).
- **Live:** once the live plan lands (plan 3), the release build (`npm run pipeline`) runs the full
  101-seed pairs on the maintainer's machine, as dataset builds already do. Until then the live
  build skips the step.

## CI cost

Measured 2026-11-01 as wall-clock seconds of `npm run test:pipeline`, three runs each, on this
branch (95 test files, 1,843 tests) and on `origin/main` a21b226 (90 files, 1,783 tests), same
machine, run one after the other:

| Tree   | Runs (s)   | Median |
| ------ | ---------- | ------ |
| branch | 45, 41, 44 | 44 s   |
| main   | 44, 44, 41 | 44 s   |

The lesscars tests add no measurable time, far under the 60 s threshold, so nothing moved off
`.github/workflows/pipeline.yml` or `chreode.config.ts`.
