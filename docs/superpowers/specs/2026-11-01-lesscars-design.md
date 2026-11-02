# /lesscars: a fewer-cars city, 2028–2068

Status: draft for discussion. Calls marked **(my call)** were made by the drafter, not the owner.

## Intent

This is an experiment. It asks whether a fewer-cars program is a real housing axis: does giving
street space back to transit, walking and building unlock materially more homes than zoning
alone?

The owner does not know in advance what would change most. Finding that out is the point, so the
page shows its working: which strategies produced how many homes, and when.

The page is inspired by the Fillmore. There, urban renewal razed housing and widened Geary into an
expressway. Accounts vary, but a commonly cited figure is about 6,000 low-cost units destroyed and
about 2,000 built across the whole redevelopment (weak sources; see References). This plan is the
opposite: an integrated program in which transit comes first and freed land becomes housing.

### The scenario

A national "make America cheap again" initiative passes in 2028. It gives San Francisco full
authority over its streets and the money to use it:

- resize, close or demolish streets and highway segments;
- build new Muni subway, tram and BRT lines and stops;
- site parking garages near the city's entrances, where people leave or pick up cars;
- make lanes bus-only, convert lanes to bike use, and pedestrianise streets.

Authority and budget are assumed; **speed is not**. Projects follow realistic durations and
sequencing. The owner's observation is that projects that stall between approval and construction
today mostly founder on financing. The initiative removes that cause, so the binding limits are
construction duration, construction capacity, and ordering.

## What the page is

A standalone route, `/lesscars`. It is not a lever in `/sim`. It plays one fixed plan from 2028 to
2068 against a baseline. Nobody edits anything on it except the year (scrub and play) and map
layers.

Later, after a few iterations, parts of the plan may become `/sim` policy choices. Nothing here
should block that, but nothing here builds toward it either.

## Goals

1. **Watch the city change.** Scrubbing 2028 → 2068 shows:
   - streets changing state (car lanes → bus-only, bike, pedestrian, removed);
   - new transit lines and stops appearing as they open;
   - edge garages and the car-shuttle line appearing;
   - buildings rising on freed land and on newly upzoned lots.
2. **Answer the question.** A headline number: homes by 2068 under the plan minus homes by 2068
   under the baseline. Behind a tap, the difference split by source:
   - **freed land**: homes on parcels created from removed street or highway right-of-way;
   - **parking sites**: homes on former surface lots and garages;
   - **transit-unlocked**: homes on existing lots that reach a higher SB 79 tier because of a plan
     transit project;
   - **other**: anything left over, so the parts sum to the whole.
3. **Show the schedule.** A timeline of plan projects (start, open), so the viewer sees that
   housing follows transit and not the reverse.
4. **Show the evidence.** Every plan parameter (durations, capacities, frequencies, footprints)
   carries its evidence tier and source, as `/sim`'s timers do.

## Non-goals

- No editing: no brushes, no plan builder, no levers, no saving or sharing.
- No traffic model: no car travel times, congestion, or mode-shift forecasts. Ridership only
  matters where SB 79 needs frequency, and those frequencies are plan inputs.
- No cost model. Budget is assumed. A cost appendix may come later.
- No displacement or demographics model.
- No change to `/sim`, its levers, or the "street size is not a reason to upzone" rule there.

## Anti-goals (failures even if the page works)

- **Fillmore sequencing.** A street or highway segment closes to cars before the transit that
  replaces it opens. The plan data must make this impossible, and a pipeline check must fail on it.
- **Demolishing homes for the plan.** Transit, garages and street changes do not take existing
  housing. New lines tunnel or run in existing right-of-way.
- **Counting amenities as housing.** Wider sidewalks, pedestrian streets, bike lanes and the car
  shuttle are shown on the map. They add zero homes and appear in no housing number.
- **Invented numbers presented as findings.** Unsourced parameters are labelled as such (evidence
  tier 4) on the page, not hidden.
- **Instant city.** Freed land does not fill the year it frees. It goes through the same
  build-rate machinery as every other lot.

## Law

- 2028 to the switch year: FZP as written, as `/sim` uses today.
- From the switch year: each lot gets **the larger of FZP and SB 79** (owner's decision). SB 79 as
  written (`pipeline/lib/sb79.ts`) applies where its status is `applies`, the lot is not
  permanently exempt, and SB 79 allows more than FZP; FZP applies everywhere else. This is the rule
  the retired `CURRENT_LAW_SWITCH` used (see `docs/dev/sim-levers.md` at commit 53e8d5f). SB 79 is
  recomputed against the transit network as it stands each year. It is used because its tiers
  respond to the plan's transit:
  - a new subway or heavy rail stop is tier 1;
  - light rail and dedicated-lane BRT stops are tier 2 (`LIGHT_RAIL_MODES`,
    `MUNI_TIER2_STOP_IDS`);
  - frequency on a mixed-traffic bus line alone does not change a stop's tier. Bus-only lanes
    matter because they make a corridor BRT.
- Switch year: **2032 (my call)**. This is the year the engine's retired law switch used. The owner
  may know the real lapse date.
- The baseline uses the same law and switch year on today's transit network, with no plan.

## The plan

The plan is fixed, authored data: a list of projects. Each project has:

- a kind;
- its geometry;
- a start year and a duration, with evidence;
- its dependencies (for example, "close Geary to cars after the Geary subway opens").

### Project kinds

- **Transit line**: new subway, tram or BRT. Stops, mode, and peak trips per hour. Its stops join
  the network on the opening year, and SB 79 recomputes.
- **Tram priority**: forbid cars on an existing surface rail line. Higher frequency. Its tier is
  unchanged (it is already light rail), but its frequency shows on the map.
- **Bus lane**: a corridor becomes dedicated-lane BRT. Its stops may become tier 2.
- **Street change**: lanes change use (bus, bike, pedestrian, sidewalk restored, service-only).
  Display only; no homes.
- **Highway truncation**: a highway ends nearer the city line. Its right-of-way beyond the new
  terminus is freed.
- **Street removal**: a street segment closes and its right-of-way becomes land. This is distinct
  from pedestrianisation, which keeps the street as public space.
- **Parking conversion**: a surface lot or garage becomes a building site.
- **Edge garage**: a structure near a city entrance. It occupies a site (ideally freed highway
  land) and has a capacity.
- **Car shuttle**: a rail service balancing cars between edge garages. Display only.

### Drafting the plan

Drafting the first plan is part of the work. The owner has not chosen corridors. The drafter
proposes them from the data and the literature, ranks parameter sources by the project's evidence
hierarchy (per-record data > official aggregates > inferences > literature > invented), and writes
the plan up for the owner to review **before** it is wired into the pipeline.

The owner's starting ideas:

- highways terminate closer to the city line, with a car-shuttle train balancing the garages;
- sidewalks regain the width they had before parking cut them back;
- dedicated bus lanes give higher-frequency service;
- forbidding cars on tram lines improves frequency;
- some or many roads become pedestrian, bike and transit only (service vehicles excepted);
- parking lots become housing or other useful structures.

Candidate places to evaluate, not decisions **(my call)**:

- the Geary subway (long studied) and the Geary expressway trench;
- the I-280 spur north of 16th Street;
- the Central Freeway stub and the Fell/Oak couplet;
- US-101 surface routing on Van Ness and Lombard;
- a Central Subway extension north;
- the 19th Avenue / M-line corridor.

**v1 has one plan (my call).** The data format allows several, and the page may later offer a
picker.

### Freed land

Removed right-of-way becomes new parcels. **Zoning (owner's decision):** the larger of the adjacent
block's zoning and SB 79 from the parcel's band (after the switch year, with the network as it
stands that year). Before the switch year, the adjacent block's zoning alone. Where a freed parcel
borders blocks with different zoning, the builder picks a consistent rule (for example, the more
permissive neighbour).

Freed land is available when its dependency opens and clearance finishes.

### The initiative builds

**The initiative builds homes itself (owner's decision)** on freed parcels and converted parking
sites, acting as a public developer:

- These sites do not go through the engine's per-lot monthly build chance. Each gets a
  **scheduled build**: a start year and a construction duration, set by the plan.
- The building is the generator's building at the site's allowed envelope (full fill).
- Scheduled builds draw on evidence-tiered durations, like the transit projects. Starts are
  limited by the plan's construction capacity (below).
- Every other lot, including lots upzoned by new transit, is built by the engine as usual. Those
  homes are the "transit-unlocked" share.

The engine has no scheduled-build path today. Adding one, for these two site kinds only, is in
scope.

### Construction capacity (my call)

Capacity limits only the plan's own work: transit, street, garage and scheduled-build projects. It
is a scheduling rule in the plan data, enforced by the pipeline check. There is no citywide cap on
private housing construction, because the engine models none and adding one is out of scope.
Initiative homes therefore do not crowd out baseline homes.

Edge garages that occupy freed land reduce the freed-land share. The breakdown reports that
honestly rather than hiding it.

## Data

- **Street geometry, page-only.** `/lesscars` needs street geometry to draw street states and to
  carve freed parcels. It does not need the per-lot frontage join that made the old
  `datasf-streets` step take about 67 minutes. Candidate source: DataSF Right of Way Polygons
  (current only to about 2014, so check it against the parcels). The builder chooses the source.
- **Parking sites.** Surface lots and garages from per-record land-use or assessor data, if it
  exists. The builder finds the source.
- **Transit.** Today's `transit.json`, plus plan projects applied by year. One network snapshot is
  needed per distinct opening year.
- **Versioned, static, on R2** under `data/<datasetVersion>/`, like everything else. The worker
  computes nothing geographic at runtime.

## How it gets made

What the owner decided:

- a standalone `/lesscars` route;
- fixed plans;
- 2028–2068;
- realistic schedules with financing assumed;
- FZP, then SB 79;
- a comparison against a no-plan baseline.

The drafter's calls:

- **Reuse the FZP timelapse.** Use the scrubber, the map view and the building generator. The
  generator's physical limits and typologies apply to new parcels unchanged.
- **Many paired futures (owner's decision).** The headline is the average extra homes by 2068 over
  many futures, with a band. The plan and the baseline run on the same seeds, so each pair differs
  only by the plan. The source breakdown is averaged the same way. The map plays one
  representative future.
- **Run the engine in the pipeline (my call).** `scenarios/fzp/` holds inputs; `/sim` draws
  timelines in the browser worker. For `/lesscars`, the pipeline runs the engine in Node over the
  paired seeds and stores the results: the summary statistics and the representative future's
  realised timeline. The page is then read-only playback. Running in the browser instead would need
  runtime stops, per-year SB 79 and synthetic parcels in the `/sim` worker. That is the expensive
  part of folding this into `/sim`, and it is deferred. The engine has never run in Node, so making
  it run there is in scope. The builder picks the seed count from cost and band width.
- **Heavy work stays off CI (owner's constraint).** The owner's laptop is much faster than the CI
  runners. The full paired-seed run happens in the local release build (`npm run pipeline`), as
  dataset builds already do. The fixture and `test:pipeline` exercise it at small scale with few
  seeds. If the new stages add materially to `.github/workflows/pipeline.yml`'s run time, move
  those steps to `npm run signoff` (`chreode.config.ts`) and out of the workflow.
- **Compact UI.** The headline difference goes in the top bar; the breakdown and the project
  timeline are behind a tap; phone header items go in the menu.
- **Accessibility.** WCAG 2.2 AA, as every page (`docs/dev/accessibility.md`).

Left to the builder:

- data sources;
- the parcel-carving method;
- how plan projects are encoded;
- map styling for street states;
- whether the baseline is a stored run or reuses an existing scenario;
- how network snapshots are stored.

## Open questions for the owner

1. **Switch year.** Is 2032 right for FZP → SB 79?

## References

- About 25% of SF land is streets (Livable City; SFMTA 2015 fact sheet: 47.35 sq mi of land).
  About 7,600 acres by arithmetic.
- 2014 SFMTA parking census: 441,950 publicly available spaces, about 275,450 on-street. Private
  residential parking is not counted.
- Parking minimums were eliminated on 2018-12-11. Planning estimated up to $50k per unit, with
  real cost likely $70–80k per space (Hanson Bridgett summary).
- Fillmore / Western Addition A-1 and A-2: figures vary widely (48 Hills; calmigration.org; J
  Weekly 2026). Primary source to check: SF Redevelopment Agency reports.
- Central Freeway removal freed 22 parcels under Prop I (1999). Build-out took 20+ years, and
  Parcel K was still vacant in 2024 (SF Planning 2020; Mission Local 2024).
