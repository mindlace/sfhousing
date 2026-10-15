# Transit capacity — subsystem spec

Status: draft for review (2026-10-14).
Relates to `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (M2 "transit buffer" area-select and "transit proximity" metrics) and `2026-10-10-data-pipeline-design.md` §4 (new source). Companion specs touched: map-view (layers), platform (header actions).

## 1. Purpose

Where housing should go depends heavily on how much transit an area already has. This feature lets someone painting zoning see, at a glance, **how much peak transit capacity is within walking distance** of any point in San Francisco, and where the stops are.

Mode mix (bus / bus + rail / bus + rail + BART) was the first heuristic, but the real question is *capacity*: a Van Ness BRT stop and a quiet crosstown bus stop are both "bus" yet differ by an order of magnitude. So we estimate capacity directly from published schedules.

**Design principle: the pipeline seeds, the client computes.** The pipeline publishes the transit *network* (stops, service patterns, frequencies, vehicle capacities) as seed values. Every derived number — per-stop capacity, mode class, SB 79 tier, the area surface — is computed in the browser by pure functions over a `TransitNetwork` value. Nothing downstream assumes the network is static: a later feature (est. ~1 month) will let users add lines, raise frequency, or add stations, and every view recomputes from the edited network.

**Scope note vs. the main design doc.** The design doc lists "transit capacity" out of scope (`2026-10-10-1749-sf-housing-sim.md:155`), meaning *whether transit can absorb the new residents* (crowding, load modelling). That remains out of scope. This spec only describes **existing scheduled service**, which is a reference layer, not a forecast.

## 2. Scope

**In scope**

- A new pipeline source: static GTFS for Muni, BART and Caltrain (§4.1), reduced to a compact seed network `transit.json` in each new dataset version.
- A pure, DOM-free, zod-free TS module `src/lib/transit/` (importable by the sim worker later): network types, stop capacity, mode class, station grouping, SB 79 tier (rail only), and the area-capacity surface.
- Two map layers: **Transit stops** and **Transit capacity (area)**.
- A **View** menu in the header (the first one) with toggles and legends for both layers, persisted per viewer.
- Fixture GTFS and goldens.

**Out of scope (seams only, §8)**

- Editing the network (plan-level transit edits). The data model and recompute path are designed for it; the UI and plan-schema change are not built.
- Feeding transit access into the scoreboard or buildout (M2).
- Drawing route lines.
- Bus SB 79 qualification. It needs dedicated-lane data; DataSF publishes "Transit Only Lanes" (`tzh6-6j82`), a natural later source. Until then the tier stays `null` for bus-only stops.
- Network walk distance (we use straight-line distance; §5.3).
- Crowding, reliability, off-peak service.

## 3. Interfaces

| # | interface | owner → consumers |
|---|---|---|
| T1 | Manifest gains optional `transit?: RootRelativeUrl` (I12). Optional because published versions are immutable and the current production dataset has none; every consumer hides transit UI when it is absent. | data-pipeline → platform, map-view, transit |
| T2 | `transit.json` wire format `sfh-transit/1` (§4.3), codec in `src/lib/data/transit-codec.ts` (shared, so it is in the dataset version hash). Decoding yields a `TransitNetwork`. | data-pipeline → transit |
| T3 | `TransitNetwork` value type (§5.1). The **only** input to every transit computation. Treated as immutable; edits produce a new value. | transit → map-view, future plan/scoreboard |
| T4 | Pure functions `stopService`, `stopCapacity`, `stopClass`, `sb79Tier`, `buildAccessGrid`, `accessAt` (§5). | transit → map-view, future worker |
| T5 | `TransitParams` (§5.3): walk radius, decay, peak window label, grid size. Defaults in code; future UI may change them. | transit → map-view |
| T6 | `ViewPrefs` (`sfhousing:view` localStorage) and the View menu component (§6.3). | platform → map-view |

No existing I-row changes except the additive optional manifest field (T1).

## 4. Pipeline

### 4.1 Sources

Three operator feeds fetched directly. None needs a key, so CI and anyone who clones the repo can fetch them without secrets.

| lock id | URL | licence (recorded in lock) |
|---|---|---|
| `gtfs-muni` | `https://muni-gtfs.apps.sfmta.com/data/muni_gtfs-current.zip` ([page](https://www.sfmta.com/reports/gtfs-transit-data)) | SFMTA Transit Data License Agreement: non-exclusive, revocable, may reproduce and distribute; **no sublicensing**; cl.12 notice required on derived data; cl.4 disclaimer; no SFMTA/Muni marks |
| `gtfs-bart` | `https://www.bart.gov/dev/schedules/google_transit.zip` ([DLA](https://www.bart.gov/dla)) | BART Developer License: non-exclusive, revocable, may redistribute; no attribution required; no BART marks |
| `gtfs-caltrain` | `https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip` ([dev resources](https://www.caltrain.com/developer-resources)) | PCJPB Developer License: non-exclusive, revocable, may redistribute; no logo or system map |


Each is a raw zip stored by sha256 like every other source, and archived to R2 `sources/` so `fetch --restore` works after a feed rolls over. `upstreamVersion` is `feed_info.feed_version` when present, else `<min calendar start>..<max calendar end>` (Muni and BART ship no `feed_info.txt`).

**Ferries are excluded.** The only SF terminal with weekday service is the Ferry Building. It is within 800 m of BART Embarcadero, whose peak capacity (~30–40k riders/hr) dwarfs the ferries' (~3k/hr), and AM peak ferry trips run overwhelmingly into SF. Adding them would mean two more feeds for no visible change. A ferry pattern can be added later through the same network model.

**Bootstrap for cloners: `npm run data:transit`.** This fetches the feeds directly from the agency URLs (`pipeline fetch --only gtfs-*`), builds `transit.json`, and writes it into the local R2 copy of the dataset named in `.dev.vars`, adding `transit` to that local manifest copy. Feeds roll over at every service change, so a sha256 that differs from the lock is a warning here, not an error: local dev does not need bit-for-bit reproducibility. `pipeline build` for a release still requires the lock to match. The Setup sections in `CLAUDE.md` and `docs/dev/developing.md` gain this step.

**Rejected: the 511.org regional feed.** It is one merged feed, but it needs an API key (a CI secret), requires reporting to MTC within 30 days of launch, and its sublicensing clause (§2c, written acceptance from sublicensees) does not fit anonymous public data. It is the fallback if the direct Muni URL goes stale.

**Licensing of `transit.json`.** `transit.json` contains only facts: stop locations, which routes serve them, how often, and vehicle capacities. Facts are not copyrightable in the US (*Feist v. Rural*). We publish it like the DataSF sources and credit the operators as a courtesy. The licence column above records each feed's stated terms in the lock, for the record.

**Credits appear on `/attribution` only**: SFMTA, BART and Caltrain, each with the licence recorded in the lock. The map's attribution control is not extended, since it already links to `/attribution`.

**`route_type` mapping.** These feeds use standard codes only: `0` (Muni Metro and F/E streetcar, split by route id: `F`, `E` → `streetcar`; `J K L M N T S` → `light-rail`), `1` → `heavy-rail` (BART), `2` → `commuter-rail` (Caltrain), `3` → `bus`, `5` → `cable-car`. Trolleybuses are not distinguished: capacity depends on vehicle size, not propulsion. GTFS carries no vehicle size or train length, so those come from the vehicle assignments in §4.2 step 7.

### 4.2 Reduction (`pipeline/steps/transit.ts`)

Pure TS (no DuckDB needed; feeds are small). Steps:

1. **Service day.** Pick the representative weekday: the first Tuesday on or after the lock's newest `retrievedAt` that is active in every feed (`calendar` ∩ `calendar_dates`, honouring exceptions). Record it in the output.
2. **Peak window.** Weekday AM peak, 07:00–09:00 local, by `departure_time` at each stop. `tripsPerHour = departures in window / 2`.
3. **Clip.** Keep stops within the SF city/county boundary buffered by 1 km (riders in Daly City walk to Balboa Park). Keep patterns that serve at least one kept stop.
4. **Patterns.** Group trips by `(route_id, direction_id, ordered stop list)`. For each pattern and each of its stops, count peak departures. Drop patterns with zero peak departures at every stop.
5. **Mode.** Map `route_type` to `ModeId` per §4.1.
6. **Stations.** Keep GTFS `parent_station` as `stationId` within an operator. Then group across operators: stops (or stations) within 150 m whose normalised names share a token (e.g. "Powell") get a common `placeId`. Ungrouped stops get `placeId = stopId`.
7. **Vehicles and consists.** Capacity is `vehicle capacity × cars`. `pipeline/config/transit-vehicles.ts` holds two tables, both with a source URL and as-of date per row:
   - **Vehicles** (`VehicleId → { label, seats, capacity }`), at each agency's own *planning* load, meaning the load it schedules service against.
   - **Route assignments** (`operator:route → { vehicle, cars }`). Every route not listed gets its operator's default.

   The seed values are below. They are editable (T5 / §8).

   | vehicle | seats | planning cap | source |
   |---|---|---|---|
   | `muni-bus-30` (30/32 ft) | ~24 | 33 | SFMTA SRTP FY19–30 Table 4-6 |
   | `muni-bus-40` (XDE40 / XT40) | ~30 | 44 | same |
   | `muni-bus-60` (XDE60 / XT60 artic) | ~45 | 69 | same |
   | `muni-lrv4` (per car) | 60 | 139 | SRTP Table 4-5 (2019 rev.) |
   | `muni-streetcar` (F/E) | ~33 | 69 | SRTP Table 4-5 |
   | `muni-cable-powell` / `-california` | ~30 / ~35 | 52 / 60 | SRTP Table 4-5 |
   | `bart-car` (Fleet of the Future) | 54 | 107 | BART standard: 60 seated + 47 standing per car |
   | `caltrain-emu7` (Stadler KISS, 7 cars, one unit) | 675 | 810 | Caltrain 2025 Title VI (load factor 1.2) |

   | route assignments (seed) | |
   |---|---|
   | Muni default | `muni-bus-40` × 1 |
   | Muni 60-ft | 5, 5R, 7, 8, 9R, 14, 14R, 30, 38, 38R, 49, 1X, 8AX, 8BX, 30X (Wikipedia "^" column; SFMTA confirms 38/38R, 49, 14R). The 9 runs 60-ft only on weekends, so it stays 40-ft at weekday peak. |
   | Muni 30-ft | 35, 36, 37, 39, 52, 56, 66, 67 |
   | Muni Metro | N, K, T × 2 cars; J, L, M, S × 1 |
   | BART | Red × 10, Yellow × 9, Green × 6, Blue × 6, Orange × 6 (July 2026 schedule) |
   | Caltrain | `caltrain-emu7` × 1 |

   **The comparison is uneven.** Agencies plan at different crowding levels. Caltrain plans at 1.2 × seats (mostly seated), while BART and Muni rail plan at about 2 × seats (many standing). So a 10-car BART train (1,070) out-carries a 7-car Caltrain (810) at planning load, even though Caltrain is double-deck and has more seats per train than a 6-car BART train. We use each agency's planning figure because it is what that agency actually schedules against. A different load rule, such as seats × a common factor, is a single change in the vehicle table.

   **Validation.** The build fails if an assigned route id is missing from its feed, which catches renamed routes. It warns (but does not fail) on any route with peak service and no explicit assignment whose operator default is likely wrong (Muni rail, BART).

   **Simplifications** (each noted in the config):
   - On Ocean Ave, K trains lock their rear car, but the K still counts as 2 cars along its whole length.
   - L and M train lengths are low-confidence: no current source says whether they run 2-car trains at peak.
   - The Green and Blue base length of 6 cars is unconfirmed.

### 4.3 Wire format `sfh-transit/1`

One JSON file, columnar like the parcel chunks:

```ts
{
  format: 'sfh-transit/1',
  serviceDate: 'YYYY-MM-DD', peak: { start: '07:00', end: '09:00' },
  vehicles: { [VehicleId]: { label: string; seats: number | null; capacity: number } },
  operators: { id: string; label: string }[],
  stops: {               // parallel arrays, index = stop index
    id: string[]; name: string[]; lng: number[]; lat: number[]   // lng/lat as int ×1e6
    station: (string | null)[]; place: string[]
  },
  patterns: {
    id: string; operator: number; route: string; routeName: string;
    mode: ModeId; direction: 0 | 1; vehicle: VehicleId; cars: number;
    stops: number[];         // stop indices, in order
    tph: number[];           // peak trips per hour at each stop, parallel to `stops` (×10, int)
  }[]
}
```

Target size: under 400 KB uncompressed. New invariant **V14**: `transit.json` round-trips through the codec; every pattern stop index is in range; ≥ 3,000 stops; all 8 SF BART stations present with `heavy-rail` service > 0 tph; `tph` ≥ 0.

### 4.4 Fixture

Hand-made mini GTFS in `pipeline/test/fixtures/mini/raw/` covering the fixture cells: two bus routes (one 60-ft), one 2-car light-rail line with a shared station, one BART-like heavy-rail stop grouped with a Muni stop into one place, one stop outside the clip. Golden `transit.json` pinned alongside the existing goldens.

## 5. Transit module (`src/lib/transit/`)

DOM-free, zod-free, `$app`-free (same constraints as `src/lib/sim/host.ts`), so the sim worker can import it in M2.

### 5.1 Types

```ts
type ModeId = 'bus' | 'cable-car' | 'streetcar' | 'light-rail'
            | 'heavy-rail' | 'commuter-rail';
type VehicleId = string;   // keys of the vehicle table; open so edits can add vehicles
interface Vehicle { label: string; seats: number | null; capacity: number }
interface Stop { id: string; name: string; lngLat: [number, number]; stationId: string | null; placeId: string }
interface Pattern { id: string; operatorId: string; routeId: string; routeName: string;
                    mode: ModeId; direction: 0 | 1; vehicle: VehicleId; cars: number;
                    stops: { stop: number; tph: number }[] }
interface TransitNetwork { serviceDate: string; peak: { start: string; end: string };
                           vehicles: Record<VehicleId, Vehicle>; stops: Stop[]; patterns: Pattern[] }
```

### 5.2 Per-stop derivations

- `stopService(net)` → per stop, a list of `{ routeKey: \`${operatorId}:${routeId}:${direction}\`, mode, tph, cap }`, summing across patterns of the same route-direction at that stop. `cap = tph × vehicles[vehicle].capacity × cars`.
- `stopCapacity(net)` → `Float64Array`, riders per peak hour: Σ `cap` over the stop's service.
- `stopClass(service)` → `'regional-rail' | 'rail' | 'bus'` by the highest mode served (`heavy-rail`, `commuter-rail` → regional-rail; `light-rail`, `streetcar` → rail; everything else → bus, including cable car). Used for marker colour only.
- `sb79Tier(net, stop)` → `1 | 2 | null`. Tier 1: served by heavy rail, or commuter rail with ≥ 72 trains/day both directions (computed over the service day, all hours). Tier 2: light rail or streetcar, or commuter rail ≥ 48/day. Bus-only stops return `null` (dedicated-lane data not modelled). Labelled "estimated" wherever shown. Computed, not stored, so edits change it.

### 5.3 Area-capacity surface

The value at a point *p* is the peak-hour capacity reachable on foot, counting each route-direction once at its best stop:

```
access(p) = Σ over route-directions r of  max over stops s of r within R of  cap(r, s) · w(dist(p, s))
cap(r, s) = tph(r, s) · vehicleCapacity(mode(r))
w(d)      = 1                         for d ≤ d0
            1 − (d − d0) / (R − d0)   for d0 < d ≤ R
            0                         beyond R
```

Taking the max per route-direction stops a line that passes six nearby stops from counting six times. Summing both directions is intentional (both are usable capacity).

`TransitParams` defaults: `R = 800 m`, `d0 = 200 m`, `gridSizeM = 100`. Distance is straight-line in a local equirectangular projection (`project()` in `src/lib/plan/geometry.ts`). Straight-line overstates access across hills and freeways; network walksheds are a later improvement.

- `buildAccessGrid(net, params, bounds)` → `{ origin, sizeM, cols, rows, values: Float32Array }` over the SF bounds (~12 × 12 km → ~14,400 cells). Uses a KDBush index over stops (already a dependency). Budget: ≤ 100 ms on the bench machine; computed on the main thread in an idle callback after the network loads. If it measures over budget, move it into a dedicated worker (not the sim worker), with the same pure function.
- `accessAt(grid, lngLat)` → bilinear sample, for future per-parcel use and the tooltip.

Recompute triggers: network value change or params change. In this feature that happens once per load.

## 6. Map and UI

### 6.1 Layers (MapLibre, built in `src/lib/map/style.ts` when `manifest.transit` exists)

MapLibre GeoJSON sources, not deck overlays: `setOverlayLayers` is single-owner (brush-tool), and MapLibre layers inherit `themePaintDiff` theming.

| layer id | type | placement | data |
|---|---|---|---|
| `transit-access` | `fill`, opacity 0.45 | above basemap non-symbol layers, below `existing-buildings` | grid cells as polygons, property `v` = access, merged runs per row to cut feature count |
| `transit-stops` | `circle` | above basemap labels (top of stack) so stops are never hidden under generated buildings | stops, properties `cls`, `cap`, `name` |

**Access colours.** A 5-step sequential ramp, new `TOKENS` entries `transit-access-1..5` in both themes, binned on a log scale: < 1k, 1k–3k, 3k–10k, 10k–30k, ≥ 30k riders/hr. Cells under 200 riders/hr are transparent. Bins are a `TransitParams`-adjacent constant in `src/lib/transit/legend.ts` so the legend and the layer share them.

**Stop markers.** Colour by `stopClass` (tokens `transit-bus`, `transit-rail`, `transit-regional`). Radius by `log10(cap)` with an interpolate expression, zoom-scaled. Filtering by zoom: below z13 only regional rail; z13–14 adds rail; z15+ all stops. A white (light) or near-black (dark) stroke keeps markers legible over the access surface.

**Hover tooltip** on stops at z ≥ 14: name, routes (grouped by mode), peak capacity/hr, SB 79 tier (estimated) when non-null. Uses the existing tooltip affordance (keyboard focus parity per `docs/dev/accessibility.md`).

### 6.2 Attribution

Operator credits flow through `manifest.sources` to `/attribution` like every other source (§4.1). The map's attribution control is unchanged.

### 6.3 View menu

- A **View** button in the header-actions snippet on the main page (`src/routes/+page.svelte`), left of save/publish. Hidden when `manifest.transit` is absent.
- Opens a disclosure popover (button + `aria-expanded`, Esc closes, focus returns) with two checkboxes, each followed by its legend:
  - **Transit stops** (default **on**)
  - **Transit capacity within a 10-minute walk** (default **on**). Legend shows the five bins and the caption "Estimated weekday 7–9 am capacity, riders per hour. Existing service only."
- State persisted to localStorage key `sfhousing:view` as `{ transitStops: boolean; transitAccess: boolean }`, read/written with the guarded pattern from `src/lib/brush/settings.ts`. Applied with `setLayoutProperty(id, 'visibility', …)` and re-applied after style reloads or map remount.
- The menu is a list so later layers (pipeline overlay, M5) add rows without redesign.

## 7. Testing

- **Pipeline:** unit tests for service-day selection (calendar exceptions), peak counting, pattern grouping, place grouping, articulated mapping; V14; golden `transit.json`.
- **Codec:** round-trip in `src/lib/data/` tests.
- **Transit module:** capacity sums; per-route-direction max (a line through six nearby stops counts once); decay at d0 and R; sb79Tier cases; a network edit (raise a route's tph) changes the grid — the "not hard-baked" guarantee as a test.
- **Map/UI (browser tests):** View menu toggles visibility and persists; menu hidden without `manifest.transit`; `expectNoA11yViolations` on the open menu.
- **e2e:** fixture-0 shows stops; toggling the surface shows the fill layer.
- **Perf:** `buildAccessGrid` timing assertion on the full network in a bench script; `npm run bench:map` with both layers on stays within the map-perf pass bar.

## 8. Seams for network editing (not built)

- **Plan schema.** A future `transit?: TransitEdit[]` section on `Plan`. `validatePlan` rebuilds plans field by field and drops unknown keys, so this needs a **schema bump to 2** (identity migration from 1) so older clients show `future-schema` rather than silently stripping edits.
- **Edits apply to the seed.** `applyTransitEdits(seed, edits) → TransitNetwork`. Edits are things like `{ kind: 'frequency', routeKey, factor }`, `{ kind: 'consist', routeKey, cars }`, `{ kind: 'vehicle', routeKey, vehicle }`, `{ kind: 'vehicle-capacity', vehicle, capacity }`, `{ kind: 'new-pattern', … }`, `{ kind: 'new-stop', … }`. All derivations take the resulting network; none read the seed directly.
- **Zoning from transit.** M2 area-select ("transit buffer") and per-parcel transit metrics read `accessAt` or stop sets from the same network, inside the sim worker.

## 9. Decisions (2026-10-14)

- Transit data is published as facts, with credits on `/attribution` only. A bootstrap script fetches the feeds for anyone who clones the repo (§4.1).
- Both layers are on by default.
- Ferries are excluded: negligible resident-facing capacity (§4.1).
- Capacities use each agency's own planning load, with no common load-factor abstraction (§4.2 step 7).
