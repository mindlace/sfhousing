# /lesscars

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
live plan is `pipeline/enrichment/lesscars/plan.json`, transcribed from the owner-approved
`docs/lesscars/plan-v1.md`: Appendix A plus the v1.1 section (68 projects: v1's 64 less
`garage-south`, plus `garage-rincon` and the four freeway phases `us101-interchange`,
`us101-james-lick`, `us101-bayshore` and `i80-rincon`; `central-freeway-stub` is changed; `street`
capacity is 7; the Masonic display). Each phase's `segments` are the CNNs of its
`freeway-land.json` segment and its `freewayLand` is that segment's parcels and exclusions.
`pipeline/test/lesscars-live-plan.test.ts` holds it to the document: it parses the tables of both
itself (helpers in `pipeline/test/lesscars-doc.ts`), rebuilds the plan from them, the catalog and
`corridors.resolved.json`, and requires `checkPlan` to be empty. A change to the plan goes into
plan-v1 first, then into plan.json. The fixture plan is
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
| `highway-truncation` | `segments`, `rowHalfWidthM`, `build`, `freewayLand?`        | freed land       |
| `street-removal`     | `segments`, `rowHalfWidthM`, `build`                        | freed land       |
| `parking-conversion` | `parcel`, `build`                                           | parking site     |
| `edge-garage`        | `site` (`{ project }` or `{ parcel }`), `spaces`            | no               |
| `car-shuttle`        | `garages`, `alignment`, `peakTph`                           | no               |

A segment is `{ cnn: [...] }` (DataSF street centrelines, `src_streets`) or a drawn
`{ line, provenance }` in [lng, lat]. A stop is `{ id, name, lngLat }`; `lngLat` null names an
existing transit.json stop.

An optional top-level `displays` list holds display-only map items (`PlanDisplay`: `id`,
`label`, `segments`, `from`). A display has no capacity, no homes and no closure: the page draws
its segments as changed from the open day of project `from`, and nothing in the engine or the
summary reads it. Its id shares the project id space (`checkPlan` reports `duplicate-id`), `from`
must name a project (`unknown-dependency`), its CNNs are checked against `src_streets` and drawn
in `plan.json` `segments` like a project's. Plan 3 uses it for the Masonic underpass, filled from
the Geary subway's opening. A plan without `displays` parses to an object without the key, so its
plan.json is unchanged.

Id spaces: `routeIds` are bare GTFS route ids (transit.json `Pattern.routeId`, for example `14`,
`N`). Existing stop ids carry the operator prefix (transit.json `Stop.id`, for example
`muni:m1`). Stops the plan adds use the `lc:` prefix.

Builder's calls on the format (Task 2):

- A project starts on 1 January of `startYear`; it opens `durationMonths` calendar months later
  (36 months from 1 January 2029 is 1 January 2032). Only a fractional remainder is converted to
  days, as `round(fraction x MONTH_DAYS)`. `monthsAfter` in `schedule.ts` does this for the open
  day and for `build.completeDay`.
- An optional `opensAfter: string[]` on any project names projects this one must not open before.
  It is a check (`opens-before`), not a start constraint, and takes no part in cycle search. A plan
  without the key parses to an object without it.
- An optional `freewayLand: { parcels, excluded }` on a `highway-truncation` (any other kind with
  the key fails as `unknown key`) lists the freeway-land parcels the phase frees and the catalog
  candidates it leaves out, each with a `reason`. A plan without the key parses to an object
  without it.
- Every `[lng, lat]` (stops, alignments, drawn lines) must have `lng` in [-180, 180] and `lat` in
  [-90, 90]; the parser rejects a swapped pair at its path.
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
cycles, `opens-before` (a project opening before one it names in `opensAfter`), dates outside
2028-01-01 to 2068-12-31, a start before a dependency opens, a car closure with no transit
dependency, **`fillmore`** (a closure before its transit opens), a build before its site is
available, a garage on a site that is not a build-free removal, a reused site (a parcel is used
once across parking conversions, garages and every truncation's `freewayLand`, except that one
garage `{ parcel }` may share its parcel with one truncation's `freewayLand`: the garage stands
on that phase's land), a stop defined
twice, capacity (`maxConcurrent` per capacity kind), a parking conversion with no
transit dependency, and a display whose id is reused or whose `from` names no project.

Against this dataset:

- every CNN of a project or display is in `src_streets` (`segments`);
- every existing stop id is in transit.json, and every `lc:` stop id is placed by a transit line
  of the plan (`stops`, `stopIds`);
- every `routeIds` entry has a pattern in transit.json in the project's mode family (tram
  priority: light rail and streetcar; bus lane: bus), the patterns `networkAt` raises (`routeIds`);
- every parking and garage parcel is in parcels.bin with no existing homes: the plan demolishes no
  housing (`parcel`, `site`);
- every `freewayLand` parcel is in parcels.bin with no existing homes, is in `freeway-land.json`
  (otherwise freeing it would count its homes twice), and sits in a catalog segment whose
  `removedBy` is this truncation: a kept freeway never frees its land, nor does another phase's
  (`freewayLand`); every `excluded` parcel is in parcels.bin (`freewayLand`). With no catalog
  every `freewayLand` parcel fails the catalog check;
- a parking conversion on a catalog parcel fails: only a garage may stand on freeway land
  (`parcel`);
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

Freeway land ([pipeline.md](pipeline.md), "Freeway land") is scenario-ineligible in
`parcels.bin`, which both arms read, so the rule applies to the baseline and the plan arm alike:
a catalog parcel builds nothing in either until its freeway is removed.

## The step

`writeLessCars` (`pipeline/steps/lesscars.ts`) runs in `build` after the policy step. Inputs: the
plan file (`LESSCARS_PLAN_JSON`: the fixture plan for `fixture-<n>` versions, the live path
otherwise), parcels.bin, policy.bin, projects.json, calibration.json and transit.json from the out
dir, and from DuckDB `src_streets`, `parcels`, `pol_tod` and the scenario tables. No plan file:
nothing is written, no counts, no manifest key.

Order: parse, schedule, check (above), carve, sites, regimes, builds, paired runs, write.
`buildRegimes` runs only after the policy step and the carve, because it reads `pol_tod` and
`lc_site`.

### Streets and freed land

Street centrelines are the `datasf-streets` source (DataSF Streets, active centrelines,
`data.sf.gov/d/3psu-pn9h`), normalised to `src_streets` (cnn, streetname, classcode, layer, `f_st`, `t_st`, geom
in EPSG:7131). It is optional in a lock: without it `src_streets` is empty and any CNN fails the
check. It is listed in `docs/dev/pipeline.md`.

Plan segments written as a street selector (`STREET, FROM → TO`, plan-v1 Appendix A) are
transcribed verbatim into `pipeline/enrichment/lesscars/corridors.json`
(`{ "schema": 1, "corridors": [{ owner, street, from, to, as? }] }`, `owner` the project or
display id). `npm run pipeline -- lesscars-cnns` normalises the locked `datasf-streets` raw files (no
network) and writes `corridors.resolved.json`: `{ schema: 1, source: { id, sha256 }, corridors }`,
each corridor the selector (with its `as`, if any) plus `cnn` (sorted) and `lengthM` (to 0.1 m), `sha256` the lock's file
hashes in lock order. It writes nothing and exits 1 when any selector fails, listing every failure.
Plan CNN lists must equal `corridors.resolved.json`.

Names are compared through `canonicalStreet`, for selector strings and data names (`streetname`,
`f_st`, `t_st`) alike: upper-cased, trimmed, a leading zero dropped from an ordinal (DataSF writes
`09TH AVE`, Appendix A `9TH AVE`), then `STREET_ALIASES` (`LA PLAYA ST` → `LA PLAYA`: La Playa's own
segments are named `LA PLAYA` while its neighbours' `f_st`/`t_st` say `LA PLAYA ST`).

When a cross street named in Appendix A does not meet the street in the data, the selector keeps
its verbatim strings and gains `as: { from?, to?, reason }`; the resolver uses `as.from` / `as.to`
in their place, and `as` is carried into `corridors.resolved.json` for review. There is one:
fell-oak-street's `OAK ST, MARKET ST → BAKER ST` resolves from `VAN NESS AVE` (Oak St's east end in
DataSF, CNN 9750000; it does not meet Market St, about 60 m south, so the stretch is the same).

The resolver (`pipeline/lib/lesscars/corridors.ts`):

1. Candidates are the segments whose canonical `streetname` is `STREET`'s. Graph nodes are their line-part
   endpoints clustered within `snapM`; each part is an edge weighted by its length.
2. FROM (TO) nodes are the candidate nodes within `crossM` of any line of a segment named `FROM`
   (`TO`), so a divided cross street gives a node at each carriageway. `COUNTY LINE` instead takes
   the degree-1 nodes ending a candidate whose `f_st` or `t_st` is `COUNTY LINE`.
3. The path is the shortest positive-length path from any FROM node to any TO node (multi-source
   Dijkstra); a node that is both a FROM and a TO node is passed over, not taken as the answer. No
   FROM or TO node is `no crossing with <name>`; no path is `no path` (`no path (… meet at one
node)` when FROM and TO share a node and nothing longer joins them).
4. The corridor is the path's segments plus every candidate lying alongside the path: every vertex
   within `bandM` of the path, and none beyond a path end. A vertex is beyond an end when its
   nearest path point is that end and it lies outward along the chord of the path's last `bandM`;
   it is still allowed within `snapM` of the end node or of a line of that end's cross street (for
   `COUNTY LINE`, of a county-line dead end), which is where the other carriageway ends. A
   candidate whose `f_st` and `t_st` both name an end's cross street and whose endpoints both lie
   within `snapM` of that street's lines (the piece through a divided cross street's median, such
   as Ocean `9846000`) needs only the band; the label alone is not enough, since DataSF also writes
   it on stubs past a crossing (Hyde `7147000` past Francisco). So the other carriageway
   and shared-centreline twins are kept; a short block before FROM, a stub past TO and a fork at
   either end are not (on the locked data: McAllister `8887000`, Church `4009000`, Judah `7686000`,
   Richardson `15173000`), nor is the same name elsewhere.

`lengthM` is a centreline sum, not a route length: it adds every kept segment, so each carriageway
and each shared-centreline twin counts. Streets DataSF digitises as two carriageways (19th Ave, Park
Presidio, Van Ness, Lombard, Geary; CNN suffixes `1xx` and `2xx`) give about twice the street's
length. Do not use it as the distance a bus travels.

Known limits (no check today; review `corridors.resolved.json` after a data refresh):

- **Same-name stretches tie silently.** If a street has two disconnected stretches that both cross
  FROM and TO, the shorter path wins without a warning. On the locked data every selector street
  has 1–3 components and exactly one holds both a FROM and a TO node.
- **Candidates are matched by name, not `layer`.** A PAPER, PSEUDO or PRIVATE segment of the same
  name alongside the path would join the corridor. Every CNN resolved on the locked data is
  `layer = STREETS`.

`CORRIDOR` (all tier 4, builder's): `snapM` 0.5 m, `crossM` 25 m, `bandM` 40 m.

`carveFreedLand` (`84_lesscars_sites.sql`) cuts removed right-of-way into sites from the parcels
and the land mask, with no right-of-way source:

```
row   = (land_mask − ∪ buffer(parcel outline, accessM), freed parcels excepted)
        ∩ buffer(removed lines, rowHalfWidthM)
        − ∪ buffer(every other centreline, keepHalfM)
        − ∪ freed parcels (current outline)
```

keeping the parts that touch a removed line and cutting them across it every `lotMaxM` at most
(the ROW pieces). Parameters (`LC`, all tier 4 invented): `keepHalfM` 10 m, `accessM` 6 m,
`lotMaxM` 60 m, `minPieceM2` 100 m², `neighbourM` 40 m. Sites are `lc:<project>:<k>`.

**Freed parcels** (a truncation's `freewayLand.parcels`, v1.1) become sites of their own: each
polygon part of a freed parcel's current outline is a seed. A ROW piece within 0.05 m of a seed of
a non-held freed parcel of the same project merges into the seed it shares the most land with
inside that 0.05 m (the smaller parcel id, then part, on a tie); every other ROW piece stays a
site. Freed parcels get no access strip, and ROW pieces never overlap them, so no land is counted
twice. Numbering per project: seeds first, by (parcel id, part), then the unmerged ROW pieces in v1
order (line, stretch, centroid); `minPieceM2` drops only unmerged pieces. A project freeing no
parcel numbers and carves exactly as in v1. A site lists the freed parcels it overlaps by more than
1 m² (`parcels`, sorted) and its area in them (`parcelM2`). The 0.05 m and 1 m² tolerances absorb
projection noise (builder's).

**Held sites.** A garage `{ parcel }` on a phase's freed parcel (the one overlap `checkPlan`
allows) holds that parcel's sites (`heldBy` the garage); no ROW piece merges into a held site.

A freed site's zoning is its most permissive neighbour within `neighbourM` (most FZP stories, then
no density cap over a cap, then the smaller parcel id): before the switch, FZP on that zoning;
from the switch, the larger of that and SB 79 on the site's own reach to stops. Neighbours are
never freeway land or road-like lots: catalog parcels, freed parcels and road-like lots (the
records' `roadLike`, see [pipeline.md](pipeline.md) "Road-like lots") are excluded
(`notNeighboursOf`; the zoning is the city's around the freeway, not the P zoning of the freeway
land or of a median or ramp strip beside it). On the mini fixture this drops lots 20 and 22-24
from the hwy sites' neighbours but changes no site's chosen zoning.

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
- A site held by a garage gets no build. `summary.garageCost` reports, per garage holding sites,
  the top fill yield its held sites would have had at their project's build start (its open day
  when the project has no build), summed (`garageCosts`, which reads the same row as
  `initiativeBuilds` through one helper). Absent when no garage holds a site.
- A build that adds no homes is dropped. A freed sliver whose envelope holds none counts in
  `lesscars.sites.zero_yield`; a held site never does. A parking build that adds none still keeps its reservation (ruling
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

| File           | Content                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| `plan.json`    | the plan, each project's dated times, and each named CNN's [lng, lat] lines; `basemapHide` |
| `sites.json`   | freed sites: id, project, parcel record, outline in [lng, lat]                             |
| `summary.json` | paired-run summary: extra homes (mean, band) and by source, per year end                   |
| `timeline.bin` | the representative future: columnar JSON, deflate-raw level 9, as policy.bin               |

`timeline.bin` is bound to parcels.bin by `count` and `idsHash`; decoding it against another
parcels.bin throws. Besides the plan arm's schedules and the initiative builds kept in the
representative seed, it holds `reservations`: every reserved row's verdict in that seed (`kept`,
or voided because the market began a project there first), strictly ascending by row, encoded as
the column object `{ row: number[], kept: (0 | 1)[] }`. A voided garage parcel has no build to
drop, and a zero-gain conversion keeps its reservation with no build, so the page needs the
verdict to tell kept from voided. Codecs: `parsePlanFile`, `parseSitesFile`, `parseSummary`,
`decodeTimelinePayload` (`src/lib/data/lesscars/codec.ts`).

v1.1 keys, all optional so the v1 files (dataset `2026-11-02-39fbf039`) still parse; the writer
omits a key that is empty, 0 or null, so a plan freeing no parcel writes v1 files:

- `sites.json`, per site: `parcels` (freed parcels it overlaps, sorted), `parcelM2` (its area in
  them, to 0.01 m²), `heldBy` (the garage holding it).
- `summary.json`: `garageCost: [{ projectId, homes }]`, `homes` a non-negative integer.

Test copies of the v1 files are in `src/lib/data/lesscars/fixtures/v1/` (`V1_PLAN`, `V1_SITES`,
`V1_SUMMARY`).

Counts in report.json: `lesscars.projects`, `lesscars.sites`, `lesscars.sites.parcels` (sites
with `parcelM2 > 0`), `lesscars.sites.held`, `lesscars.freed_m2.parcels` and
`lesscars.freed_m2.row` (rounded m² of freed-parcel and right-of-way land, held sites excluded),
`lesscars.sites.zero_yield`,
`lesscars.sites.zero_gain_parking`, `lesscars.regimes`, `lesscars.seeds`,
`lesscars.extra_2068.mean` (rounded), `lesscars.unlocked_lots`, `lesscars.bytes.timeline_payload`,
and `lesscars.bytes.timeline` on live builds only (deflate bytes vary by zlib).

Goldens: `pipeline/test/fixtures/mini/golden/scenarios/lesscars/{plan,sites,summary}.json` are
compared byte for byte, and `timeline.decoded.json` against the decoded timeline. Regenerate them
only with `npm run pipeline -- fixture --update-golden`.

## Invariant V35

`checkV35` (`pipeline/steps/check-lesscars.ts`) re-reads the published files in `check` and in
`build`: see Invariants in [pipeline.md](pipeline.md). A build whose manifest has no
`scenarios.lesscars` passes with "no plan". Among its checks, the timeline's `reservations` rows
must equal the non-zero rows of `reservationsOf(plan, schedulePlan(plan), parcels)`
(`pipeline/lib/lesscars/runs.ts`); a mismatch fails with `timeline reservations ≠ plan's reserved
parcels`.

Freed parcels and held sites (v1.1):

- every site's `heldBy` names an `edge-garage` whose `site.parcel` is in the site's `parcels`;
- every `freewayLand` parcel is in some site's `parcels` (`freed parcel <id> is in 0 sites`). A
  parcel of several polygon parts is in one site per part, so V35 cannot require exactly one; the
  carve's subtraction keeps ROW pieces off freed parcels;
- every parcel in a site's `parcels` has `eligible` 0 in parcels.bin (`freed parcel <id> is
scenario-eligible: its homes would count twice`);
- no timeline build is on a held site (`timeline builds on held site <id>`).

## Running it

- **Fixture:** `npm run pipeline -- fixture` builds fixture-0 with the mini plan and 5 seeds; the
  step adds well under a second. `npm run test:pipeline` covers it
  (`pipeline/test/lesscars-step.test.ts` and the golden test).
- **Live:** the release build (`npm run pipeline`) runs the step with the live plan and the full
  101-seed pairs on the maintainer's machine, as dataset builds already do. See "First live
  build" for what it measured.

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

## First live build

Built 2026-11-02 on the owner's laptop (Apple Silicon Mac) as `2026-11-02-39fbf039`.

- **Time:** the whole build took 2 min 53 s wall clock (266.9 s user); `timings.lesscars` was
  6,957 ms. 101 seeds, representative seed 92. The 30-minute rule did not apply, so the seed
  count stayed at 101.
- **V35:** `64 projects, 40 sites, 41 year ends`.
- **Headline at 2068:** mean +7,786 extra homes (p10 7,062, p50 7,883, p90 8,211); plan 97,840
  against baseline 90,054.
- **2068 by source** (largest-remainder rounding, as the page shows it, summing to 7,786): freed
  1,684; parking 5,988; transit-unlocked 114; other 0.
- **Regimes:** `summary.regimeDays` are 2032-01-31, 2034-01-01, 2035-01-01, 2041-01-01 and
  2044-01-01.
- **Report counts:** `lesscars.sites` 40; `lesscars.sites.zero_yield` 3;
  `lesscars.sites.zero_gain_parking` 2, named by the warning "parking conversion(s)
  park-0715015, park-0761065 add no homes at their envelope; their lots stay reserved";
  `lesscars.unlocked_lots` 3,617.
- **Bytes:** `timeline.bin` is 104,931 B, 435,051 B decoded.
- **Carve:** `geary-trench` freed 26,411 m² (2.64 ha) across 40 sites. The plan's 12,000-20,000 m²
  band was a guess sized for the main lanes alone (plan-v1's ~1.8 ha); the trench removes 14 CNNs,
  including the Fillmore frontage roads, so the larger area is expected and was accepted.
  `central-freeway-stub` freed 0 m²: plan-v1 Concern 2, the land under the viaduct is already a
  parcel, reported to the owner and not fixed.
- **Garage reservations** in the representative seed (92): `garage-south` (parcel 3901004) kept;
  `garage-north` (parcel 0509009) kept. Of the 48 reserved parcels, 4 were voided.
- **Dates:** `asOf` unchanged from the published `2026-10-29-14e0eccb` (projects and calibration,
  day 20745); transit service dates unchanged (Muni 2026-08-25; BART and Caltrain 2026-10-20).
- **Plan correction:** the first build attempt failed because two parking parcels held homes;
  0195019 (Kearny St, 105 homes) and 0285020 (Sutter St, 400 homes) were dropped from the plan.

### Live check

On 2026-11-02 the page ran against `2026-11-02-39fbf039` in local R2 (`VITE_E2E=1 npm run
preview`, headless Chromium, 1280 and 375 px). It passed these checks:

- **Headline:** +7,786 homes by 2068, with the band +7,062 to +8,211. The four source parts add
  to the headline.
- **Header and dialogs:** "Fewer cars" is current. The timeline lists 64 projects, with parking
  conversions (46) in the disclosure. Evidence shows tier 4 as "Assumption, not data".
- **Street, transit and garage layers:**
  - Fulton, 19th Ave and N Judah are in their transit state from day 22645.
  - The Geary subway line and its 6 stops appear on day 25933.
  - Trench sites appear on day 27028.
  - 40 parking builds rise between 2033 and 2046. That is 46 conversions less the 4 voided
    reservations and the 2 sites with no gain.
  - Both garage markers appear. Scrubbing back to 2028 clears every plan layer.
- **Errors:** none in the console or the network.

Two problems were found. Both are follow-ups, not release blockers:

- **Scrubber lag:** revision 0 arrives 317 ms after navigation, with 1 cell; cells reach 97 later.
  While they pack, a pointer drag lags about 2 s per step. Keyboard scrubbing updates within 3 ms.
  The headless browser was near 1000% CPU throughout the run, so profile this in a real browser
  before capping the packing.
- **Duplicate heading:** the timeline disclosure repeats a "Parking conversions" heading under its
  summary.

## v1.1 live build

Built 2026-11-04 on the owner's laptop (Apple M5 Pro, Mac17,9) as `2026-11-02-0d40e1e2`, from the
committed lock (unchanged) and the v1.1 plan (68 projects) and freeway-land catalog with the fixes
after the live check (the freeway-road split rule; `19222002` and six lots moved to the kept
`us101-south`). All 34 invariants passed. It replaces the first v1.1 build, `2026-11-02-70dfa769`
(2026-11-03); where a figure changed, the `70dfa769` value follows in brackets.

- **Time:** the whole build took 2 min 54 s wall clock; `timings.lesscars` was 7,806 ms. 101
  seeds, representative seed 21. The 30-minute rule did not apply, so the seed count stayed at
  101 and "Running it" is unchanged.
- **V35:** `68 projects, 166 sites, 41 year ends` (174).
- **Headline at 2068:** mean +29,081 extra homes (p10 28,371, p50 29,175, p90 29,505); plan
  116,181 against baseline 87,100 (`70dfa769`: +29,361, plan 116,461; the baseline is unchanged). v1 was +7,786 (plan 97,840, baseline
  90,054).
- **2068 by source** (largest-remainder rounding, as the page shows it, summing to 29,081): freed
  22,947 (23,227); parking 6,020; transit-unlocked 114; other 0.
- **Freed homes basis:** the 22,947 freed homes are built under the plan's freed-land regime: each
  site takes its neighbours' zoning or SB 79, whichever allows more, as it stands at the phase's
  build start, at top fill. They are not today's FZP yield on the same parcels, which is 7,650
  homes on the 38.88 ha of open freed parcels (derived: `70dfa769`'s 7,935, which is the
  catalog's per-segment FZP totals less the held garage parcel's 605, less the 285 of the six
  lots moved to `us101-south`; not recomputed on this build). Per phase, from the steps in `summary.bySource.freed`, each in the year
  its phase's builds complete: `central-freeway-stub` 824; `us101-interchange` 2,664; `i80-rincon`
  8,063; `us101-james-lick` 7,544; `geary-trench` 1,684; `us101-bayshore` 2,168 (2,448).
- **Freed land** (open sites; the held site is aside): 43.18 ha (44.09), 38.88 ha from parcels
  (`lesscars.freed_m2.parcels` 388,806 m²) and 4.30 ha from right-of-way
  (`lesscars.freed_m2.row` 42,951 m²). The one held site (`lc:i80-rincon:20`, 10,252 m², held
  by `garage-rincon`) is not counted. Per phase, from `sites.json` `rec.areaM2` summed. The
  start is the project's start year (`startYear`); the freed land's homes start at the phase's
  build start (`build.startYear`, three years later; four for `geary-trench`) and count when
  they complete:

  | Phase                  | Project start | Sites | Total m² | From parcels m² | From ROW m² |
  | ---------------------- | ------------- | ----: | -------: | --------------: | ----------: |
  | `central-freeway-stub` | 2033          |     5 |    9,301 |           8,774 |         527 |
  | `us101-interchange`    | 2037          |    28 |   56,885 |          53,324 |       3,562 |
  | `i80-rincon`           | 2038          |    26 |  138,707 |         135,599 |       3,108 |
  | `us101-james-lick`     | 2040          |    31 |  115,502 |         112,305 |       3,197 |
  | `geary-trench`         | 2041          |    40 |   26,411 |               0 |      26,411 |
  | `us101-bayshore`       | 2043          |    35 |   84,951 |          78,800 |       6,151 |

  Every phase frees area. `central-freeway-stub` freed 0 m² in v1; it now frees 9,301 m² through
  its catalog parcels. `us101-bayshore` lost 8 sites and 9,153 m² (43 sites, 94,104 m²) with
  `19222002` and its six lots. 115 sites overlap freed parcels (`lesscars.sites.parcels`; 121), 1
  is held (`lesscars.sites.held`).

- **Garages** in the representative seed (21): `garage-rincon` (parcel 3764064) kept;
  `garage-north` (parcel 0509009) kept. `summary.garageCost` is `garage-rincon` 982 homes: the
  held site's freed-site row, the homes it would have built under the freed-land regime at
  `i80-rincon`'s build start. The 605 in plan-v1's garage section is today's FZP yield on the
  parcel's own zoning (SB-DTR), so the two do not disagree. Of the 48 reserved parcels, 3 were
  voided.
- **Regimes:** `summary.regimeDays` are 2032-01-31, 2034-01-01, 2035-01-01, 2041-01-01 and
  2044-01-01, as in v1.
- **Report counts:** `lesscars.sites` 166 (174); `lesscars.sites.zero_yield` 15 (16);
  `lesscars.sites.zero_gain_parking` 2, the same two conversions as v1 (park-0715015,
  park-0761065); `lesscars.unlocked_lots` 3,617; `tiles.basemap_split_changed` 29 (26).
- **Bytes:** `timeline.bin` is 103,409 B, 431,869 B decoded (103,444 and 432,315).
- **Dates:** `asOf` (day 20745), the FZP `calibration.json` (byte-identical) and the transit
  service dates (Muni 2026-08-25; BART and Caltrain 2026-10-20) are unchanged from
  `2026-11-02-39fbf039`. The freeway rule leaves the calibration panel alone.

### Change to `/sim` and FZP

The freeway-land catalog is applied in the scenario for every arm, so it changes `/sim`'s and
FZP's numbers as well as `/lesscars`'. The scenario report says "freeway land makes 559 lots
unbuildable, 32807 net homes of static capacity":

| Freeway | Net homes of static capacity removed |
| ------- | -----------------------------------: |
| I-280   |                               18,333 |
| US-101  |                                9,370 |
| I-80    |                                5,104 |
| CA-1    |                                    0 |
| Total   |                               32,807 |

CA-1 is 0 because `ca1-presidio` has no catalog parcels. The lesscars baseline at 2068 fell from
90,054 to 87,100 (-2,954, -3.3%); `parcels.bin` is 2,106,971 B (2,109,207 B in v1). Moving six
lots from `us101-bayshore` to the kept `us101-south` changed none of these: both lists are
ineligible in every arm, so the counts, `V17`'s 146,542 hostable parcels and the baseline are as
in `70dfa769`.

### Prose counts in plan-v1

`plan-v1.md` (v1.1 section, Phases: the `freewayLand` rows of `us101-bayshore` and `i80-rincon`) counts "38" and "52" out rows. Those counts include rows
that moved to kept segments. The catalog's 28 and 51 are the segment exclusions. `plan-v1.md`
is not edited.

### v1.1 live check

The pages were checked twice in local R2 (a `VITE_E2E=1` build served by `wrangler dev` with
`PUBLIC_DATASET_VERSION` passed as `--var`, with `--var ENVIRONMENT:development` (the override is ignored without it); headless Chromium, 1280 and 375 px), reading
`window.__sfhLessCars` and the rendered map features and inspecting the screenshots: on
2026-11-03 against `2026-11-02-70dfa769`, and on 2026-11-04 against `2026-11-02-0d40e1e2`, after
the fixes below. The before numbers come from `2026-11-02-39fbf039`.

`/sim` and FZP (`/fzp` redirects to `/sim`, which opens on the FZP comparison). Each figure gave
the same number on a second load:

| `/sim` headline                          | `39fbf039` | `70dfa769` and `0d40e1e2` | Change |
| ---------------------------------------- | ---------: | ------------------------: | -----: |
| At its default (Setup, October 2026)     |      8,709 |                     9,101 |   +392 |
| Run, at the RHNA deadline (January 2031) |     24,679 |                    18,148 | −6,531 |
| Run, at the horizon (December 2066)      |     93,763 |                    91,176 | −2,587 |
| FZP added vs no FZP, December 2066       |      6,352 |                     8,337 | +1,985 |

The headline is one run, the representative seed (the run whose 2066 total is the median of the
101). The freeway rule lowers every run's 2066 total (by 1,020 to 4,369 homes), which moves the
median from seed 15 to seed 43, so the figures at other dates compare two different paths. Seed 43
schedules 392 pipeline completions in the rest of October 2026, which the Setup bucket counts. The
2066 drop, −2,587, is the change in the median run's total; on the same seeds the mean change is
−2,602. The other rows, the FZP-added +1,985 among them, compare two different seeds' paths and
are not effects of the rule. The fixes leave the scenario as it was (the six
moved lots are ineligible as kept land too), so `0d40e1e2` gives the same numbers as `70dfa769`.
On `0d40e1e2`, `/sim` still draws today's US-101, I-80 and I-280 at z11, z13 and z15 over the
Central Freeway, the Hairball, Alemany and Rincon Hill, with the same 113 style layers and 5
sources as before (the `__lc` clones draw the moved pieces unfiltered). No console or network
errors.

`/lesscars` on `0d40e1e2` passed these checks, at 1280 and 375 px:

- **Headline and details:** +29,081 homes by 2068, band +28,371 to +29,505. The four parts (freed
  22,947; parking 6,020; transit-unlocked 114; other 0) add to it. The disclosure reads "38.9 ha
  of former freeway land and 4.3 ha of former roadway", and the garage line "take the place of
  982 homes".
- **Timeline and Evidence:** the timeline has 68 rows, 22 plus "Parking conversions (46)", with
  the four new removal phases and `garage-rincon`. Evidence shows the new provenances ("Seven
  street projects at once (invented)", "1,700 spaces (invented)").
- **Phases:** for each of the five removal phases, the month before its open day its
  `roads_lc` pieces draw at z11 to z15. From the open day none draws, labels included, while
  I-280 and the other freeways still draw. The removed-line overlay and the freed land appear on
  the open day. Scrubbing back to 2028 restores the freeway.
- **Former problems:** the I-80 piece along Vermont St (`35184403218590`) and the Harrison St loop
  (`35184399860900`) are in `roads_lc` and go with their phases at z11 to z15. They come back on
  scrubbing back; the loop's piece outside the corridor stays in `roads`. The unnamed ramps of the
  removed stretches go with them. What freeway road is left in `roads` near a removed line is
  kept road (the Bay Bridge approach, I-280, the kept US-101 and the kept ramps at Alemany) or a
  few metres at ramp ends.
- **Alemany:** the kept US-101 joins I-280 without a gap at z11 to z15. The kept northbound
  carriageway (`19222002`) runs on about 350 m north of the I-280 crossing to the Alemany
  off-ramp, as expected, and a few metres of ramp are left near its end.
- **Rincon Hill:** the Bay Bridge approach is intact and ends at Harrison St. The Fremont St
  off-ramp and the Essex St on-ramp, both kept, still draw.
- **Surface links the rule now moves:** all are ramps of removed stretches (checked on the map
  before and after each phase opens, and on Esri imagery):
  - At Market and Octavia, the `secondary_link` pieces are the Central Freeway's Mission St and
    South Van Ness ramps.
  - At the Hairball, the `primary_link` pieces are the ramps between Cesar Chavez St and US-101.
    Short pieces of their approach lanes run along the edge of Cesar Chavez St.
  - South of the Hairball, near Alemany, the `primary_link` pieces are the ends of the Bayshore
    Blvd and Industrial St ramps on the freeway side. The surface part of each ramp stays.
- **Garages:** `garage-rincon` and `garage-north` markers appear (both reservations kept, seed
  21; 45 of 48 reservations kept). There is no `garage-south` or `garage-alemany`.
- **Errors:** none in the console or the network.

The first check, on `70dfa769`, found three map problems, fixed below. An unsplit `I 80` piece
(`35184403218590`, about 1.1 km, 550 m of it seen still drawn along Vermont St) stayed drawn after `us101-interchange` and
`us101-james-lick` opened. Ref-less ramps of the removed stretches stayed drawn after removal,
the Harrison St loop among them. The `us101-bayshore` cut ran about 400 m south of the I-280
crossing, because CNN `19222002` reached Silver Ave.

#### Fixes after the live check

Recorded as errata in `docs/lesscars/plan-v1.md` ("Errata from the live check (2026-11-03)"):

- **The split takes every freeway road along a removed line** ("The split: `roads_lc`", below):
  any `highway` or link feature, whatever its ref, inside a corridor and running along the phase's
  CNN lines moves; parts nearer a kept segment's line, and roads whose refs only kept segments
  carry (`I 280`, `CA 1`), stay. `basemap-ids.json` is unchanged. `lesscars-basemap --split` on
  the locked archive (sha256 `a6a1acc8…`) after the fix: `35184403218590` moves with
  `us101-interchange` (about 970 m at every zoom) and `i80-rincon` (its northern 115 m); the
  Harrison St loop `35184399860900` moves with `i80-rincon` (485 m at z15); the ramps above move
  with their phases. Freeway roads left along a removed line: at most 21 m per feature and zoom,
  at ramp ends and crossings. Roads with only kept refs are not counted: at the Alemany merge,
  45 to 90 m of `I 280` (`35184399703420`) lies within 6 m of the removed connector `19280000` and
  stays drawn as I-280, as errata 1 intends. Kept coverage lost (kept CNN line metres a freeway road drew within
  15 m before the split and none after, measured apart from the rule): at most 25 m per segment
  and zoom (`i80-bay-bridge` at z11, at its shared end with the removed I-80; `us101-south` 11 to
  15 m near the Alemany cut), under the 30 m limit; I-280 and the Presidio segments lose none.
  No feature with ref `I 280` or `CA 1` moves.
- **US-101 is cut at the Alemany interchange:** `19222002` moves to the kept `us101-south` with
  six lots of `us101-bayshore` (285 FZP homes, 0.85 ha). After the split, the removed US-101 of
  `us101-bayshore` starts at lat 37.73497 (the southbound cut at the I-280 crossing) at z11, z13
  and z15, and the kept US-101 reaches lat 37.73862 (the north end of `19222002`).

## Freeway land

The catalog format, its build rule and the V17 and homes checks are in [pipeline.md](pipeline.md)
("Freeway land"). This section is the candidate command.

`npm run pipeline -- lesscars-freeway-land [--dataset <v>]` proposes parcels for each segment of
`pipeline/enrichment/lesscars/freeway-land.json` into `freeway-land.candidates.json`. It never
writes the catalog: the curated list is the source of truth, not the rule. It normalises the
locked sources, runs the SQL stage on a fresh DuckDB (no chunks, no tiles), then
`pipeline/sql/86_freeway_land.sql`, and prints one line per segment. A segment naming a CNN
`src_streets` lacks exits 1 and writes nothing.

The rule, with its `LC` values (`pipeline/lesscars-config.ts`, tier 4):

- A parcel is a candidate when it holds 0 homes and is `VACANT`, or is zoned `P` with no building
  (height 0, floor area 0), and at least `LC.freewayMinShare` (0.5) of its area lies within
  `LC.freewayBandM` (60 m) of the segment's streets. "At least" is inclusive (a 1e-6 tolerance
  absorbs projection noise on a parcel exactly half in the band).
- Open space (land use `OPENSPACE`) is proposed with `openSpace: true`, not filtered: a park is an
  exclusion, and curation decides.
- A parcel in several segments' bands goes to the nearest segment (smaller id on a tie).
- `status` is against the segment's current entry: `listed`, `excluded` or `new`. `rowM2` is the
  unparcelled land (land mask less every parcel) within the band, a size for the drafter, not a
  list.
- With `--dataset <v>` (default: the newest `pipeline/out/<v>` with a `parcels.bin`; none for a
  fixture run) `fzpTopYield`, `hostable` and `inFlight` (ids of `projects.json` projects naming
  the parcel) are filled, else null.

The streets come from `loadLockedStreets` (`pipeline/lib/lesscars/streets.ts`), which
`lesscars-cnns` shares for the lock checks and street rows.

## Basemap ids

Can a removed freeway stretch be hidden on the basemap by protomaps `roads` feature id at every
zoom the page shows (11 to the archive's maxzoom 15), or must the tiles step split it out? The
check lists the `roads` features coming within `LC.basemapBandM` (25 m) of the removed lines and,
per zoom, each feature's full length (every tile of the archive, tile buffers counted once) and its
in-band length. A `highway` feature with an in-band share in [0.1, 0.9) is mixed: one id covers a
removed stretch and a kept one, so an id filter would hide too much or too little.

```bash
npm run pipeline -- lesscars-basemap --report --lines <removed.geojson> \
  [--pmtiles pipeline/out/<v>/basemap.pmtiles] [--band 25]
```

The provisional removed lines (a scratch file, not committed): from the locked `datasf-streets`
raw files, every `FREEWAYS` segment named `HWY 101…` with every vertex north of lat 37.7335 (the
Alemany interchange) and every `I-80…` segment with every vertex west of lng -122.3925 (the
Rincon Hill touchdown), in EPSG:4326 (96 segments, 69 of them US-101).

Measured on `2026-11-02-39fbf039/basemap.pmtiles`:

| Zoom | Highway ids near the lines | Mixed |
| ---- | -------------------------- | ----- |
| 11   | 14                         | 4     |
| 12   | 29                         | 12    |
| 13   | 34                         | 10    |
| 14   | 43                         | 10    |
| 15   | 61                         | 14    |

Verdict: **split (zooms 11,12,13,14,15)**. Ids are stable at every zoom, but US-101 merges across
the Alemany cut at z11 to z13 (`35184377160410`, 7474 of 13942 m in band at z11, 3274 of 9092 m at
z13) and unnamed highway links and the kept freeways that cross or touch the lines (I-280, CA 1,
the rest of I-80) are mixed at every zoom. An id filter cannot isolate the stretches, so Task 7b
(split the removed stretches into source layer `roads_lc` at build time) runs, not Task 7a.
`LC.basemapClipZooms` is set to all five zooms. The 25 m band counts a crossing road as mixed, so
the z14 and z15 entries overstate the merged lines; Task 6's candidate rule narrows them.

### The id list

`pipeline/enrichment/lesscars/basemap-ids.json` (absent until Plan B curates it; the mini
fixture's is `pipeline/test/fixtures/mini/enrichment/lesscars-basemap-ids.json`) lists, per
removal phase, the protomaps `roads` feature ids of the removed stretch:

```json
{
  "schema": 1,
  "source": { "sha256": "<sha256 of the protomaps-basemap lock file>" },
  "phases": [{ "project": "<highway-truncation id>", "ref": "US 101", "ids": [35184377160410] }]
}
```

`ids` are sorted and unique. The curated file is the source of truth; the candidates command only
proposes:

```bash
npm run pipeline -- lesscars-basemap [--pmtiles <file>] [--band 25]
```

For every `freeway-land.json` segment with `removedBy`, it reads the segment's CNN centrelines
from the locked `datasf-streets`, takes the `roads` pieces within `LC.basemapBandM` and keeps each
whose in-band share is at least `LC.basemapMinShare` (0.9) at any zoom, grouped by (`removedBy`,
`ref`) into phases, and writes `basemap-ids.candidates.json` beside the catalog with the lock's
basemap sha256. Curate it into `basemap-ids.json` by hand.

The build (`writeLessCars`) fails when a phase's `project` is not a `highway-truncation` of the
plan, or when a listed id is in no `roads` tile at z11 to z15 within the phases' lines' bounding
box plus 500 m (`basemapIdsMissing`; was the basemap rebuilt?). A `source.sha256` other than the
lock's basemap is only a warning: the ids are what is checked. The step returns each phase with
its project's CNN lines (`basemapPhases`) for the tiles split. The list is read by `build.ts`
(live or fixture file by kind) and is not a published file.

### The split: `roads_lc`

The build splits the listed stretches out of the basemap (`writeBasemap`, `pipeline/steps/tiles.ts`;
`splitRoadsTile`, `pipeline/lib/lesscars/basemap-split.ts`). Each phase with lines gets a
corridor: its project's CNN lines buffered by `LC.basemapBandM` (25 m) with flat caps in EPSG:7131
(`splitPhasesOf`). Every tile of the archive, at every zoom over its header bounds, is decoded and
re-encoded (`rewritePmtiles`, `pipeline/lib/pmtiles-rewrite.ts`: an MBTiles file written with
`node:sqlite`, then `pmtiles convert`; tiles away from every corridor are re-gzipped, identical once decompressed). In
the `roads` layer:

- every listed id, at every zoom, whatever its kind, and on `LC.basemapClipZooms` also every
  unlisted freeway road (`kind = 'highway'`, or any link: `is_link`, whatever its `ref` or none)
  is clipped at the corridor: each line is cut where it crosses a corridor edge, and a piece is
  inside when its midpoint is (tile units);
- each inside piece is then labelled in 2 m steps. A step moves to the phase, among those whose
  corridor holds it, with the nearest of its CNN lines that the step runs along: within
  `LC.basemapBandM` and with directions within `LC.basemapParallelDeg` (45°). A step stays when a
  kept freeway's CNN line it runs along is nearer (the catalog's segments with `removedBy` null,
  `basemapKeep` from the step), and when it runs along no removed line, so a road that only
  crosses the corridor stays; a listed id moves in that case unless a kept line runs along it. An
  unlisted road whose `ref` tokens are all refs only kept segments carry (`keptOnlyRefs`: `I 280`,
  `CA 1` on the live catalog) is never clipped, so I-280 keeps the pieces where the removed
  US-101 connectors merge into it. An unlisted road's stretch that would move but has the kept
  side (a step a kept line wins) on both ends, skipping steps along no line, stays when it is at
  most 30 m long (`STRAY_MAX_M`): a kept US 101 or I 80 road drawn nearer a removed line for a
  short way is not hidden. A longer stretch (a removed ramp merged with kept ones at low zoom) or
  one at the end of the line or next to a part outside the corridor (a merge past the cut) moves;
- the moved pieces go to source layer `roads_lc`, with the feature's id and properties plus
  `lc_project`;
- the other pieces stay in `roads` with the same id and properties. A feature is never moved
  whole, so a low-zoom merge that also covers a kept stretch, or a kept freeway or link that
  crosses or continues a removed one, keeps its part.

Other layers and features are re-encoded unchanged; `vector_layers` gains `roads_lc`. Without
phases (no id list: the live build until Plan B) the archive is copied byte for byte. The count
`tiles.basemap_split_changed` is the number of tiles rewritten. On the mini fixture the listed id
(Mission Street, a stand-in crossing the mini I-80) exists at z14 and z15 only, and two tiles
change. The rewrite is deterministic (same bytes across builds); the golden does not compare
`basemap.pmtiles`.

To see what the split does without a build:

```bash
npm run pipeline -- lesscars-basemap --split [--pmtiles <raw archive>]
```

It reads the phases of `basemap-ids.json` with their catalog segments' CNN lines and the kept
segments' lines, runs `splitRoadsTile` over the raw locked archive's tiles near the corridors at
z11 to z15 (a built `basemap.pmtiles` is already split), and prints, per phase, every feature
moved to `roads_lc` (id, kind, kind_detail, ref, metres per zoom), then the freeway roads left in
`roads` along a removed line (nearer it than any kept line, within 8 m). Last, per kept catalog
segment and zoom, the kept coverage lost: each kept segment's CNN lines are sampled every 4 m,
and a sample is drawn when a freeway road lies within 15 m of it in any direction (`COVER_M`);
the loss is the metres drawn by the raw tile and not by the split one. This measure does not use
the rule's own comparisons, so a kept road the rule hides shows here. A segment losing more than
30 m at a zoom (`KEPT_LOSS_MAX_M`; shared ends with a removed stretch account for up to 25 m)
prints a `FAIL` line and the command exits 1. Each segment counts once, in the tile holding its
midpoint. It takes about 2 s.

`plan.json` names the split phases in the optional `basemapHide`
(`[{ projectId, ids }]`, the phases with lines, in id-list order; absent when there are none).
V35 checks each `basemapHide` project is a `highway-truncation`.

The style draws `roads_lc` with a clone of every protomaps layer on source layer `roads`,
`${id}__lc`, placed right after it (`LC_ROADS_SOURCE_LAYER`, `src/lib/map/style.ts`), so a moved
piece looks as it did. `/sim` and FZP draw the clones unfiltered. `/lesscars` installs
`installBasemapHide` (`src/lib/lesscars/basemap-hide.ts`) beside its own layers: from a project's
`openDay` each clone's filter becomes `['all', own, ['!', ['in', ['get', 'lc_project'],
['literal', removed]]]]`, where `own` is the clone's style filter converted to an expression
(`toExpressionFilter`, `src/lib/map/filter-expr.ts`: a legacy filter mixed into an expression
`all` would be misread). Filters are set only when the removed set changes and restored when
scrubbing back. A theme switch sets paint properties only, so the filters survive it. A plan file
without `basemapHide` (the published `2026-11-02-39fbf039`) sets no filter and the page renders as
before.

## The page

`/lesscars` (`src/routes/lesscars/`, plan `docs/superpowers/plans/2026-11-01-lesscars-2-page.md`)
plays the stored representative future of the plan from `LESSCARS_START` (2028-01-01) to
`LESSCARS_HORIZON` (2068-12-31). It opens paused at the start; nobody edits anything but the day
(scrub, play) and the map. The header has a "Fewer cars" mode link to it (third after Paint and
Simulate, `aria-current` on the route). From lg (1024 px) the mode links sit inline in the header;
below lg the header is the phone layout and the links and the actions are in the Menu. The link
text is always "Fewer cars". Between lg and xl (1280 px) the site name shows "SF Housing" only (its
accessible name stays "SF Housing Simulator") and the mode links take `px-1` and `gap-2`, so the
`/sim` row fits at 1024 px.

| Area                                       | Code                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Route and load states                      | `src/routes/lesscars/+page.{ts,svelte}`, `lesscars/load.ts`      |
| Page body (map, scrubber, header, dialogs) | `src/lib/lesscars/LessCarsMode.svelte`                           |
| Plan features by day                       | `src/lib/lesscars/features.ts`                                   |
| MapLibre layers and epoch-gated filters    | `src/lib/lesscars/map-layers.ts`                                 |
| Headline, details, chart, map key          | `HeadlineBar`, `DetailsPanel`, `ExtraChart`, `legend.ts`         |
| Timeline and evidence dialogs              | `TimelineDialog`, `EvidenceDialog`, `evidence.ts`                |
| Building card                              | `src/lib/lesscars/LessCarsCard.svelte`                           |
| Playback worker host, builds, client       | `src/lib/sim/lesscars/{playback-host,builds,playback-client}.ts` |
| Debug hook                                 | `src/lib/lesscars/debug.ts`                                      |
| e2e                                        | `e2e/lesscars.spec.ts`                                           |

### Load states

The universal load (`loadLessCars`, also run during SSR) never throws: a manifest without
`scenarios.lesscars` gives `no-scenario` ("This dataset has no fewer-cars plan yet.", a link to
`/sim`, no map and no worker); a failed fetch, a malformed file or a `datasetVersion` mismatch
gives `error` with a Retry that calls `invalidateAll()`. `ready` mounts `LessCarsMode` under
`{#key data.data.manifest}`, so a new manifest remounts it on a fresh map.

### Data flow

- **Main thread:** the manifest, the FZP `calibration.json` (the timeline lookups SimMap needs) and
  `scenarios/lesscars/{plan,sites,summary}.json`. The plan's streets, lines, stops, freed land and
  the headline come from these alone, so they keep working while the buildings load or fail.
- **Worker (playback host):** `scenarios/fzp/parcels.bin`, `projects.json`, `calibration.json`,
  `scenarios/lesscars/timeline.bin` (decoded against parcels.bin) and the parcel chunks for
  massing. It simulates nothing.

### Request flow

`PlaybackClient.init` posts `initPlayback` (manifest, plan, sites) with a new rev. The host
answers `ready`, then `playbackLoaded` (the seed, label points of the parcels the plan names and
the reservation verdicts; the page builds the garage markers from these), then `playback`
revisions: revision 0 holds the sites cell, every ready cell and the full demolish list; later
ones one per packing slice as chunks arrive. `playbackCard` answers a tap at the scrubbed day (a
token drops stale answers; a new month re-asks). The page sends `prefetch` for the viewport on
the first revision after each init and on every `moveend`. Until SimMap's handle exists,
revisions and chunk statuses queue in order. A crash shows "Couldn't load the buildings." with a
Retry that restarts the client.

Freed sites are not in parcels.bin, so the host packs every freed-site build once into the
synthetic cell `lc-sites-cell` (`SITES_CELL`). Each initiative build becomes an ordinary
`Schedule` (origin `simulated`, id `lc-build:<siteId>`) inside the worker only, for massing,
packing and cards.

### Street states and layers

A street project draws `works` from its start day and its open state from its open day:
`laneState(lanes)` for a street change (no car lane: pedestrian, else transit, else bike; with
cars: transit or bike, or nothing), `transit` for bus lanes and tram priority, `removed` for a
removal or highway truncation, and `grade` (underpass filled) for a display from its source
project's opening. Events on one segment sort by day, then plan order, so one project's start
precedes its open on the same day; each state lasts until the next event.

The 13 layer ids are `LC_LAYER_IDS` (`map-layers.ts`): `lc-sites-fill`, `lc-sites-outline`,
`lc-street-{works,transit,bike,pedestrian,removed,grade}`, `lc-lines`, `lc-stops-circle`,
`lc-stops-label`, `lc-garages-circle`, `lc-garages-label`. Each street state differs by width or
pattern as well as colour, and has a map-key row. Every feature carries `[from, to)`; an
open-ended `to` is stored as 2^31−1 in the map sources (a vt-pbf varint). Filters are
epoch-gated: `setDay` finds the day's epoch among the sorted event days (O(log n)) and calls
`setFilter` only when the epoch changes, keeping the features live on that epoch's start day. So
the map is a pure function of the day, backwards as well as forwards.

A garage on a `{ parcel }` site is drawn only when its reservation was kept in the
representative seed; a voided one draws nothing (the summary does not count it). fixture-0's
representative seed voids both reservations.

### Header

The headline (`summary.extra.mean` at 2068, with the p10 to p90 band) sits in the header's
pinned slot as one button; it opens the details (breakdown that adds to the headline, chart,
amenities note, map key, evidence). Timeline and Evidence are header actions, in the Menu below
1024 px.

Under the breakdown the details give the freed-land disclosure from `sites.json`
(`freedLandSplit`): hectares from freeway-land parcels (`parcelM2`) and from right-of-way (the rest
of each site's area), to one decimal, held sites excluded; with no parcel land it says only the
roadway figure. When `summary.garageCost` is present and above 0, a second line gives the homes
the edge garages' footprints cost. A held site (`heldBy`) is not drawn by `siteFeatures`: it is
garage land. The disclosure is shown only when some site carries a `parcels` key (the v1.1 sites file; the key is absent in v1 files and when empty), so a published v1 dataset renders its details exactly as before: no freed-land line at all. A dataset without `heldBy` or `garageCost` shows no garage line.

### Scrubber markers

`scrubberMarkers` gives SB 79 at `switchDay` and each transit-line opening. `TimeScrubber` (shared
with `/sim`, unchanged) places markers absolutely, so near ones would overlap (WCAG 2.5.8):
`LessCarsMode` measures the scrubber's range input with a `ResizeObserver` and passes the width to
`mergeMarkers(markers, trackPx, minPx = 48)`, which folds a marker into the previous kept one
when their centres are closer than `minPx`. The merged marker keeps the first label and day; its
accessible name lists every event ("Jump to SB 79; Fixture subway opening, December 2032"). On
fixture-0 the two markers merge at both 1280 and 375 px.

### Debug hook

`window.__sfhLessCars` (`src/lib/lesscars/debug.ts`), VITE_E2E builds only, read-only getters:
`phase`, `day`, `playing`, `seed`, `revision`, `cells`, `reservations`.

### e2e notes

- Run: `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts` (both
  projects).
- Every expected value is read from fixture-0 on disk (`plan.json`, `sites.json`, `summary.json`,
  `timeline.bin` decoded against `scenarios/fzp/parcels.bin`); none is hard-coded.
- Map assertions call `queryRenderedFeatures` on the layer ids above after a repaint and `idle`,
  so they check what MapLibre drew, not the sources.
- The no-plan test strips `scenarios.lesscars` from `manifest.json` with `page.route` and reaches
  `/lesscars` by client navigation from `/about` (a first load takes the manifest from SSR); with
  no header link yet, it clicks an anchor the test adds.

### Known gap

Map picking is pointer-only (mouse click, touch tap), as on `/sim` (see "Known gap" in
[fzp-mode.md](fzp-mode.md)): a keyboard user cannot open a building card.

### Builder's calls

- Representative future only: the map plays the plan arm of the representative seed, with no
  baseline toggle.
- No `Schedule.origin` extension: initiative builds become `simulated` Schedules with the
  `lc-build:` prefix inside the worker.
- Own card, not `ProjectCard`: what the building is, homes, stories, status and dates.
- Freed sites are one synthetic cell (`lc-sites-cell`); parking builds stand on real parcels.
- Street geometry stays in `plan.json`; garage parcel positions come from the worker.
- Plan stops only (`lc:` ids); existing stops are not redrawn and `transit.json` is not fetched.
- The Masonic underpass is an optional, display-only `displays` entry (Plan 3 adds it).
- A load failure's Retry calls `invalidateAll()`; a worker crash's Retry restarts the client.

Follow-up: `LessCarsMode` copies `FzpMode`'s map-ready queue, chunk-status tracking and prefetch
wiring rather than sharing them; a shared helper would remove the duplication.
