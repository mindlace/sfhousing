# Existing buildings: height steps, false fronts and mapped parts

Status: draft for review. Date: 2026-11-13.

## Intent

Zoomed in on a neighbourhood, the existing city should read as buildings. Today each existing
building is one box per footprint, extruded to a single height. A tower on a podium is a full-height
prism over the whole lot. A hospital campus is a slab at its tallest wing. A Victorian's false front
is lost in an averaged height. Sutro Tower is a 298 m block. The map communicates at city scale and
falls apart at block scale.

This is the first, modest step toward a longer goal: line a real camera up with the map camera and
get a passable overlay. That goal also needs terrain, street trees, pitched-roof geometry and better
generated buildings. Each of those is a separate pass and out of scope here. This pass only stops
existing buildings looking wrong. Grey, untextured massing is fine.

## Goals

- Existing buildings render as boxes that follow their real massing:
  - a base box over the full footprint;
  - a thin false-front strip where the street face stands above the roof behind it;
  - extra boxes where part of the building is clearly taller (tower over podium, penthouse, tall
    wing).
- Landmarks that OpenStreetMap models as building parts render from those parts. Sutro Tower,
  Transamerica, City Hall and the Ferry Building have usable parts today.
- The LiDAR is sampled where the building actually is. Footprints are registered to the LiDAR block
  by block, not trusted as published.
- It stays a MapLibre `fill-extrusion` layer: several features per parcel instead of one.
- Roof form is recorded per building, so a later pitched-roof pass is mostly rendering work.

## Non-goals

- **Model inputs.** Existing floor area and stories (`60_attributes.sql`, `81_scenario_features.sql`)
  keep reading today's `buildings.height_m` through `pieces`. The new geometry is render-only, and no
  simulation result moves.
- **Pitched-roof geometry.** `fill-extrusion` tops are flat. A pitched roof renders as a box at
  mid-roof height. Real gables and hips are the next pass: tilted faces in the deck.gl overlay the
  generated buildings already use.
- Terrain, street trees, facades and bay windows. Generated (painted) buildings are also out of
  scope.
- **Moving footprints.** Registration shifts where the LiDAR is *sampled*. Footprints and parcels
  stay where they are, so nothing new goes out of line with the parcels.
- Contributing missing parts to OSM, such as the Salesforce crown or Coit Tower. That is worthwhile
  but outward-facing; the owner decides separately.

## Anti-goals

These would make the work a failure even if it technically works:

- Any box that pokes outside its footprint.
- Facades cut off: a false front lowered to the roof behind it.
- Trees or neighbours showing up as phantom penthouses.
- Confetti: ordinary houses broken into many small steps, or a pitched roof rendered as a staircase.
- A map that pans noticeably slower (`npm run bench:map` must stay within its pass bar,
  `docs/dev/map-perf.md`).

## Approaches

Approaches considered, and which one was picked:

- **A. Register to LiDAR, then derive boxes from it. Picked.**
  - Register footprints to the LiDAR by block, then derive from the LiDAR:
    - a small set of boxes per building: base, false front, steps;
    - mapped parts for landmarks.
  - Stays in MapLibre.
- **B. Real roof geometry.** A pitched roof needs tilted faces, which `fill-extrusion` cannot draw.
  The cheapest route is non-extruded 3D polygons in the existing deck.gl overlay, not a full mesh
  layer. Most of its cost is loading existing buildings into deck.gl. Deferred to the next pass;
  this pass records the roof attributes it needs.
- **C. Fix the old mesh route.** Fit `roofer` meshes and clip them to the lots, as
  `docs/roof-city-local` did. Rejected: that branch needed the meshes to fit the footprints to
  within 1 mm, party walls included, and it never converged.
- **Borrowing someone else's meshes.** Researched 2026-11-13. The research found no openly licensed,
  georeferenced 3D mesh of SF, and no citywide LoD2 roof dataset; nothing shows SF Planning's 3D model
  as public. NC and unlicensed models of landmarks exist, but they are unlocated miniatures or scans.
  - The usable source is OSM `building:part` (ODbL), also published pre-extracted as Overture
    `building_part`.
  - Sutro Tower has 35 tower parts (legs, platforms, mast) plus about 20 base parts.
  - Transamerica has pyramidal, wing and spire parts. City Hall has a dome part; the Ferry Building
    has stepped parts.
  - Salesforce, Coit, Grace Cathedral and Millennium Tower are single ways with no parts.
- **Modelling the offset from height and camera angle.** This is relief displacement in the imagery
  the footprints were traced from. A spike tested it on 2026-11-13 and rejected it; see
  [Registration](#registration).

## Design

### Inputs

- **Footprints:** unchanged. Overture `building` (`pipeline/sources/overture.ts`) through `30`, `40`
  and `50`.
- **Building parts (new source):** Overture `theme=buildings/type=building_part` within `BBOX`.
  - Fields: `id`, `building_id`, `height`, `min_height`, `roof_shape`, `roof_height`, `num_floors`,
    `min_floor`, `sources`, `geometry`.
  - Locked in `sources.lock.json`.
  - License ODbL. Credit OSM on `/attribution` if the existing Overture credit does not already cover
    it.
- **LiDAR (new source):** USGS 3DEP `CA_SanFrancisco_1_B23` (2023), Entwine Point Tile at
  `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json`.
  - Its source tiles are EPSG:7131: NAD83(2011) / SF CS13, with NAVD88 (Geoid18) heights.
  - The EPT advertises EPSG:3857, but PDAL's NAD83(2011)→WGS84 step is a null shift. So the numbers
    are NAD83, and converting back to 7131 is exact. The pipeline's own 4326→7131 step is the same
    null operation, so all sources share "NAD83 numerics".
  - Derive once:
    - a height-above-ground surface (first returns minus ground from class-2 returns);
    - a ground surface.
  - The cached, locked artifact is the derived product, a raster or per-building tables, not the
    2+ GB cloud. The builder chooses.
- **Spike code to start from:** `docs/superpowers/design/2026-11-13-offset-spike/`. It holds the
  throwaway scripts, `models.json` and the key figures.
  - `scripts/ept.py` handles LiDAR access, `scripts/fitlib.py` the edge-gradient fit, and
    `scripts/rowhouse.py` the block fit.
  - Port what is reused into `pipeline/`; do not import from `docs/`.

### Registration

Spike results on 2026-11-13 (462 detached buildings plus 3 rowhouse blocks):

- **OSM footprints**, which is most of Overture's SF geometry, sit in two frames, interleaved
  building by building:
  - about NAD83, offset (0.0, +0.24) m;
  - about true WGS84, offset (+1.24, −0.32) m, roughly the NAD83→WGS84 datum shift.
  - On top of that is about 0.5 m of tracing noise.
- **No height or position effect.** Height and position explain none of it, so no smooth model
  predicts it. The best footprint-only predictor gets only 37–50% of buildings within 0.3 m.
- **Per-house fits are ambiguous** on rowhouse blocks: about 66% of houses in one block, because a
  row reads as one mass.
- **A rigid fit of the whole block is clear.** All three blocks were unambiguous, with the median
  edge gap falling to 0.25–0.30 m. What remains is outline-shape error (bays, rear additions) that no
  translation fixes.

Therefore:

1. **Group.** Group footprints into clusters: footprints that touch or nearly touch (within about
   1.5 m), split at streets. A detached building is its own cluster.
2. **Fit.** Fit one rigid translation per cluster against the LiDAR height edges.
   - Use an edge-gradient score that tolerates eaves.
   - Search ±3 m at about 0.1 m. Optionally try the two OSM frames first, then refine within
     ±0.5 m.
   - Record the shift and a confidence measure (peak sharpness, second-peak ratio).
3. **Fall back** when the fit is ambiguous or at the edge of the search: use the better of the two
   frame offsets, judged by score, or no shift. Flag the cluster.
4. **Sample** each building's LiDAR at its shifted position. Keep a margin of about 0.3 m inside the
   outline, because outline-shape error alone is about that size.

Optional, and the builder's call after measuring: DataSF footprints (`ynuv-fyni`) sit in one tight
frame for low-rise, at about (+1.11, −0.33) m. They could serve as a cross-check, or as a better
registration prior where they match an Overture footprint.

### Per-building boxes (buildings without parts)

All heights are measured from the building's ground reference (see [Ground reference](#ground-reference)).

1. **Main roof.** The dominant roof level over the interior, which is the footprint minus the 0.3 m
   margin.
   - If the roof is pitched, record eave height, ridge height and ridge direction. Plane fitting is
     the obvious method; the builder chooses.
   - Render the base box at mid-roof height, halfway between eave and ridge.
   - A flat roof renders at its level.
   - The base box covers the full footprint.
2. **False front.**
   - Compare the highest LiDAR heights in the band along each street-facing edge with the main roof.
     The band runs from the 0.3 m margin to about 2 m in.
   - If the street edge stands clearly above the main roof (start at 1 m), add a strip along that
     edge at that height. Make the strip the full edge length and a fixed shallow depth (start at
     0.5 m).
   - A building with false fronts on two streets, such as a corner, can get two strips.
   - This detects the facade by zone, not by edge-exact pixels, so the remaining 0.3 m of outline
     error cannot cut it off.
3. **Steps.** Interior regions clearly taller than the main roof each become a box from the main
   roof up to their height. Examples are a tower over a podium, a penthouse or a tall wing.
   - Drop regions that are small (start around 20 m²) or less than about one storey (2.5 m) above
     the roof.
   - Drop tree-like texture.
   - Cap at 4 steps per building.
   - **Flush faces.** A step region that reaches the margin is grown out to the real footprint edge.
     Towers rising straight from the street wall then get a flush face, not a fake ledge.
4. **Fallbacks.** Keep today's single box (`height_m`) when:
   - the building has no LiDAR coverage (the bbox reaches past SF);
   - the interior reads as ground, meaning the building is newer than the 2023 flight;
   - the result is flagged unreliable.

**Trees.** Registration plus the margin already exclude most canopy. A further mask is the
builder's call: the street tree list (DataSF), LiDAR vegetation classes if present, or the roof
branch's near-infrared check. Phantom steps are a review criterion.

### Mapped parts (landmarks and anything else with parts)

- Only parts with a `height` count.
- **Where counted parts cover the footprint**, they render, and no LiDAR boxes are drawn there.
  Footprint area no counted part covers is treated like a building without parts: it gets a LiDAR
  base, false front and steps, restricted to that area. It never becomes a full-footprint box at
  `height_m`, because a landmark's outline height is usually its full height and would swallow its
  parts.
- **Each part** becomes a box from `min_height` to `height`, and is not shifted, since parts are
  curated. Parts outside their building's footprint are kept; Sutro's legs are a case.
- **Roof shapes.** `pyramidal`, `dome`, `cone` and `onion` become a stack of inset tiers (start at
  4–6) from eave to top. That deliberate staircase reads as a spire or dome at landmark scale. Other
  shapes go flat at eave plus half the roof height.
- **Measure first.** Before tuning, measure:
  - how many buildings outside the landmark list have parts;
  - how much of each footprint those parts cover.

  If ordinary buildings with rough parts look worse in the review, add a coverage or quality gate.

### Ground reference

Each building gets one fixed ground reference: the median ground elevation under its footprint. On
a slope, height above *local* ground changes across the building.

- All LiDAR heights for the building are measured from that reference.
- The median keeps hillside buildings at roughly today's rendered height on the flat map.
- Record two values per building, in NAVD88:
  - `groundM`, the reference;
  - `groundMinM`, the lowest ground under the footprint.
- Both are unused today. They let the terrain pass place buildings, and sink their downhill bases,
  without recomputing anything.

### Output and rendering

- **Pieces.** Boxes and parts live in a render-only table beside `pieces`, never in `pieces` itself.
  `60_attributes`, `55_road_lots` and the invariants read `pieces`, and putting boxes there would
  move simulation results.
- **Clipping.** Boxes and parts are clipped to parcels the same way pieces are (`50_clip.sql`).
  Parts outside any parcel keep `parcelId` null, like today's remainder pieces. Check that Sutro's
  parts land on its parcel.
- **Tiles.** `buildings.pmtiles`, layer `buildings`, keeps one feature per (box, parcel), keyed by
  `parcelId` (`promoteId`). The `replaced` feature-state still hides everything on a rebuilt parcel.
  - Below z14, tiles keep today's single boxes, so the z12 tile budget (`z12BuildingsMax`) holds.
  - From z14, they carry the new boxes.
- **Feature properties:** `parcelId`, `heightM`, `baseM`, `hs`, plus:
  - `src`: `box` (fallback single box), `base`, `front`, `step` or `part`;
  - `groundM` and `groundMinM`.
- **Per-building roof record** (a pipeline table, not tiles yet), for the pitched-roof pass:
  - `roof` (`flat` | `pitched` | `unknown`);
  - `eaveM`, `ridgeM`, `ridgeDeg`;
  - the registration shift and its confidence.
- **Style.** `existingBuildingsLayer` (`src/lib/map/style.ts`) already reads `heightM` and `baseM`.
  A subtle shade difference by `src` is optional.
- **Dataset version.** This changes the dataset version. Follow "Finishing a branch that changes the
  dataset" in `docs/dev/pipeline.md`.

### Review before calling it done

Produce a before/after review at street-level pitch (about 60–70°, zoom 16–17) for:

- Downtown and Rincon Hill towers (Salesforce, 181 Fremont, Millennium);
- Transamerica and the Financial District;
- Sutro Tower;
- Civic Center (City Hall);
- the Ferry Building;
- a hospital campus (UCSF Parnassus);
- a Victorian false-front block (Noe Valley, the spike's 24th–25th St / Noe–Sanchez block);
- an Outer Sunset rowhouse block;
- a tree-heavy block (Presidio Heights or St. Francis Wood);
- a steep hillside block (Russian Hill).

Inspect the rendered result, not just counts. Report:

- the share of buildings on each `src`;
- the registration confidence distribution and the fallback share;
- the step and false-front counts;
- phantom steps found on a spot-check sample;
- the tile-size change;
- the `bench:map` result.

## Left to the builder

- LiDAR tooling (the spike used PDAL via Python), raster resolution, the plane-fit method and the
  clustering of interior levels.
- Exact thresholds (margin, false-front band and rise, step area, step gap, step cap), tuned on the
  review areas.
- The cluster rule for registration (the touch tolerance, street splits).
- Whether the derived LiDAR artifact is a raster or per-building tables.
- Tree masking beyond registration plus margin.
- Tippecanoe settings, if the feature count pushes tile size.
