# Road-like lots: not candidates for building

Status: approved by the owner, 2026-11-07. The imagery review before release is the builder's, written up in the build note (owner's decision).

## Why

Staging builds simulated projects on lots that are road: street remnants, medians, slopes,
undedicated streets, strips under ramps and kept freeways. No one will ever develop them, with
the road in place or not. They inflate the theoretical buildout and look absurd on the map.

The freeway-land catalog (lesscars v1.1, dataset `2026-11-02-0d40e1e2`) already removes lots
under freeways that a /lesscars plan removes. This covers the rest.

Size, from a one-off investigation on `0d40e1e2` (its scripts and table are not in the repo;
the build re-measures everything): about 243 hostable road-like lots, 28 ha, about 9.0k top-fill homes;
151 of them zoned P. No single lot above 588 homes.

## Goals

- Road-like lots are not candidates for building: not hostable in `/sim`, FZP, or either
  /lesscars arm.
- Detection by a stated rule over locked sources, plus a small curated override file; no
  hand list of hundreds of lots.
- Real developable public land stays buildable. Precision matters more than recall: a missed
  median costs a few homes; excluding a housing site is wrong.
- The change to `/sim`'s and FZP's numbers is measured and recorded before release.

## Non-goals

- Campuses, utility and transit yards zoned P (CCSF, SFSU, Lowell, SF General, Muni yards):
  about 100k of the 112k homes on hostable P lots. Separate question, separate design.
- Parks mislabelled as buildable (e.g. 3761063, the dog park under I-80). Separate.
- /lesscars reallocating road-like lots on removed streets to freed land (see "/lesscars").

## Anti-goals

- Excluding Treasure Island development parcels, the Octavia Blvd housing parcels or any
  surplus-site or SFHA parcel.
- Foreclosing /lesscars: a road-like lot must still be able to enter the freeway-land catalog
  and be freed by a plan.
- Hiding the lots from the map or changing their drawn buildings.

## Data: City Lands as a new source

Add DataSF "City Lands" (Socrata `gtnh-hgvs`) as a locked DataSF source, `datasf-city-lands`:
the city-owned lots with their department and `land_name` (names such as "... ROW",
"REMAINDER", "SLOPE", "MEDIAN", "UNDEDICATED", "VACATED", "OVERPASS"). Registered like the
other DataSF sources (`pipeline/sources/datasf.ts`, `normalise.ts`, the lock, the fetch test,
`docs/dev/pipeline.md` source list, the attribution page's prose if its licence needs a line).
It does not join `AS_OF_SOURCE_IDS`.

Licence: confirm on the portal before the fetch. If it is not compatible with the data's
ODbL/PDDL publication, stop and report.

## The rule

A lot is **road-like** when all of:

1. **Public owner:** zoning `P`, or roll class one of `VPUB, VG, IXG, IG, PLG, OG, GG, EG`, or a
   City Lands row.
2. **Little building:** Overture footprint cover under 25% of lot area (`sum(pieces.area_m2) /
   parcel area`). Not `floor_area_m2 > 0`: neighbours' footprints leak into it.
2a. **No homes:** existing units 0. A lot with homes is not a road. (Builder's call.)
3. **Not in the freeway-land catalog** (catalog membership wins; the two sets are disjoint).
4. **Not kept by the override file.**

and any of:

- **R7, the name:** its City Lands `land_name` matches the road-name list, case-insensitive.
  The investigation's list: `RIGHT-OF-WAY`, `ROW` (word), `R/W`, `ROADWAY`, `OVERPASS`,
  `MERIDIAN`, `SLOPE PROTECTION`, `REMAINDER`, `PEDESTRIAN BRIDGE`, `STRIP ALONG`,
  `UNDEDICATED`, `VACATED`, `STREET AREA`, `REALIGNMENT`, `EXCESS PROPERTY`, `WALKWAY`,
  `TRAFFIC ISLAND`, `FREEWAY`, `BART TRACKS`, `MEDIAN`, `RELINQUISHMENT`, plus `PLAZA` and
  `CIRCLE`, which are broad: keep them only if every lot they match on the live data is a
  road (check the matched names; otherwise narrow, e.g. `CHAVEZ ST CIRCLE`). The list lives
  in code with a test per word.
- **R1n, the strip:** no building, and maximum inscribed circle radius under 3.5 m.
- **R2s, beside the street:** no building, at least 80% of its area within 10 m of a public
  street centreline (`src_streets`, not FREEWAYS layer).
- **R3, on the freeway:** a FREEWAYS-layer centreline crosses it or lies within 40 m.

Or it is listed as road-like in the override file.

"No building" in R1n and R2s means footprint cover under 5% (slivers of neighbours'
footprints leak into lots; zero would miss real strips). Builder's call.

Measured on `0d40e1e2` (labels partly circular, so estimates): 213 lots, precision about 99%,
recall 86% by count and 97% by homes. Known false positives to keep by override: 5431A028,
5415013 (check on imagery first; they may be real strips) and the one school lot the
investigation names.

### The override file

`pipeline/enrichment/road-lots.json`: `{ keep: [{ parcel | block, reason }], road: [{ parcel,
reason }] }`. Every row has a reason. Treasure Island (block 1939 and the 89xx blocks) and the
Octavia Blvd parcels are `keep` rows. Prettier-checked like the other enrichment JSON.

### Where it applies

As `underwater` does: `parcel_out.eligible` is false for a road-like lot, so it leaves T11
`parcels.bin`, the T13 panel, the Paint editor and both /lesscars arms at once. A reason code
(`r7`, `r1n`, `r2s`, `r3`, `override`) ships in the chunk record beside `uw`, for a later
tooltip and /lesscars use. This work ships the data field only; no `src/` UI change.

Builder's calls recorded:

- The underwater path, not the freeway-land path (freeway land stays paintable because a plan
  can free it; a road lot has no such future today).
- That includes the T13 calibration panel, unlike freeway land: a road lot was never hostable
  in the past market either, so leaving it in the panel overstates the hostable base the
  calibration divides by. `calibration.json` therefore changes; the change (`hostable_base` by
  year and the fitted rates) is recorded with the headlines.

## /lesscars

- Catalog lots are never road-like (rule 3), so the plan check, freed parcels and
  `carveFreedLand` are untouched.
- Road-like lots do not donate neighbour zoning to freed sites: add them to `notNeighboursOf`
  (`pipeline/steps/lesscars-sql.ts`). This moves the v1.1 /lesscars numbers slightly; the
  change is recorded.
- Six road-like lots touch freed sites (3758130, 3761063, 4339002A, 5573023, 3526017,
  3503004). They stay unbuildable when their freeway comes down unless the owner adds them to
  the catalog. Listed for the owner in the build doc; not added here (the catalog is
  owner-approved).
- Later, not now: `street-removal` could treat road-like lots along a removed street as
  right-of-way. The reason code keeps that open.

## Checks and quality

- A registered quality rule `sd.parcels.road_like` (observe, like `sd.parcels.underwater`),
  counting lots and homes per reason; `quality-doc` regenerated.
- `scenario.road_like.lots` and `scenario.road_like.net_removed` report counts, with a
  per-reason breakdown.
- V17 and V18 follow whatever they do for `underwater`.
- A test, on the rule's raw output before overrides, that every `keep` row names an existing
  parcel or block and is flagged by the raw rule (a stale `keep` row fails, so the list stays
  honest), that every `road` row is not already flagged, and that no catalog parcel is
  road-like.

## Review before release

The builder reviews on satellite imagery, as the freeway catalog's spot check did: every
flagged lot above 50 top-fill homes, every lot flagged by R3 alone, and every PLAZA or CIRCLE
match. A wrong flag becomes a `keep` row with its reason. The reviewed list, with verdicts,
goes in the build note.

Stop and report, without bump PRs, if the rebuild removes more than 20k homes of static
capacity or moves the /lesscars headline by more than 5%. (Builder's thresholds.)

## Fixture

`fixture-0`'s mini sources gain a City Lands file and at least one road-like lot per reason
plus one `keep` lot; goldens through `npm run pipeline -- fixture --update-golden` only.

## Build and release

Rebuild the live dataset locally, record in `docs/dev/pipeline.md` (or a short build note) the
lots and homes removed per reason, `/sim`'s and FZP's headline before and after, and the
/lesscars headline change. Upload, verify, staging bump PR, production bump PR, as
`docs/dev/deploy.md`. The production merge and the release stay with the owner.

## Left to the builder

- The exact `land_name` word list, from the portal's distinct values.
- The join key (block-lot) and what to do with City Lands rows that match no active parcel
  (count them; ignore).
- How to compute the inscribed radius in DuckDB (`ST_MaximumInscribedCircle` or an equivalent).
- Whether the street-centreline test reuses `86_freeway_land.sql`'s buffer pattern.
