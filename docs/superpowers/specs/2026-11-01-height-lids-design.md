# Height limits on /sim: glass lids — design

Replaces the "height fog" (spec `2026-10-31-sim-runs-design.md` §4, `src/lib/map/fog/`).

## Why

On /sim, the height map is how a planner reads zoning while setting up a run. It has three jobs:

1. **Status quo.** Show what zoning allows today, so you don't paint where it already allows what you want.
2. **Opportunity.** Show where you might go higher or lower, which mostly means seeing the limit next to what's built.
3. **Feedback.** Show how a paint stroke or zoning rule changes what's possible.

The fog does none of these. It is a real 3D sheet, but it is one translucent unlit colour with no edges. It is blurred over 50 m cells, so zone edges vanish and it doesn't follow lot lines. In practice it reads as a grey wash over the streets. Its depth against MapLibre's building extrusions has never been checked at pitch: the GPU tests are all top-down.

## Goals

- When zoomed in, you can read each zone's limit and **how much room to grow the zone has as a whole**. Whether each building is under or over is secondary (user). The lid shows it for free, but nothing extra is drawn per building for it.
- Zones read as areas. Lots sharing an effective limit merge into one region, **across streets** (user). A run of blocks at the same limit is one region, with one lid, one label and one room-to-grow figure, and the lid spans the streets between them.
- An exception (a lot or small group whose limit differs from its surroundings) is visibly its own region, down to a single 25 ft lot.
- With the brush or eraser selected, limits set by paint look different from limits set by FZP and rules.
- Selecting a zoning rule highlights the lots it affects.
- Limits update after each stroke or rule change, showing the **new** limits, not a diff.
- It does not clash with the transit capacity overlay, the buildings in progress, or new housing.

## Non-goals

- Showing the physical cap (`Buildable here`). This shows zoning, as before.
- Showing anything during a Run. It stays Setup-only, as the fog was.
- Exact zoning-district polygons from the Planning department. Regions come from the effective per-lot limits.

## Anti-goals (a failure even if it works)

- **A marker on every lot**: sticks, ghost boxes or per-building caps. Per-lot marks are allowed only where a lot actually differs from its neighbours.
- **Overlays you can't tell apart.** Transit (teal ground fill), pipeline ghosts (plum), new housing and brush (terracotta) and height limits must not blur into one colour.
- **Looking like a ground tint.** If you can't tell from a pitched view that the limit is *up there*, it has failed.

## The design

### Zoomed in: glass lids

Each region gets one **lid**: a slab whose top sits at the region's limit height.

- **Top edge.** A crisp **ink** line traced around the region at the limit height. This line carries the meaning.
- **Top face.** A very faint neutral glaze, just enough for a roof under it to look "under glass". It is not coloured.
- **Walls.** Drawn only where the limit steps between two adjacent regions, as a faint neutral face with an ink line at the top. Where a region meets the city edge, the water or land with no limit (parks, a limit of 0), the top-edge line alone marks it, with no wall down to the ground. Streets inside a region are covered by its lid.
- **Label.** One per region, in stories, such as "4 stories". It is placed on the lid and thinned out by MapLibre-style collision so small regions don't crowd. A single-lot exception is labelled when there's room. Otherwise its lid edge alone shows it.
- **Depth.** Roofs below the lid are seen through the glaze, and building parts above it show untinted. That is all the per-building signal there is. There is no over-limit colour, because orange and red already mean new housing and chance.
- **Room to grow (per zone).** Each region carries the floors it could add: the sum over its lots of `max(0, limit − existing stories)`, its "lot-floors".
  - The region label shows it: "4 stories · +120 floors".
  - The glaze density scales with room per area. A region with lots of unused allowance looks a little more filled in, and one that is already built out looks clear. It stays one neutral glaze, with only its density changing. A few steps are enough.
  - This answers "where might I go higher or lower?" at the zone level without marking buildings.
  - **Source.** The worker already has existing stories city-wide, in `parcels.existingStories` (`src/lib/data/scenario-codec.ts:68`), with `lotAreaM2` beside it. `parcelsView` already computes `stories − existingStories` (`src/lib/sim/levers/view.ts:36`). Compute room to grow at `resolving`, which needs no chunks.
  - **Which lots count** (*my call*): only lots that could host new housing. Protected lots (`hostable` 0), ineligible lots and lots with no envelope count 0. Imputed `existingStories` counts as given. The figure comes from assessor stories, while roofs under the lid come from footprint `heightM`, so they can disagree slightly on a given building. That is accepted.

**Why ink and neutral:** spec §8 reserves hues per meaning: teal for transit, terracotta for new housing and brush, plum for pipeline, red/amber/green for chance, and an uncoloured haze for height limits. Lids use only ink lines and a neutral glaze. Because the lid floats at height and transit is a ground fill, they separate in depth when the map is pitched. The glaze is faint enough that teal and plum still read through it.

### Zoomed out: contour lines on the ground

When zoomed out, lids are too small to read, and a filled height map would sit on top of the teal transit fill. So zoomed out, height limits become **contour lines** drawn flat on the ground: ink lines along the boundaries between regions of different limits, with occasional labels ("4", "8", "40+"). This reads like a topographic map. It is lines only, so the transit fill stays legible underneath. Line weight may scale with the size of the step.

The switch between the two is zoom-based, with a short crossfade. *Builder's call:* the threshold zoom, around z15, set by what reads in practice.

### While painting or erasing

When the brush or eraser tool is selected, regions whose limit comes from paint draw their lid edge, or contour line, as a **terracotta dashed** line instead of solid ink. This matches the eraser's dashed `painted-outline` language. Everything else is unchanged. With no tool selected, painted regions look like any other.

*My call:* while a tool is selected, the region key includes "set by paint", so a painted lot never merges with an unpainted neighbour of the same height. With no tool selected, they merge. Region shapes may change when a tool is picked up, which is acceptable.

### Selecting a zoning rule

A rule card in `RulesSection` gains a selected state, which is new. While a rule is selected:

- Lids for the lots where the rule **decides the outcome** come forward at full edge weight. These are the lots whose effective limit comes from this rule: not overridden by paint, a taller rule or FZP. The user asked to highlight the rule's *consequences*, not every lot it names.
  - **Protocol change.** The page currently flattens rules into unnamed `StoryEdit`s (`ruleEdits` in `src/lib/sim-page/policy.ts`). The worker needs a rule id per edit and must report, for each lot, which source won: FZP, a rule id, or paint. Selection is then a page-side restyle with no worker round trip. The zoomed-out highlight uses the same city-wide per-lot source, through the contour source, not lot polygons.
- All other lids dim, for example to 30% edge opacity and no glaze.
- Zoomed out, the same applies to contours, plus a light ink outline around the rule's lot set, so it can be found from afar.

Deselecting restores the normal view. *Builder's call:* how a card is selected (click the card body versus a dedicated control), consistent with the existing `BrushCard` Edit and Remove buttons.

### Feedback timing

Lids and contours redraw from the effective table whenever the worker reports `resolving` or `current`. Lids also rebuild when chunks load as you pan. That is the same source as the fog (`resolution.plan.table.stories`), with a protected painted lot showing its FZP height. The existing 2 s terracotta paint and rule feedback buildings stay as they are.

## Constraints

- **Hue rules (spec §8).** Use only ink and neutral for limits. Terracotta is used only for the paint-tool dashed edge, which extends existing language. Never use blue or violet (reserved for water).
- **Depth against existing buildings.** Existing buildings are a MapLibre `fill-extrusion`, and lids are drawn in deck, interleaved before the first symbol layer. **Verify at pitch** that lids are correctly hidden behind MapLibre buildings and deck timeline extrusions, and that roofs below a lid look different from roofs above it. The fog never did this. Add a pitched GPU test with a MapLibre extrusion in the scene.
- **Performance.** It must stay within the map perf bar (`docs/dev/map-perf.md`; the fog was 135k cells at p95 8.8 ms). Lid and contour geometry is built in the worker, not on the main thread.
- **Coverage.** Lot polygons (`lotOutlines`) exist only for loaded chunks. Lids, being zoomed in, need only loaded chunks. Zoomed-out contours must cover the whole city, so they cannot depend on lot polygons from every chunk. *Builder's call:* the source for city-wide contours. Options include a finer raster from label points, or a pipeline-built limits layer for the FZP baseline with paint and rule deltas layered on top.
- **No dissolve library exists.** Merging lots into regions needs new code, and because regions cross streets, shared-edge matching alone won't do. *Builder's call:* the approach, for example rasterizing lots by limit, closing street-width gaps (about 30 m) between lots at the same limit, then tracing the outline. Any approach must keep a single 25 ft lot visible as its own region. A raster coarser than about 2 m fails that, and the street-closing step must not swallow an exception lot.
- View menu: the "Height limits" row and caption are renamed and reworded to fit. It stays on by default and stays Setup-only.
- Remove the fog layer, its grid builder and the `height-fog` token once replaced. Update `docs/dev/sim-page.md` and `docs/dev/map-interfaces.md`.
- WCAG 2.2 AA: the paint state must not rely on colour alone. The dash pattern carries it, and the contour labels need sufficient contrast. See `docs/dev/accessibility.md`.

## Decided

- Glass lids zoomed in (user).
- Regions span streets (user).
- A distinct look for paint-set limits while painting (user).
- A rule selection that highlights its consequences (user).
- Show new limits, not a diff (user).
- Room to grow is shown per zone, not per building (user). *My call:* show it as a label figure ("+N floors") plus glaze density.
- Avoid clashing with transit and buildings in progress. Changing the transit overlay is acceptable if needed (user). *My call:* this design doesn't change transit. It avoids the clash with lines rather than fills.
- *My call:* contour lines rather than a ground choropleth when zoomed out, ink and neutral only, and a terracotta dash for paint.

## Left to the builder

The zoom threshold, the dissolve algorithm, the source for city-wide contours, the label placement details, the exact glaze and line weights (tuned by eye at pitch against the transit overlay, in light and dark), and the rule-card selection affordance.
