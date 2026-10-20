# Clip lots to land: underwater area is not buildable

Status: draft for review (2026-10-19)

## Intent

Some parcels extend into the Bay, notably at Hunters Point and Treasure Island, and some lie entirely
in the water. Today a lot's full polygon counts as buildable area, so these lots inflate projected
capacity and accept painted buildings over open water. No development is expected on the underwater
parts. The simulator should treat only the dry part of a lot as buildable, in both projection (the FZP
scenario) and painting.

Several of these lots already have planned development, so the dry part must stay an ordinary lot.
This change removes water from lots. It does not remove lots.

## Goals

- Clip every lot to a land mask once, in the pipeline. The clipped polygon becomes the lot polygon
  that everything downstream uses.
- The **land mask** is the union of three layers:
  1. shoreline land,
  2. piers, and
  3. existing building footprints.

  Per the user, land under a pier or an existing building counts as buildable. That covers the
  Embarcadero piers, pier sheds, and structures built out over the water.
- Lot area, density caps, the large-lot 65 ft rule, the capacity check, scenario yields and the
  generator's footprints all follow from the clipped polygon. None of them needs a separate "buildable
  area" field.
- A lot that is entirely underwater after clipping stays in the dataset and stays visible on the map,
  but it is flagged unbuildable. Projection gives it zero yield, and painting builds nothing on it.
- The quality report states what the clip did, so a reviewer can catch a bad mask:
  - how many lots were clipped,
  - how many lots are fully underwater,
  - the total area removed,
  - the largest single removals.

## Non-goals

- No change to zoning rules, typologies or the FZP model beyond the change in lot area.
- No runtime geometry in the worker. The rule stands: the worker does no geo computation.
- No user-facing control to turn the clip off.
- No attempt to model proposed fill or future shoreline changes. The mask describes the shoreline as
  it is today, plus what is already built.

## Anti-goals (a failure even if it technically works)

- A planned-development lot at Hunters Point or Treasure Island loses buildable land it actually has,
  or disappears.
- Pier lots along the Embarcadero lose their existing buildings' footprint.
- Mask noise shaves slivers off ordinary inland lots across the city. A lot that touches no water
  should come out of the clip unchanged, give or take float noise.

## Current state (from recon)

- Lots come from DataSF parcels `acdm-wktn`. `pipeline/sql/10_parcels.sql` builds `parcels.geom` in
  EPSG:7131 (metres). `60_attributes.sql` derives `parcel_out.area_m2`. `pipeline/steps/chunks.ts`
  encodes the rings into `parcels/<cell>.json`.
- `ParcelRecord.areaM2` is recomputed from the rings on both sides (`chunks.ts:64`,
  `src/lib/data/parcel-chunk.ts:147`). The scenario's `lot_area_m2` comes from it
  (`pipeline/steps/scenario-sql.ts`).
- The generator builds inside the polygon. `normaliseSite` keeps the largest outer part, and painting
  runs the same `generate(rec)` in the worker host. Clipping the polygon upstream therefore constrains
  both modes.
- Masks available today:
  - None is applied to parcels.
  - The pipeline already extracts the Protomaps basemap (OpenStreetMap, ODbL, already credited). It
    contains land/earth, water and pier features, but they are only drawn on the map.
  - DataSF analysis neighbourhoods (`j2bu-swwd`) are also fetched already.
  - A `buildings` table already exists (`30_buildings.sql`).

## Decided

- **Clip, don't drop.** A partly underwater lot keeps its identity (`mapblklot`), its attributes and
  its dry geometry (user).
- **Piers and existing buildings count as land** (user).
- **What already exists stays; the water gets no new development** (user). Existing homes on the roll
  and planned or entitled projects are left as they are, including on lots that are fully underwater.
  The clip affects only new capacity, meaning projection headroom and painting.
- **Settle the area questions with data, not guesses** (user). Before planning, a throwaway spike
  computes the clip for the real dataset and lists every affected lot, how much area it loses, and
  what that does to projects and to existing-home caps that depend on lot area (`inflight.ts`
  capacity, `sd.roll.units-capacity`). It also checks how well the mask covers the piers. The
  findings decide whether those checks use clipped or original area, and whether the pier source is
  good enough. See "Spike findings" below.
- **The clip happens in the pipeline, before area and chunk encoding** (my call, following from recon).
  Because the mask includes building footprints, the clip runs after `30_buildings.sql` and before
  `50_clip.sql`, and the parcel label points are recomputed on the clipped geometry.
  It should sit as early as practical, in or right after `10_parcels.sql`, so every later step sees
  clipped geometry. The builder should check whether `50_clip.sql`, which clips buildings to parcels,
  wants the clipped or the original parcel. My expectation is clipped, so building pieces over water on
  a lot that has no building there today are not attributed to that lot. Since buildings are part of
  the mask, existing buildings are not cut.

## Builder's calls (with my preferences)

- **Land source.** Prefer the OpenStreetMap land already in the Protomaps extract, plus Protomaps
  `pier` features. It adds no new source or licence, and OSM's SF shoreline and piers are well mapped.
  Getting polygons out of z15 vector tiles takes some work: decode, stitch, and union across tile
  edges. If that proves awkward, an acceptable fallback is a small purpose-made fetch of the same OSM
  data, or Census TIGER `AREAWATER` for county 06075 (public domain; subtract it from the lot).
  Whichever source is used goes in the lockfile and in the attribution if it is new. Check the analysis
  neighbourhood polygons only as a cross-check, not as the mask, unless they turn out to follow the
  shoreline closely.
- **Tolerance.** Buffer the mask slightly, or snap it, so that shoreline jitter does not nick inland
  lots. Discard clip remainders and removals below a small threshold; `min_piece_m2` or `MIN_SITE_M2`
  is the natural reference. Lots whose removed area falls below that threshold keep their original
  geometry exactly.
- **Multi-piece results.** If a clip splits a lot, keep every dry piece in the polygon so that area
  counts all of it. The generator already builds only on the largest piece. I'm accepting that
  mismatch rather than changing the generator.
- **Fully underwater lots.** They are represented as unbuildable. My preference is the existing
  eligibility route: make `eligible` / `scenarioEligible` false for them, and keep their original
  outline so they can still be seen and clicked. Painting one should produce nothing, the same as any
  other site too small to build on. The builder picks the exact representation in chunks and
  `parcels.bin` and documents it.
- **Display.** The map draws the clipped outline for clipped lots.
- **Painting message** (my call). Painting on a fully underwater lot gives its own reason, "in the
  Bay", rather than the generic "not eligible" text. That means the chunk carries an underwater flag
  that is separate from `eligible`.

## Spike findings

The spike ran on 2026-10-19 against the raw cache in the `fzp-dataset-staging` worktree. It
re-ran the real `writeScenario` and `writeProjectRecords` on original and on clipped geometry. The
baseline run reproduced the published `parcels.bin` and `projects.json` byte for byte. Its artefacts,
including scripts, a CSV and GeoJSON of every affected lot, and plots, sit in the session scratchpad
under `landmask-spike/` and are throwaway.

### Mask used

- Protomaps `earth` plus `landuse kind=pier` polygons, decoded from the existing
  `protomaps-basemap.pmtiles` at z15.
- Each tile is clipped to its own bounds, then the tiles are unioned and the seams closed.
- The pipeline's `buildings` table is added to that.
- Buildings add almost nothing (0.17 ha on 7 lots), but stay in as the user asked.

### Impact

- **Lots affected.** 972 lots lose 5 m² or more, 572 ha in total. 220 are partly clipped. 752 are
  fully underwater, and all of those are VACANT: 746 paper-street lots in Bayview Hunters Point, 2 in
  the Marina harbour and 4 in Potrero.
- **Largest removals.** Treasure Island's submerged lots (258 ha) and the Hunters Point Shipyard lot
  4591A090 (120 ha).
- **Jitter.** It is negligible. Ten shoreline lots lose under 5 m² (largest 4.3 m²), and no inland lot
  is touched.
- **FZP yield at full fill** drops by 10,551 (−0.54%); at 50% fill it drops by 1,371. Most of the drop
  is marina lots the model treated as buildable: South Beach Harbor goes from 3,148 to 0, and the
  Pier 39 west marina from 845 to 17. Only 2 fully underwater lots had any yield.
- **Projects and roll caps.** Nothing changes. `projects.json` and the histories are byte-identical.
  The four in-flight projects on clipped lots (Candlestick/HPS Phase 2, Treasure Island/YBI, Potrero
  Power Station, Mission Bay North) pass the capacity check by a wide margin either way.
  `sd.roll.units-capacity` fires on the same parcel-years.
- **Piers.**
  - With pier polygons, Embarcadero piers that still stand keep 75–100% of their area, and Treasure
    Island's populated and project lots keep 86–100%.
  - The pier polygons rescue piers that `earth` misses.
  - Every lot that loses its deck is a pier that no longer exists: old Pier 24, Piers 34, 36 and 64,
    Pier 43, and the Pier 70 finger piers.
  - Buffered pier *lines* mostly add marina docks.

### Decisions from the findings (my calls, from the evidence above; all reversible)

- **Area checks use the clipped area.** The project capacity checks (`inflight.ts`) and
  `sd.roll.units-capacity` use clipped area. No outcome changes, so they need no second area field.
- **Mask source is settled.** It is Protomaps `earth` ∪ `landuse kind=pier` polygons ∪ `buildings`.
  Pier lines are excluded because they would make marina water buildable. TIGER is not needed. This
  replaces "Land source" under the builder's calls.
- **Lineage keeps the original polygon.** Spatial lineage matching (roll-to-parcel history) runs on
  the original polygon. In the spike, clipping broke 7 lineage matches and left 804 historic roll units
  unmatched (mainly 4046002). Keep the original geometry available for lineage and clip only what
  feeds area, chunks and the generator.
- **Clipped edges are snapped and simplified, at about 0.5 m.** The spike's lot 9900019H kept 99% of
  its area, but its yield fell from 48 to 0 because the new edge followed every OSM coastline vertex.
  The builder adds a test or quality check for "keeps more than 95% of its area but loses all yield".
- **Tile decoding happens in the pipeline's TypeScript.** The spike decoded in Python. The builder
  picks pipeline-only dev dependencies (for example `pmtiles` plus a vector-tile decoder). These do
  not ship in the bundle, so no `SOFTWARE` credit is needed. OSM data is already credited through the
  basemap's lock entry.
- **Acceptance numbers.** The full build should land near the spike: about 970 affected lots, about
  750 fully underwater lots, and an FZP full-fill drop of about 0.5%. A large departure means the
  builder investigates before releasing.

## Constraints

- Published dataset versions are immutable. This ships as a new `datasetVersion` through the normal
  pipeline release (`docs/dev/pipeline.md`).
- Fixture `fixture-0` gains at least one lot that crosses the shoreline and one that is fully in water,
  with tests covering:
  - area reduced to the dry part,
  - zero scenario yield for the underwater lot,
  - painting on the underwater lot builds nothing,
  - an inland lot unchanged.
- Re-check `config.ts` invariants such as `parcelRange` and the quality rules against the new counts.
- Pipeline tests run under `npm run test:pipeline`.

## Acceptance

- In a full build, inspect the clipped outlines at Hunters Point, Treasure Island / Yerba Buena, Mission
  Bay, Pier 70 and the Embarcadero piers. Expect dry land kept, water removed, and piers and pier
  buildings intact.
- The quality report's "largest removals" list holds no surprises (no inland lots).
- The citywide FZP total drops by a plausible amount, and the change is attributable to the clipped
  lots.
