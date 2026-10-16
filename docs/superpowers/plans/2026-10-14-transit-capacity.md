# Transit Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a seed transit network (Muni, BART, Caltrain) with each new dataset, and draw transit stops plus an area-capacity surface on the map, with a View menu to toggle them.

**Architecture:** The pipeline reduces three GTFS feeds to `transit.json` (`sfh-transit/1`, codec in `src/lib/data/`), and the manifest names it through an optional `transit` field. Every derived number is computed in the browser by pure functions over a `TransitNetwork` value (`src/lib/transit/`): stop service, capacity, class, SB 79 tier, and a 100 m access grid. SimMap fetches the network when the manifest has one and feeds two MapLibre GeoJSON sources. A View menu in the header toggles them, persisted to `localStorage`.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5 runes, MapLibre GL 6, KDBush, zod (manifest only), Vitest (server, client and pipeline projects), Playwright, `fflate` (new devDependency, pipeline-only, used to unzip GTFS).

**Spec:** `docs/superpowers/specs/2026-10-14-transit-capacity-design.md`. Read it before starting any task; this plan argues from it.

## Global Constraints

- Node `>=22 <26`. Run `npm install` in the worktree before the first task; it has no `node_modules`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns (Prettier + ESLint). Run `npm run lint` before each commit.
- Every Vitest test calls `expect` (`expect.requireAssertions` is on).
- Tests are colocated:
  - `src/**/X.spec.ts` / `X.test.ts` run in the **server** project.
  - `src/**/X.svelte.spec.ts` run in the **client** project (browser).
  - `pipeline/test/*.test.ts` run in the **pipeline** project.
- Commits follow Conventional Commits and end with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. For multi-line messages use multiple `-m` flags; never use heredocs.
- `src/lib/transit/` stays DOM-free, zod-free, `$app`-free and Svelte-free, so the sim worker can import it later.
- The manifest `transit` field is **optional**. Published versions are immutable, and the current production dataset has none. Every consumer hides transit UI when it is absent.
- Peak window is `07:00–09:00` and `tph = departures in window / 2`.
- `TransitParams` defaults are radius `R = 800` m, full-weight distance `d0 = 200` m, and grid `100` m.
- Access bins are 200 / 1,000 / 3,000 / 10,000 / 30,000 riders/hr. Below 200 is transparent. Fill opacity is `0.45`.
- The `localStorage` key is `sfhousing:view`, value `{ transitStops: boolean; transitAccess: boolean }`, and **both default on**.
- Operator credits appear on `/attribution` only. The map's attribution control text is unchanged.
- Vehicle capacities are copied verbatim from spec §4.2 step 7.
- Ferries are excluded.
- Feeds come only from the three direct agency URLs in spec §4.1, never 511.org.
- `transit.json` contains only facts: no licence change to `DERIVED_LICENSE`.

## Review Focus

1. **A feed whose calendar ended before the retrieval date.** The live Muni `muni_gtfs-current.zip` fetched 2026-10-14 has `calendar.txt` ending 2026-08-28. The build must still produce Muni service: use the feed's last served Tuesday and record a warning, never an empty network or a crash. Pinned in Task 2 (`pickServiceDate`) and Task 3 (the warning reaches `warnings`).
2. **Caltrain direction platforms.** Caltrain splits each station into northbound and southbound platforms under a `parent_station`, so one platform alone sees about 40 trains a day. SB 79 tier 1 (≥ 72 trains/day both directions) must count the whole station. Pinned in Task 6.
3. **A dataset without `transit`** (current production, and the datasets older plans pin to). It must show no View button, add no transit sources or layers, make no fetch, and raise no errors. Pinned in Task 8 (style), Task 10 (SimMap makes no fetch) and Task 11 (page).
4. **`transit.json` fails to load or decode** (404, network, bad format). The map must still reach `ready`, the transit layers stay empty, and only a console warning is logged. Pinned in Task 10.
5. **Unusable or corrupt `localStorage`** (private mode throws, `sfhousing:view` holds `"nope"` or `{ "transitStops": 3 }`). Prefs fall back per field to the defaults (both on) and never throw. Pinned in Task 9.

---

## File map

| Path | Responsibility |
|---|---|
| `src/lib/data/transit.ts` (new) | Shared `TransitNetwork` types, `MODE_IDS` (in the dataset-version hash). |
| `src/lib/data/transit-codec.ts` (new) | `sfh-transit/1` encode/decode with validation. |
| `src/lib/data/manifest.ts` | Optional `transit` URL. |
| `scripts/data-local.ts` | Copy `transit.json` when the manifest names it. |
| `pipeline/lib/gtfs.ts` (new) | Unzip, CSV, GTFS time, service calendar, service-day choice, feed version. |
| `pipeline/transit-config.ts` (new) | Feed specs, vehicle table, route assignments, mode/line rules, place stopwords. |
| `pipeline/steps/transit.ts` (new) | `reduceTransit` (patterns, peak/day counts, clip, places) and `writeTransit`. |
| `pipeline/sources/gtfs.ts` (new) | `fetchGtfs` lock entries. |
| `pipeline/steps/fetch.ts`, `build.ts`, `manifest.ts`, `check.ts`, `fixture.ts`, `config.ts` | Fetch ids, build step, manifest field, V14, golden list, profile fields. |
| `pipeline/test/fixtures/mini/make-fixture.ts` | Mini GTFS for three operators. |
| `scripts/data-transit.ts` (new) | `npm run data:transit` bootstrap. |
| `src/lib/transit/{types,service,grid,legend,index}.ts` (new) | Pure derivations and access grid. |
| `src/lib/map/palette.ts`, `style.ts` | Transit tokens and layers. |
| `src/lib/map/transit-layer.ts` (new) | Network fetch, GeoJSON builders, stop tooltip lines. |
| `src/lib/map/tooltip.ts`, `types.ts`, `SimMap.svelte` | Stop tooltip kind, `view` / `fetchTransit` props, wiring. |
| `src/lib/view/{prefs.ts,ViewMenu.svelte}` (new) | View prefs and the header menu. |
| `src/lib/brush/BrushEditor.svelte`, `src/routes/+page.svelte` | Thread `view` to SimMap; mount the menu. |
| `src/routes/attribution/+page.svelte` | Transit credit notice. |
| `e2e/transit.spec.ts` (new), `e2e/map.spec.ts`, `e2e/attribution.spec.ts` | End-to-end checks. |
| Docs | `CLAUDE.md`, `docs/dev/{developing,pipeline,map-interfaces,map-perf}.md`. |

---

### Task 1: Shared transit types, `sfh-transit/1` codec, manifest field

**Files:**
- Create: `src/lib/data/transit.ts`
- Create: `src/lib/data/transit-codec.ts`
- Create: `src/lib/data/fixtures/transit-tiny.ts` (shared test network; not a spec file, so importing it never re-runs a suite)
- Test: `src/lib/data/transit-codec.test.ts`
- Modify: `src/lib/data/manifest.ts` (`ManifestBaseSchema`, the `urls` list in `superRefine`)
- Modify: `src/lib/data/manifest.test.ts`
- Modify: `scripts/data-local.ts` (`collectDataPaths`)
- Modify: `scripts/data-local.spec.ts`

**Interfaces:**
- Produces (in `src/lib/data/transit.ts`):

```ts
export const MODE_IDS = ['bus', 'cable-car', 'streetcar', 'light-rail', 'heavy-rail', 'commuter-rail'] as const;
export type ModeId = (typeof MODE_IDS)[number];
export type VehicleId = string;
export interface Vehicle { label: string; seats: number | null; capacity: number }
export interface Operator { id: string; label: string; serviceDate: string /* YYYY-MM-DD */ }
export interface Stop { id: string; name: string; lngLat: [number, number]; stationId: string | null; placeId: string }
export interface PatternStop { stop: number; tph: number; tpd: number }
export interface Pattern { id: string; operatorId: string; routeId: string; routeName: string; mode: ModeId; direction: 0 | 1; vehicle: VehicleId; cars: number; stops: PatternStop[] }
export interface TransitNetwork { peak: { start: string; end: string }; operators: Operator[]; vehicles: Record<VehicleId, Vehicle>; stops: Stop[]; patterns: Pattern[] }
```

- Produces (in `transit-codec.ts`): `TRANSIT_FORMAT = 'sfh-transit/1'`, `class TransitFormatError`, `encodeTransit(net: TransitNetwork): string`, and `decodeTransit(json: unknown): TransitNetwork`. `json` may be a string or a parsed object.
- Produces: `Manifest['transit']?: string`.

**Deviation from spec §4.3 (record it in the commit body).** The wire format gains two things:
- `operators[].serviceDate` replaces the single top-level `serviceDate`, because feeds pick their service day independently (Review Focus 1).
- `patterns[].tpd` holds integer trips per day at each stop. `sb79Tier` needs daily counts (spec §5.2), and the spec's wire format had no field for them.

- [ ] **Step 1: Write the shared types**

Create `src/lib/data/transit.ts`:

```ts
// The transit seed network (transit spec §5.1). Shared by the pipeline (writes it) and the client
// (reads it); lives in src/lib/data so it is part of the dataset version hash. Imports nothing.

export const MODE_IDS = [
  'bus',
  'cable-car',
  'streetcar',
  'light-rail',
  'heavy-rail',
  'commuter-rail'
] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** Keys of `TransitNetwork.vehicles`; open so network edits can add vehicles. */
export type VehicleId = string;

export interface Vehicle {
  label: string;
  seats: number | null;
  /** Riders per vehicle (per car for multi-car consists) at the agency's planning load. */
  capacity: number;
}

export interface Operator {
  id: string;
  label: string;
  /** The weekday whose schedule was counted, YYYY-MM-DD. */
  serviceDate: string;
}

export interface Stop {
  /** `<operator>:<gtfs stop_id>`, unique across operators. */
  id: string;
  name: string;
  lngLat: [number, number];
  /** `<operator>:<gtfs parent_station>` or null. */
  stationId: string | null;
  /** Cross-operator place (spec §4.2 step 6); a stop's own id when ungrouped. */
  placeId: string;
}

export interface PatternStop {
  /** Index into `TransitNetwork.stops`. */
  stop: number;
  /** Peak trips per hour at this stop (0.1 precision). */
  tph: number;
  /** Trips per day at this stop, all hours of the service day. */
  tpd: number;
}

export interface Pattern {
  id: string;
  operatorId: string;
  routeId: string;
  routeName: string;
  mode: ModeId;
  direction: 0 | 1;
  vehicle: VehicleId;
  /** Cars per train (1 for buses). Capacity per trip = vehicles[vehicle].capacity × cars. */
  cars: number;
  stops: PatternStop[];
}

export interface TransitNetwork {
  peak: { start: string; end: string };
  operators: Operator[];
  vehicles: Record<VehicleId, Vehicle>;
  stops: Stop[];
  patterns: Pattern[];
}
```

- [ ] **Step 2: Write the failing codec tests**

Create `src/lib/data/fixtures/transit-tiny.ts`:

```ts
import type { TransitNetwork } from '../transit';

/** A two-stop network at wire precision (codec and V14 tests). */
export function tinyNetwork(): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [
      { id: 'muni', label: 'Muni', serviceDate: '2026-10-13' },
      { id: 'bart', label: 'BART', serviceDate: '2026-10-13' }
    ],
    vehicles: {
      'bart-car': { label: 'BART car', seats: 54, capacity: 107 },
      'muni-bus-40': { label: 'Muni 40 ft bus', seats: 30, capacity: 44 }
    },
    stops: [
      { id: 'bart:FX-1', name: 'Fixture Station', lngLat: [-122.418, 37.761], stationId: 'bart:FXST', placeId: 'bart:FXST' },
      { id: 'muni:m1', name: 'Mission St & 20th St', lngLat: [-122.4195, 37.759549], stationId: null, placeId: 'muni:m1' }
    ],
    patterns: [
      {
        id: 'bart:7:0:0',
        operatorId: 'bart',
        routeId: '7',
        routeName: 'Red',
        mode: 'heavy-rail',
        direction: 0,
        vehicle: 'bart-car',
        cars: 10,
        stops: [{ stop: 0, tph: 4, tpd: 8 }]
      },
      {
        id: 'muni:22:1:0',
        operatorId: 'muni',
        routeId: '22',
        routeName: '22',
        mode: 'bus',
        direction: 1,
        vehicle: 'muni-bus-40',
        cars: 1,
        stops: [{ stop: 1, tph: 6.5, tpd: 13 }]
      }
    ]
  };
}
```

Create `src/lib/data/transit-codec.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tinyNetwork } from './fixtures/transit-tiny';
import { TransitFormatError, decodeTransit, encodeTransit } from './transit-codec';

const wire = () => JSON.parse(encodeTransit(tinyNetwork())) as Record<string, unknown>;

describe('sfh-transit/1 codec', () => {
  it('round-trips a network already at wire precision', () => {
    expect(decodeTransit(encodeTransit(tinyNetwork()))).toEqual(tinyNetwork());
  });

  it('accepts a parsed object as well as a string', () => {
    expect(decodeTransit(wire())).toEqual(tinyNetwork());
  });

  it('is columnar: stops are parallel arrays, coordinates and tph are integers', () => {
    const w = wire() as { stops: { lng: number[] }; patterns: { tph: number[] }[] };
    expect(w.stops.lng).toEqual([-122418000, -122419500]);
    expect(w.patterns[1].tph).toEqual([65]);
  });

  it.each([
    ['unknown format', (w: any) => (w.format = 'sfh-transit/2'), /unknown format/],
    ['stop index out of range', (w: any) => (w.patterns[0].stops = [9]), /stop index/],
    ['unknown vehicle', (w: any) => (w.patterns[0].vehicle = 'nope'), /vehicle/],
    ['negative tph', (w: any) => (w.patterns[0].tph = [-1]), /tph/],
    ['mismatched stop columns', (w: any) => w.stops.name.pop(), /stops\.name/],
    ['bad mode', (w: any) => (w.patterns[0].mode = 'ferry'), /mode/],
    ['bad direction', (w: any) => (w.patterns[0].direction = 2), /direction/],
    ['bad operator index', (w: any) => (w.patterns[0].operator = 5), /operator/]
  ])('rejects %s', (_name, mutate, msg) => {
    const w = wire();
    mutate(w);
    expect(() => decodeTransit(w)).toThrow(TransitFormatError);
    expect(() => decodeTransit(w)).toThrow(msg);
  });

  it('rejects invalid JSON text', () => {
    expect(() => decodeTransit('{')).toThrow(/invalid JSON/);
  });
});
```

(Add `/* eslint-disable @typescript-eslint/no-explicit-any */` at the top of the test file if ESLint flags the mutators.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run --project server src/lib/data/transit-codec.test.ts`
Expected: FAIL, "Cannot find module './transit-codec'".

- [ ] **Step 4: Implement the codec**

Create `src/lib/data/transit-codec.ts`:

```ts
// Wire format "sfh-transit/1" (transit spec §4.3). Pure TS, no dependencies: the pipeline writes
// it and the map reads it.
import { MODE_IDS, type ModeId, type Pattern, type TransitNetwork } from './transit';

export const TRANSIT_FORMAT = 'sfh-transit/1';

export class TransitFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitFormatError';
  }
}

const e6 = (v: number) => Math.round(v * 1e6);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;

export function encodeTransit(net: TransitNetwork): string {
  const opIx = new Map(net.operators.map((o, i) => [o.id, i]));
  const vehicleIds = Object.keys(net.vehicles).sort();
  return JSON.stringify({
    format: TRANSIT_FORMAT,
    peak: { start: net.peak.start, end: net.peak.end },
    operators: net.operators.map((o) => ({ id: o.id, label: o.label, serviceDate: o.serviceDate })),
    vehicles: Object.fromEntries(
      vehicleIds.map((k) => {
        const v = net.vehicles[k];
        return [k, { label: v.label, seats: v.seats, capacity: v.capacity }];
      })
    ),
    stops: {
      id: net.stops.map((s) => s.id),
      name: net.stops.map((s) => s.name),
      lng: net.stops.map((s) => e6(s.lngLat[0])),
      lat: net.stops.map((s) => e6(s.lngLat[1])),
      station: net.stops.map((s) => s.stationId),
      place: net.stops.map((s) => s.placeId)
    },
    patterns: net.patterns.map((p) => {
      const operator = opIx.get(p.operatorId);
      if (operator === undefined)
        throw new TransitFormatError(`pattern ${p.id}: unknown operator ${p.operatorId}`);
      return {
        id: p.id,
        operator,
        route: p.routeId,
        routeName: p.routeName,
        mode: p.mode,
        direction: p.direction,
        vehicle: p.vehicle,
        cars: p.cars,
        stops: p.stops.map((s) => s.stop),
        tph: p.stops.map((s) => Math.round(s.tph * 10)),
        tpd: p.stops.map((s) => Math.round(s.tpd))
      };
    })
  });
}

function column(o: Record<string, unknown>, key: string, len: number): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new TransitFormatError(`stops.${key} is not an array`);
  if (v.length !== len)
    throw new TransitFormatError(`stops.${key} has ${v.length} entries, want ${len}`);
  return v;
}

export function decodeTransit(json: unknown): TransitNetwork {
  let w: unknown = json;
  if (typeof w === 'string') {
    try {
      w = JSON.parse(w);
    } catch (e) {
      throw new TransitFormatError(`invalid JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(w)) throw new TransitFormatError('transit is not an object');
  if (w.format !== TRANSIT_FORMAT)
    throw new TransitFormatError(`unknown format ${String(w.format)}`);
  const peak = w.peak;
  if (!isObj(peak) || typeof peak.start !== 'string' || typeof peak.end !== 'string')
    throw new TransitFormatError('bad peak');
  if (!Array.isArray(w.operators)) throw new TransitFormatError('operators is not an array');
  const operators = w.operators.map((o, i) => {
    if (!isObj(o) || typeof o.id !== 'string' || typeof o.label !== 'string')
      throw new TransitFormatError(`operators.${i} is invalid`);
    if (typeof o.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.serviceDate))
      throw new TransitFormatError(`operators.${i}.serviceDate is invalid`);
    return { id: o.id, label: o.label, serviceDate: o.serviceDate };
  });
  if (!isObj(w.vehicles)) throw new TransitFormatError('vehicles is not an object');
  const vehicles: TransitNetwork['vehicles'] = {};
  for (const [k, v] of Object.entries(w.vehicles)) {
    if (
      !isObj(v) ||
      typeof v.label !== 'string' ||
      !(v.seats === null || isInt(v.seats)) ||
      typeof v.capacity !== 'number' ||
      !(v.capacity > 0)
    )
      throw new TransitFormatError(`vehicles.${k} is invalid`);
    vehicles[k] = { label: v.label, seats: v.seats as number | null, capacity: v.capacity };
  }
  const s = w.stops;
  if (!isObj(s) || !Array.isArray(s.id)) throw new TransitFormatError('stops.id is not an array');
  const n = s.id.length;
  const [ids, names, lng, lat, station, place] = [
    'id',
    'name',
    'lng',
    'lat',
    'station',
    'place'
  ].map((k) => column(s, k, n));
  const stops = ids.map((id, i) => {
    if (typeof id !== 'string' || typeof names[i] !== 'string' || typeof place[i] !== 'string')
      throw new TransitFormatError(`stop ${i} has a non-string id, name or place`);
    if (!Number.isInteger(lng[i]) || !Number.isInteger(lat[i]))
      throw new TransitFormatError(`stop ${i} has non-integer coordinates`);
    if (!(station[i] === null || typeof station[i] === 'string'))
      throw new TransitFormatError(`stop ${i} has a bad station`);
    return {
      id,
      name: names[i] as string,
      lngLat: [(lng[i] as number) / 1e6, (lat[i] as number) / 1e6] as [number, number],
      stationId: station[i] as string | null,
      placeId: place[i] as string
    };
  });
  if (!Array.isArray(w.patterns)) throw new TransitFormatError('patterns is not an array');
  const patterns: Pattern[] = w.patterns.map((p, i) => {
    if (!isObj(p)) throw new TransitFormatError(`patterns.${i} is not an object`);
    const where = `patterns.${i}`;
    if (typeof p.id !== 'string' || typeof p.route !== 'string' || typeof p.routeName !== 'string')
      throw new TransitFormatError(`${where}: bad id, route or routeName`);
    if (!isInt(p.operator) || p.operator >= operators.length)
      throw new TransitFormatError(`${where}: operator index out of range`);
    if (!MODE_IDS.includes(p.mode as ModeId)) throw new TransitFormatError(`${where}: bad mode`);
    if (p.direction !== 0 && p.direction !== 1)
      throw new TransitFormatError(`${where}: bad direction`);
    if (typeof p.vehicle !== 'string' || !(p.vehicle in vehicles))
      throw new TransitFormatError(`${where}: unknown vehicle ${String(p.vehicle)}`);
    if (!isInt(p.cars, 1)) throw new TransitFormatError(`${where}: bad cars`);
    const st = p.stops,
      tph = p.tph,
      tpd = p.tpd;
    if (!Array.isArray(st) || !Array.isArray(tph) || !Array.isArray(tpd))
      throw new TransitFormatError(`${where}: stops, tph and tpd must be arrays`);
    if (tph.length !== st.length || tpd.length !== st.length)
      throw new TransitFormatError(`${where}: tph/tpd length differs from stops`);
    return {
      id: p.id,
      operatorId: operators[p.operator].id,
      routeId: p.route,
      routeName: p.routeName,
      mode: p.mode as ModeId,
      direction: p.direction,
      vehicle: p.vehicle,
      cars: p.cars,
      stops: st.map((ix, k) => {
        if (!isInt(ix) || ix >= n) throw new TransitFormatError(`${where}: stop index ${ix}`);
        if (!isInt(tph[k])) throw new TransitFormatError(`${where}: tph must be a non-negative int`);
        if (!isInt(tpd[k])) throw new TransitFormatError(`${where}: tpd must be a non-negative int`);
        return { stop: ix, tph: (tph[k] as number) / 10, tpd: tpd[k] as number };
      })
    };
  });
  return { peak: { start: peak.start, end: peak.end }, operators, vehicles, stops, patterns };
}
```

- [ ] **Step 5: Run the codec tests**

Run: `npx vitest --run --project server src/lib/data/transit-codec.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Write failing manifest and data-local tests**

Append to the `describe('parseManifest', …)` block in `src/lib/data/manifest.test.ts`:

```ts
  it('accepts an optional transit URL under the version prefix', () => {
    const m = g();
    m.transit = `/data/${m.datasetVersion as string}/transit.json`;
    expect(parseManifest(m).transit).toBe(m.transit);
    expect(parseManifest(g()).transit).toBeUndefined();
  });

  it('rejects a transit URL outside the version prefix', () => {
    const m = g();
    m.transit = '/data/2026-01-01-00000000/transit.json';
    expect(() => parseManifest(m)).toThrow(/transit: url must start with/);
  });
```

In `scripts/data-local.spec.ts`, add a test beside the existing `collectDataPaths` tests. It builds a manifest the same way those tests do, adds `transit: '/data/<v>/transit.json'`, and asserts `collectDataPaths(...)` contains `'transit.json'`. A second assertion checks that a manifest without `transit` does not list it. Reuse that file's existing manifest helper; read its top 40 lines first.

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/data/manifest.test.ts scripts/data-local.spec.ts`
Expected: FAIL. `transit` is stripped (undefined) and `transit.json` is not listed.

- [ ] **Step 8: Implement the manifest field and the data-local path**

In `src/lib/data/manifest.ts`, add to `ManifestBaseSchema` after `neighborhoods`:

```ts
  neighborhoods: RootRelativeUrl,
  /** Transit seed network (transit spec T1). Optional: older datasets have none. */
  transit: RootRelativeUrl.optional()
```

Then add to the `urls` list in `superRefine`, after the `neighborhoods` entry:

```ts
    ['transit', m.transit],
```

In `scripts/data-local.ts` `collectDataPaths`, after `paths.add(rel(manifest.neighborhoods));`:

```ts
  if (manifest.transit) paths.add(rel(manifest.transit));
```

- [ ] **Step 9: Run the tests**

Run: `npx vitest --run --project server src/lib/data scripts/data-local.spec.ts src/lib/sim/manifest-shape.spec.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/data/transit.ts src/lib/data/fixtures/transit-tiny.ts src/lib/data/transit-codec.ts src/lib/data/transit-codec.test.ts src/lib/data/manifest.ts src/lib/data/manifest.test.ts scripts/data-local.ts scripts/data-local.spec.ts
git commit -m "feat(data): add sfh-transit/1 codec and optional manifest transit field" -m "Wire format carries per-operator serviceDate and per-stop trips/day (tpd) in addition to spec §4.3: feeds pick service days independently and sb79Tier needs daily counts." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: GTFS reading utilities

**Files:**
- Modify: `package.json` / `package-lock.json` (devDependency `fflate`)
- Create: `pipeline/lib/gtfs.ts`
- Test: `pipeline/test/gtfs.test.ts`

**Interfaces:**
- Produces:

```ts
export type GtfsFiles = Map<string, string>;          // basename (e.g. 'stops.txt') -> text
export function gtfsFromZip(bytes: Uint8Array): GtfsFiles;
export function readGtfs(files: { name: string; path: string }[]): GtfsFiles; // one .zip, or loose .txt files
export interface Csv { header: string[]; col(name: string): number; rows(): Generator<string[]> }
export function csv(text: string | undefined): Csv;   // rows() is single-use
export function at(row: string[], k: number): string; // trimmed field, '' when k < 0
export function parseGtfsTime(s: string): number | null; // seconds since service-day midnight
export function activeServices(g: GtfsFiles, date: string /* YYYYMMDD */): Set<string>;
export function calendarRange(g: GtfsFiles): { start: string; end: string } | null; // YYYYMMDD
export function pickServiceDate(g: GtfsFiles, target: string /* YYYY-MM-DD */): { date: string /* YYYY-MM-DD */; warning: string | null };
export function feedVersion(g: GtfsFiles): string;
```

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev fflate@0.8.2`
Expected: `package.json` devDependencies gains `"fflate": "^0.8.2"`. fflate is pipeline-only and never ships in the bundle, so it needs no `SOFTWARE` credit.

- [ ] **Step 2: Write the failing tests**

Create `pipeline/test/gtfs.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  activeServices,
  at,
  calendarRange,
  csv,
  feedVersion,
  gtfsFromZip,
  parseGtfsTime,
  pickServiceDate,
  readGtfs,
  type GtfsFiles
} from '../lib/gtfs';

const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WK,1,1,1,1,1,0,0,20260901,20261231\nSA,0,0,0,0,0,1,0,20260901,20261231\n';
const files = (extra: Record<string, string> = {}): GtfsFiles =>
  new Map(Object.entries({ 'calendar.txt': CAL, ...extra }));

describe('csv', () => {
  it('handles a BOM, quotes, escaped quotes, CRLF and a trailing newline', () => {
    const c = csv('﻿a,b,c\r\n1,"x, ""y""",3 \r\n\r\n4,5,6\n');
    expect(c.header).toEqual(['a', 'b', 'c']);
    const rows = [...c.rows()];
    expect(rows).toEqual([
      ['1', 'x, "y"', '3 '],
      ['4', '5', '6']
    ]);
    expect(at(rows[0], c.col('c'))).toBe('3');
    expect(at(rows[0], c.col('missing'))).toBe('');
  });

  it('treats a missing file as empty', () => {
    expect(csv(undefined).header).toEqual([]);
  });
});

describe('parseGtfsTime', () => {
  it('parses times past midnight and rejects blanks', () => {
    expect(parseGtfsTime('07:30:15')).toBe(7 * 3600 + 30 * 60 + 15);
    expect(parseGtfsTime('25:10:00')).toBe(25 * 3600 + 600);
    expect(parseGtfsTime(' 7:05:00')).toBe(7 * 3600 + 300);
    expect(parseGtfsTime('')).toBeNull();
  });
});

describe('service calendar', () => {
  it('honours weekday flags, ranges and calendar_dates exceptions', () => {
    const g = files({
      'calendar_dates.txt':
        'service_id,date,exception_type\nWK,20261013,2\nHOL,20261013,1\nWK,20261014,2\n'
    });
    expect([...activeServices(g, '20261013')]).toEqual(['HOL']);
    expect([...activeServices(g, '20261020')]).toEqual(['WK']);
    expect([...activeServices(g, '20261017')]).toEqual(['SA']);
    expect([...activeServices(g, '20270105')]).toEqual([]);
  });

  it('works for a feed with only calendar_dates', () => {
    const g: GtfsFiles = new Map([
      ['calendar_dates.txt', 'service_id,date,exception_type\nX,20261013,1\n']
    ]);
    expect(calendarRange(g)).toEqual({ start: '20261013', end: '20261013' });
    expect([...activeServices(g, '20261013')]).toEqual(['X']);
  });
});

describe('pickServiceDate', () => {
  it('picks the first Tuesday on or after the target with service', () => {
    expect(pickServiceDate(files(), '2026-10-10')).toEqual({ date: '2026-10-13', warning: null });
    expect(pickServiceDate(files(), '2026-10-13')).toEqual({ date: '2026-10-13', warning: null });
  });

  it('skips a Tuesday removed by calendar_dates', () => {
    const g = files({ 'calendar_dates.txt': 'service_id,date,exception_type\nWK,20261013,2\n' });
    expect(pickServiceDate(g, '2026-10-10').date).toBe('2026-10-20');
  });

  it('starts at the feed start when the target is earlier', () => {
    expect(pickServiceDate(files(), '2026-01-01').date).toBe('2026-09-01');
  });

  it('falls back to the last served Tuesday, with a warning, when the calendar has ended', () => {
    const g = files({
      'calendar.txt':
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
        '1,1,1,1,1,1,0,0,20260723,20260828\n'
    });
    const r = pickServiceDate(g, '2026-10-14');
    expect(r.date).toBe('2026-08-25');
    expect(r.warning).toMatch(/calendar ends 20260828/);
  });

  it('throws when no Tuesday has service', () => {
    const g = files({
      'calendar.txt':
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
        'SA,0,0,0,0,0,1,0,20260901,20261231\n'
    });
    expect(() => pickServiceDate(g, '2026-10-10')).toThrow(/no Tuesday/);
  });
});

describe('reading feeds', () => {
  it('reads a zip (keeping only GTFS tables) and loose files the same way', () => {
    const zip = zipSync({
      'stops.txt': strToU8('stop_id\n1\n'),
      'shapes.txt': strToU8('ignored'),
      'nested/calendar.txt': strToU8(CAL)
    });
    const z = gtfsFromZip(zip);
    expect([...z.keys()].sort()).toEqual(['calendar.txt', 'stops.txt']);
    const dir = mkdtempSync(join(tmpdir(), 'sfh-gtfs-'));
    writeFileSync(join(dir, 'feed.zip'), zip);
    writeFileSync(join(dir, 'stops.txt'), 'stop_id\n1\n');
    expect(readGtfs([{ name: 'gtfs-x.zip', path: join(dir, 'feed.zip') }]).get('stops.txt')).toBe(
      'stop_id\n1\n'
    );
    expect(readGtfs([{ name: 'gtfs-x/stops.txt', path: join(dir, 'stops.txt') }]).get('stops.txt')).toBe(
      'stop_id\n1\n'
    );
  });

  it('versions a feed by feed_info.feed_version, else by calendar range', () => {
    expect(feedVersion(files({ 'feed_info.txt': 'feed_publisher_name,feed_version\nX,72\n' }))).toBe(
      '72'
    );
    expect(feedVersion(files())).toBe('20260901..20261231');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/gtfs.test.ts`
Expected: FAIL, "Cannot find module '../lib/gtfs'".

- [ ] **Step 4: Implement**

Create `pipeline/lib/gtfs.ts`:

```ts
// Static GTFS reading (transit spec §4.2): unzip, CSV, times and the service calendar. Pure TS.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/** GTFS table basename (e.g. 'stops.txt') -> file text. */
export type GtfsFiles = Map<string, string>;

const TABLES = new Set([
  'routes.txt',
  'trips.txt',
  'stops.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt'
]);

export function gtfsFromZip(bytes: Uint8Array): GtfsFiles {
  const files = unzipSync(bytes, { filter: (f) => TABLES.has(basename(f.name)) });
  const out: GtfsFiles = new Map();
  for (const [name, data] of Object.entries(files)) out.set(basename(name), strFromU8(data));
  return out;
}

/** One `.zip` (live lock), or loose `<id>/<table>.txt` files (mini fixture). */
export function readGtfs(files: { name: string; path: string }[]): GtfsFiles {
  if (files.length === 1 && files[0].name.endsWith('.zip')) {
    return gtfsFromZip(readFileSync(files[0].path));
  }
  const out: GtfsFiles = new Map();
  for (const f of files) out.set(basename(f.name), readFileSync(f.path, 'utf8'));
  return out;
}

function* records(text: string): Generator<string[]> {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n) {
    const row: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) throw new Error('unterminated quoted CSV field');
          field += text.slice(i, q);
          i = q + 1;
          if (text[i] === '"') {
            field += '"';
            i++;
          } else break;
        }
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') i++;
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        field = text.slice(i, j);
        i = j;
      }
      row.push(field);
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;
      break;
    }
    if (!(row.length === 1 && row[0] === '')) yield row;
  }
}

export interface Csv {
  header: string[];
  col(name: string): number;
  /** Single-use: the data rows after the header. */
  rows(): Generator<string[]>;
}

export function csv(text: string | undefined): Csv {
  const it = records(text ?? '');
  const first = it.next();
  const header = first.done ? [] : first.value.map((h) => h.trim());
  const ix = new Map(header.map((h, k) => [h, k]));
  return { header, col: (name) => ix.get(name) ?? -1, rows: () => it };
}

export function at(row: string[], k: number): string {
  return k < 0 ? '' : (row[k] ?? '').trim();
}

export function parseGtfsTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s.trim());
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

const DAY_MS = 86_400_000;
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toDate = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)));
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export function activeServices(g: GtfsFiles, date: string): Set<string> {
  const out = new Set<string>();
  const cal = csv(g.get('calendar.txt'));
  const dow = DOW[toDate(date).getUTCDay()];
  const [sid, start, end, day] = ['service_id', 'start_date', 'end_date', dow].map(cal.col);
  for (const r of cal.rows()) {
    if (at(r, start) <= date && date <= at(r, end) && at(r, day) === '1') out.add(at(r, sid));
  }
  const cd = csv(g.get('calendar_dates.txt'));
  const [sid2, d2, type] = ['service_id', 'date', 'exception_type'].map(cd.col);
  for (const r of cd.rows()) {
    if (at(r, d2) !== date) continue;
    if (at(r, type) === '1') out.add(at(r, sid2));
    else if (at(r, type) === '2') out.delete(at(r, sid2));
  }
  return out;
}

export function calendarRange(g: GtfsFiles): { start: string; end: string } | null {
  let start = '';
  let end = '';
  const widen = (a: string, b: string) => {
    if (a && (!start || a < start)) start = a;
    if (b && (!end || b > end)) end = b;
  };
  const cal = csv(g.get('calendar.txt'));
  const [s, e] = ['start_date', 'end_date'].map(cal.col);
  for (const r of cal.rows()) widen(at(r, s), at(r, e));
  const cd = csv(g.get('calendar_dates.txt'));
  const d = cd.col('date');
  for (const r of cd.rows()) widen(at(r, d), at(r, d));
  return start && end ? { start, end } : null;
}

/**
 * Spec §4.2 step 1, per feed: the first Tuesday on or after `target` with any active service. A
 * feed whose calendar ends before `target` uses its last served Tuesday and returns a warning.
 */
export function pickServiceDate(
  g: GtfsFiles,
  target: string
): { date: string; warning: string | null } {
  const range = calendarRange(g);
  if (!range) throw new Error('feed has no calendar');
  let from = target.replaceAll('-', '');
  if (from < range.start) from = range.start;
  const d0 = toDate(from);
  for (
    let t = new Date(d0.getTime() + ((2 - d0.getUTCDay() + 7) % 7) * DAY_MS);
    ymd(t) <= range.end;
    t = new Date(t.getTime() + 7 * DAY_MS)
  ) {
    if (activeServices(g, ymd(t)).size > 0) return { date: iso(ymd(t)), warning: null };
  }
  const e0 = toDate(range.end);
  for (
    let t = new Date(e0.getTime() - ((e0.getUTCDay() - 2 + 7) % 7) * DAY_MS);
    ymd(t) >= range.start;
    t = new Date(t.getTime() - 7 * DAY_MS)
  ) {
    if (activeServices(g, ymd(t)).size > 0) {
      return {
        date: iso(ymd(t)),
        warning: `calendar ends ${range.end}, before ${target}: using ${iso(ymd(t))}`
      };
    }
  }
  throw new Error(`no Tuesday with service in ${range.start}..${range.end}`);
}

export function feedVersion(g: GtfsFiles): string {
  const fi = csv(g.get('feed_info.txt'));
  const k = fi.col('feed_version');
  for (const r of fi.rows()) if (at(r, k)) return at(r, k);
  const range = calendarRange(g);
  return range ? `${range.start}..${range.end}` : 'unknown';
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest --run --project pipeline pipeline/test/gtfs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json pipeline/lib/gtfs.ts pipeline/test/gtfs.test.ts
git commit -m "feat(pipeline): add GTFS reading utilities" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Transit config and the reduction step

**Files:**
- Create: `pipeline/transit-config.ts`
- Create: `pipeline/steps/transit.ts`
- Test: `pipeline/test/transit.test.ts`

**Deviation:** the spec names `pipeline/config/transit-vehicles.ts`, but `pipeline/config.ts` already exists. A sibling `config/` directory would make `'../config'` imports ambiguous to readers, so the file is `pipeline/transit-config.ts`.

**Feed facts verified 2026-10-14 against the live feeds** (record them in the config comments):
- **Muni** `route_id` equals `route_short_name` (`14`, `14R`, `N`, `CA`, `PM`, `PH`).
  - Rail lines are `F J K L M N T` (`route_type` 0). **`E` and `S` are absent** from the current feed, so they are left out of the assignments; a strict build would otherwise fail.
  - `KBUS`, `NBUS`, `TBUS`, `FBUS` (bus substitutions) are `route_type` 3 and get the bus default.
  - Muni has no `parent_station` column.
- **BART** routes are one direction each, with `route_short_name` like `Yellow-S`. The line is the part before `-`.
  - The feed also has `route_type` 3 bus-bridge routes (`BB-A`); BART keeps only type 1.
  - Stops have `parent_station` (`EMBR`, `POWL`).
- **Caltrain** has `route_short_name` `Local Weekday`, `Limited`, `Express`, `South County` (type 2).
  - Platforms are per direction under a parent station (`san_francisco`, `22nd_street`).

**Interfaces:**
- Consumes: `GtfsFiles`, `csv`, `at`, `parseGtfsTime`, `activeServices`, `pickServiceDate` (Task 2); `TransitNetwork`, `ModeId`, `Vehicle` (Task 1); `project`, `segDist2` from `src/lib/plan/geometry.ts`.
- Produces (`pipeline/transit-config.ts`): `GtfsLockId`, `GTFS_FEEDS: Record<GtfsLockId, GtfsFeedSpec>`, `GTFS_IDS`, `OperatorId`, `VEHICLES`, `ASSIGNMENTS`, `OPERATOR_DEFAULT`, `PEAK`, `CLIP_BUFFER_M = 1000`, `PLACE_RADIUS_M = 150`, `routeLine`, `routeMode`, `routeName`, `assignmentFor`, and `placeTokens(name): Set<string>`.
- Produces (`pipeline/steps/transit.ts`):

```ts
export interface FeedInput { spec: GtfsFeedSpec; files: GtfsFiles }
export interface ReduceOpts { targetDate: string /* YYYY-MM-DD */; keep: (lngLat: [number, number]) => boolean; strict: boolean }
export interface ReduceResult { network: TransitNetwork; warnings: string[]; counts: Record<string, number> }
export class TransitBuildError extends Error {}
export function reduceTransit(feeds: FeedInput[], opts: ReduceOpts): ReduceResult;
export function clipFilter(neighborhoods: { features: { geometry: { type: string; coordinates: unknown } }[] }, bufferM: number): (lngLat: [number, number]) => boolean;
export function assignPlaces(stops: { id: string; name: string; lngLat: [number, number]; stationId: string | null; stationName: string | null }[]): Map<string, string>;
```

- [ ] **Step 1: Write the config**

Create `pipeline/transit-config.ts`:

```ts
// Transit feeds, vehicles and route assignments (transit spec §4.1, §4.2 step 7). Every number has
// its source and as-of date. These are seed values: the client may edit the network (spec §8).
import type { ModeId, Vehicle, VehicleId } from '../src/lib/data/transit';

export type OperatorId = 'muni' | 'bart' | 'caltrain';
export type GtfsLockId = 'gtfs-muni' | 'gtfs-bart' | 'gtfs-caltrain';

export interface GtfsFeedSpec {
  lockId: GtfsLockId;
  operator: OperatorId;
  /** Short name shown in tooltips ("Muni 14, 49"). */
  operatorLabel: string;
  /** Lock / manifest source label (shown on /attribution). */
  label: string;
  url: string;
  homepage: string;
  license: string;
  /** GTFS route_type values kept from this feed. */
  routeTypes: number[];
}

export const GTFS_FEEDS: Record<GtfsLockId, GtfsFeedSpec> = {
  'gtfs-muni': {
    lockId: 'gtfs-muni',
    operator: 'muni',
    operatorLabel: 'Muni',
    label: 'SFMTA Muni GTFS',
    url: 'https://muni-gtfs.apps.sfmta.com/data/muni_gtfs-current.zip',
    homepage: 'https://www.sfmta.com/reports/gtfs-transit-data',
    license: 'SFMTA Transit Data License Agreement',
    routeTypes: [0, 3, 5]
  },
  'gtfs-bart': {
    lockId: 'gtfs-bart',
    operator: 'bart',
    operatorLabel: 'BART',
    label: 'BART GTFS',
    url: 'https://www.bart.gov/dev/schedules/google_transit.zip',
    homepage: 'https://www.bart.gov/schedules/developers/gtfs',
    license: 'BART Developer License Agreement',
    routeTypes: [1]
  },
  'gtfs-caltrain': {
    lockId: 'gtfs-caltrain',
    operator: 'caltrain',
    operatorLabel: 'Caltrain',
    label: 'Caltrain GTFS',
    url: 'https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip',
    homepage: 'https://www.caltrain.com/developer-resources',
    license: 'Caltrain (PCJPB) Developer License Agreement',
    routeTypes: [2]
  }
};
export const GTFS_IDS = Object.keys(GTFS_FEEDS) as GtfsLockId[];

export const PEAK = { start: '07:00', end: '09:00' } as const;
export const CLIP_BUFFER_M = 1000;
export const PLACE_RADIUS_M = 150;

const SRTP = 'SFMTA SRTP FY19–30 (Jan 2020), Tables 4-5/4-6';
export const VEHICLES: Record<VehicleId, Vehicle & { source: string }> = {
  'muni-bus-30': { label: 'Muni 30 ft bus', seats: 24, capacity: 33, source: SRTP },
  'muni-bus-40': { label: 'Muni 40 ft bus', seats: 30, capacity: 44, source: SRTP },
  'muni-bus-60': { label: 'Muni 60 ft articulated bus', seats: 45, capacity: 69, source: SRTP },
  'muni-lrv4': { label: 'Muni Metro LRV4 car', seats: 60, capacity: 139, source: SRTP },
  'muni-streetcar': { label: 'Muni historic streetcar', seats: 33, capacity: 69, source: SRTP },
  'muni-cable-powell': { label: 'Powell cable car', seats: 30, capacity: 52, source: SRTP },
  'muni-cable-california': { label: 'California cable car', seats: 35, capacity: 60, source: SRTP },
  'bart-car': {
    label: 'BART car (Fleet of the Future)',
    seats: 54,
    capacity: 107,
    source: 'BART planning standard: 60 seated + 47 standing per car'
  },
  'caltrain-emu7': {
    label: 'Caltrain 7-car electric train',
    seats: 675,
    capacity: 810,
    source: 'Caltrain 2025 Title VI Program (peak load factor 1.2)'
  }
};

export interface Assignment {
  operator: OperatorId;
  lines: string[];
  vehicle: VehicleId;
  cars: number;
  source: string;
}

/** Spec §4.2 step 7. Lines absent from the 2026-07-23 Muni feed (E, S) are omitted. */
export const ASSIGNMENTS: Assignment[] = [
  {
    operator: 'muni',
    lines: ['5', '5R', '7', '8', '9R', '14', '14R', '30', '38', '38R', '49', '1X', '8AX', '8BX', '30X'],
    vehicle: 'muni-bus-60',
    cars: 1,
    source:
      'Wikipedia "List of San Francisco Municipal Railway lines" (^ = 60 ft, July 2022); SFMTA confirms 38/38R, 49, 14R. The 9 is 60 ft on weekends only, so it keeps the 40 ft default.'
  },
  {
    operator: 'muni',
    lines: ['35', '36', '37', '39', '52', '56', '66', '67'],
    vehicle: 'muni-bus-30',
    cars: 1,
    source: 'Wikipedia "List of San Francisco Municipal Railway lines" (community routes)'
  },
  {
    operator: 'muni',
    lines: ['N', 'K', 'T'],
    vehicle: 'muni-lrv4',
    cars: 2,
    source:
      'SFMTA two-car K/T trains; N Judah two-car. Simplification: K counts 2 cars on Ocean Ave, where the rear car is locked.'
  },
  {
    operator: 'muni',
    lines: ['J', 'L', 'M'],
    vehicle: 'muni-lrv4',
    cars: 1,
    source: 'J single car (short platforms). L and M low confidence: no current source on 2-car peaks.'
  },
  { operator: 'muni', lines: ['F'], vehicle: 'muni-streetcar', cars: 1, source: SRTP },
  { operator: 'muni', lines: ['PM', 'PH'], vehicle: 'muni-cable-powell', cars: 1, source: SRTP },
  { operator: 'muni', lines: ['CA'], vehicle: 'muni-cable-california', cars: 1, source: SRTP },
  { operator: 'bart', lines: ['Red'], vehicle: 'bart-car', cars: 10, source: 'BART July 2026 schedule' },
  { operator: 'bart', lines: ['Yellow'], vehicle: 'bart-car', cars: 9, source: 'BART July 2026 schedule' },
  {
    operator: 'bart',
    lines: ['Green', 'Blue'],
    vehicle: 'bart-car',
    cars: 6,
    source: 'BART July 2026 schedule; 6-car base unconfirmed'
  },
  { operator: 'bart', lines: ['Orange'], vehicle: 'bart-car', cars: 6, source: 'BART July 2026 schedule' }
];

export const OPERATOR_DEFAULT: Record<OperatorId, { vehicle: VehicleId; cars: number }> = {
  muni: { vehicle: 'muni-bus-40', cars: 1 },
  bart: { vehicle: 'bart-car', cars: 6 },
  caltrain: { vehicle: 'caltrain-emu7', cars: 1 }
};

/** The line an assignment names: BART "Yellow-S" -> "Yellow"; Caltrain is one line. */
export function routeLine(op: OperatorId, routeId: string, shortName: string): string {
  if (op === 'bart') return (shortName || routeId).split('-')[0];
  if (op === 'caltrain') return 'Caltrain';
  return shortName || routeId;
}

export function routeName(op: OperatorId, routeId: string, shortName: string, longName: string): string {
  if (op === 'bart') return routeLine(op, routeId, shortName);
  return shortName || longName || routeId;
}

export function routeMode(op: OperatorId, routeType: number, line: string): ModeId | null {
  if (op === 'bart') return routeType === 1 ? 'heavy-rail' : null;
  if (op === 'caltrain') return routeType === 2 ? 'commuter-rail' : null;
  if (routeType === 3) return 'bus';
  if (routeType === 5) return 'cable-car';
  if (routeType === 0) return line === 'F' || line === 'E' ? 'streetcar' : 'light-rail';
  return null;
}

export function assignmentFor(op: OperatorId, line: string): { vehicle: VehicleId; cars: number } {
  const a = ASSIGNMENTS.find((x) => x.operator === op && x.lines.includes(line));
  return a ? { vehicle: a.vehicle, cars: a.cars } : OPERATOR_DEFAULT[op];
}

const STOPWORDS = new Set([
  'st', 'street', 'ave', 'avenue', 'blvd', 'station', 'stn', 'metro', 'downtown', 'downtn',
  'inbound', 'outbound', 'ib', 'ob', 'northbound', 'southbound', 'platform', 'bart', 'muni',
  'caltrain', 'the', 'and', 'of', 'plaza', 'un', 'stop'
]);

/** Spec §4.2 step 6: lower-cased name tokens, stopwords and 1-char tokens dropped. */
export function placeTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}
```

(Prettier will reflow `STOPWORDS`; that is fine.)

- [ ] **Step 2: Write the failing reduction tests**

Create `pipeline/test/transit.test.ts`. Its GTFS helper builds feeds inline:

```ts
import { describe, expect, it } from 'vitest';
import type { GtfsFiles } from '../lib/gtfs';
import { GTFS_FEEDS, placeTokens } from '../transit-config';
import { TransitBuildError, assignPlaces, clipFilter, reduceTransit } from '../steps/transit';

const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WK,1,1,1,1,1,0,0,20260901,20261231\n';
const hms = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');

interface T { route: string; dir: 0 | 1; stops: string[]; starts: number[] }
function feed(routes: string, stops: string, trips: T[], extra: Record<string, string> = {}): GtfsFiles {
  const tr = ['route_id,service_id,trip_id,direction_id'];
  const st = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  let n = 0;
  for (const t of trips)
    for (const s0 of t.starts) {
      const id = `t${++n}`;
      tr.push(`${t.route},WK,${id},${t.dir}`);
      t.stops.forEach((s, k) => st.push(`${id},${hms(s0 + 60 * k)},${hms(s0 + 60 * k)},${s},${k + 1}`));
    }
  return new Map(
    Object.entries({
      'calendar.txt': CAL,
      'routes.txt': routes,
      'stops.txt': stops,
      'trips.txt': tr.join('\n') + '\n',
      'stop_times.txt': st.join('\n') + '\n',
      ...extra
    })
  );
}
const every = (h: number, m: number, stepMin: number, count: number) =>
  Array.from({ length: count }, (_, k) => (h * 60 + m + k * stepMin) * 60);

const MUNI_ROUTES =
  'route_id,route_short_name,route_long_name,route_type\n22,22,FILLMORE,3\n14,14,MISSION,3\nN,N,JUDAH,0\n';
const MUNI_STOPS =
  'stop_id,stop_name,stop_lat,stop_lon\n' +
  'a,Mission St & 20th St,37.7596,-122.4195\nb,Mission St & 22nd St,37.7556,-122.4195\n' +
  'c,Metro Powell Station/Downtown,37.784653,-122.407086\nfar,Far St,37.9,-122.4195\n';
const keepAll = () => true;
const opts = { targetDate: '2026-10-10', keep: keepAll, strict: false };

describe('reduceTransit', () => {
  const muni = () =>
    feed(MUNI_ROUTES, MUNI_STOPS, [
      { route: '22', dir: 0, stops: ['a', 'b'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
      { route: '14', dir: 0, stops: ['b', 'a', 'far'], starts: every(7, 0, 15, 8) },
      { route: 'N', dir: 1, stops: ['c'], starts: every(6, 0, 30, 4) } // no peak trips
    ]);

  it('counts peak trips per hour and trips per day per stop, by pattern', () => {
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    const p22 = network.patterns.find((p) => p.routeId === '22')!;
    expect(p22).toMatchObject({ id: 'muni:22:0:0', mode: 'bus', vehicle: 'muni-bus-40', cars: 1 });
    expect(p22.stops.map((s) => [network.stops[s.stop].id, s.tph, s.tpd])).toEqual([
      ['muni:a', 6, 13],
      ['muni:b', 6, 13]
    ]);
    expect(network.patterns.find((p) => p.routeId === '14')).toMatchObject({
      vehicle: 'muni-bus-60'
    });
    expect(network.operators).toEqual([{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }]);
  });

  it('drops patterns with no peak service and stops no kept pattern serves', () => {
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    expect(network.patterns.some((p) => p.routeId === 'N')).toBe(false);
    expect(network.stops.map((s) => s.id)).not.toContain('muni:c');
  });

  it('clips stops, keeping the pattern for its kept stops', () => {
    const keep = ([, lat]: [number, number]) => lat < 37.8;
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], {
      ...opts,
      keep
    });
    const p14 = network.patterns.find((p) => p.routeId === '14')!;
    expect(p14.stops.map((s) => network.stops[s.stop].id)).toEqual(['muni:b', 'muni:a']);
    expect(network.stops.map((s) => s.id)).not.toContain('muni:far');
  });

  it('uses the departure time, falling back to arrival, and counts untimed rows', () => {
    const files = muni();
    files.set(
      'stop_times.txt',
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,07:10:00,,a,1\nt1,,,b,2\n'
    );
    files.set('trips.txt', 'route_id,service_id,trip_id,direction_id\n22,WK,t1,0\n');
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files }], opts);
    expect(r.network.patterns[0].stops[0].tph).toBe(0.5);
    expect(r.counts['transit.untimed_stop_times']).toBe(1);
  });

  it('keeps only BART heavy rail, names lines by colour, sizes trains by line', () => {
    const bart = feed(
      'route_id,route_short_name,route_long_name,route_type\n7,Red-S,Richmond to SFO,1\nBB-A,BridgeA,Bus Bridge,3\n',
      'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
        'POWL,Powell Street,37.784606,-122.407331,1,\nM30-1,Powell Street,37.784645,-122.407387,0,POWL\n',
      [
        { route: '7', dir: 0, stops: ['M30-1'], starts: every(7, 0, 15, 8) },
        { route: 'BB-A', dir: 0, stops: ['M30-1'], starts: every(7, 0, 5, 24) }
      ]
    );
    const { network } = reduceTransit([{ spec: GTFS_FEEDS['gtfs-bart'], files: bart }], opts);
    expect(network.patterns).toHaveLength(1);
    expect(network.patterns[0]).toMatchObject({ routeName: 'Red', mode: 'heavy-rail', cars: 10 });
    expect(network.stops[0]).toMatchObject({ id: 'bart:M30-1', stationId: 'bart:POWL' });
  });

  it('reports a feed whose calendar ended before the target date', () => {
    const files = muni();
    files.set(
      'calendar.txt',
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260723,20260828\n'
    );
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files }], {
      ...opts,
      targetDate: '2026-10-14'
    });
    expect(r.network.operators[0].serviceDate).toBe('2026-08-25');
    expect(r.network.patterns.length).toBeGreaterThan(0);
    expect(r.warnings.join('\n')).toMatch(/gtfs-muni: calendar ends 20260828/);
  });

  it('fails a strict build when an assigned line is missing from its feed', () => {
    expect(() =>
      reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], { ...opts, strict: true })
    ).toThrow(TransitBuildError);
    const r = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts);
    expect(r.warnings.join('\n')).toMatch(/assigned line 38R is not in gtfs-muni/);
  });

  it('is deterministic: stops and patterns sorted by id', () => {
    const a = reduceTransit([{ spec: GTFS_FEEDS['gtfs-muni'], files: muni() }], opts).network;
    const ids = a.stops.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    const pids = a.patterns.map((p) => p.id);
    expect(pids).toEqual([...pids].sort());
  });
});

describe('places', () => {
  it('tokenises names without stopwords', () => {
    expect([...placeTokens('Metro Powell Station/Downtown')]).toEqual(['powell']);
    expect([...placeTokens('Civic Center/UN Plaza')]).toEqual(['civic', 'center']);
  });

  it('groups nearby stops that share a name token, across operators', () => {
    const places = assignPlaces([
      { id: 'muni:5417', name: 'Metro Powell Station/Downtown', lngLat: [-122.407086, 37.784653], stationId: null, stationName: null },
      { id: 'bart:M30-1', name: 'Powell Street', lngLat: [-122.407387, 37.784645], stationId: 'bart:POWL', stationName: 'Powell Street' },
      { id: 'bart:M30-2', name: 'Powell Street', lngLat: [-122.407302, 37.784576], stationId: 'bart:POWL', stationName: 'Powell Street' },
      { id: 'muni:4757', name: 'Geary St & Powell St', lngLat: [-122.408391, 37.787401], stationId: null, stationName: null },
      { id: 'muni:x', name: 'Market St & 5th St', lngLat: [-122.40709, 37.78466], stationId: null, stationName: null }
    ]);
    expect(places.get('muni:5417')).toBe('bart:POWL');
    expect(places.get('bart:M30-2')).toBe('bart:POWL');
    expect(places.get('muni:4757')).toBe('muni:4757'); // shares "powell" but 320 m away
    expect(places.get('muni:x')).toBe('muni:x'); // 1 m away but no shared token
  });
});

describe('clipFilter', () => {
  const square = {
    features: [
      {
        geometry: {
          type: 'Polygon',
          coordinates: [[[-122.42, 37.76], [-122.41, 37.76], [-122.41, 37.77], [-122.42, 37.77], [-122.42, 37.76]]]
        }
      }
    ]
  };
  it('keeps points inside or within the buffer, drops the rest', () => {
    const keep = clipFilter(square, 1000);
    expect(keep([-122.415, 37.765])).toBe(true);
    expect(keep([-122.405, 37.765])).toBe(true); // ~440 m east of the edge
    expect(keep([-122.39, 37.765])).toBe(false); // ~1.8 km east
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/transit.test.ts`
Expected: FAIL, "Cannot find module '../steps/transit'".

- [ ] **Step 4: Implement the reduction**

Create `pipeline/steps/transit.ts`:

```ts
// Transit spec §4.2: reduce GTFS feeds to the seed TransitNetwork. Pure TS, deterministic.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModeId, Pattern, TransitNetwork } from '../../src/lib/data/transit';
import { encodeTransit } from '../../src/lib/data/transit-codec';
import { project, segDist2, type XY } from '../../src/lib/plan/geometry';
import {
  activeServices,
  at,
  csv,
  parseGtfsTime,
  pickServiceDate,
  readGtfs,
  type GtfsFiles
} from '../lib/gtfs';
import { rawPath, type Lock } from '../lib/lock';
import {
  ASSIGNMENTS,
  CLIP_BUFFER_M,
  GTFS_FEEDS,
  PEAK,
  PLACE_RADIUS_M,
  VEHICLES,
  assignmentFor,
  placeTokens,
  routeLine,
  routeMode,
  routeName,
  type GtfsFeedSpec
} from '../transit-config';

export class TransitBuildError extends Error {}

export interface FeedInput {
  spec: GtfsFeedSpec;
  files: GtfsFiles;
}
export interface ReduceOpts {
  targetDate: string;
  keep: (lngLat: [number, number]) => boolean;
  strict: boolean;
}
export interface ReduceResult {
  network: TransitNetwork;
  warnings: string[];
  counts: Record<string, number>;
}

interface RawStop {
  id: string;
  name: string;
  lngLat: [number, number];
  stationId: string | null;
  stationName: string | null;
}
type RawPattern = Omit<Pattern, 'stops'> & { stops: { stopId: string; tph: number; tpd: number }[] };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
};

function reduceFeed(
  { spec, files: g }: FeedInput,
  opts: ReduceOpts,
  warn: (m: string) => void,
  counts: Record<string, number>
): { serviceDate: string; stops: Map<string, RawStop>; patterns: RawPattern[] } {
  const op = spec.operator;
  const { date, warning } = pickServiceDate(g, opts.targetDate);
  if (warning) warn(`${spec.lockId}: ${warning}`);
  const services = activeServices(g, date.replaceAll('-', ''));

  const routes = new Map<string, { line: string; name: string; mode: ModeId; vehicle: string; cars: number }>();
  const rc = csv(g.get('routes.txt'));
  const [rid, rshort, rlong, rtype] = [
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type'
  ].map(rc.col);
  for (const r of rc.rows()) {
    const type = Number(at(r, rtype));
    if (!spec.routeTypes.includes(type)) continue;
    const id = at(r, rid);
    const line = routeLine(op, id, at(r, rshort));
    const mode = routeMode(op, type, line);
    if (!mode) continue;
    routes.set(id, {
      line,
      name: routeName(op, id, at(r, rshort), at(r, rlong)),
      mode,
      ...assignmentFor(op, line)
    });
  }
  const lines = new Set([...routes.values()].map((r) => r.line));
  for (const a of ASSIGNMENTS.filter((x) => x.operator === op)) {
    for (const line of a.lines) {
      if (lines.has(line)) continue;
      const msg = `assigned line ${line} is not in ${spec.lockId}`;
      if (opts.strict) throw new TransitBuildError(msg);
      warn(msg);
    }
  }

  const trips = new Map<string, { route: string; dir: 0 | 1 }>();
  const tc = csv(g.get('trips.txt'));
  const [troute, tservice, tid, tdir] = ['route_id', 'service_id', 'trip_id', 'direction_id'].map(
    tc.col
  );
  for (const r of tc.rows()) {
    if (routes.has(at(r, troute)) && services.has(at(r, tservice))) {
      trips.set(at(r, tid), { route: at(r, troute), dir: at(r, tdir) === '1' ? 1 : 0 });
    }
  }

  const seqs = new Map<string, [seq: number, stop: string, sec: number][]>();
  const sc = csv(g.get('stop_times.txt'));
  const [strip, sstop, sseq, sdep, sarr] = [
    'trip_id',
    'stop_id',
    'stop_sequence',
    'departure_time',
    'arrival_time'
  ].map(sc.col);
  let untimed = 0;
  for (const r of sc.rows()) {
    const trip = at(r, strip);
    if (!trips.has(trip)) continue;
    const sec = parseGtfsTime(at(r, sdep)) ?? parseGtfsTime(at(r, sarr));
    if (sec === null) untimed++;
    let list = seqs.get(trip);
    if (!list) seqs.set(trip, (list = []));
    list.push([Number(at(r, sseq)), at(r, sstop), sec ?? -1]);
  }
  counts['transit.untimed_stop_times'] = (counts['transit.untimed_stop_times'] ?? 0) + untimed;

  const [p0, p1] = [hhmm(PEAK.start), hhmm(PEAK.end)];
  const pats = new Map<string, { route: string; dir: 0 | 1; stops: string[]; peak: number[]; day: number[] }>();
  for (const [trip, rows] of seqs) {
    rows.sort((a, b) => a[0] - b[0]);
    const t = trips.get(trip)!;
    const stops = rows.map((r) => r[1]);
    const key = `${t.route}\u0000${t.dir}\u0000${stops.join('\u0000')}`;
    let p = pats.get(key);
    if (!p) {
      p = { route: t.route, dir: t.dir, stops, peak: stops.map(() => 0), day: stops.map(() => 0) };
      pats.set(key, p);
    }
    rows.forEach((r, k) => {
      p.day[k]++;
      if (r[2] >= p0 && r[2] < p1) p.peak[k]++;
    });
  }

  const all = new Map<string, { name: string; lngLat: [number, number]; parent: string }>();
  const stc = csv(g.get('stops.txt'));
  const [sid, sname, slat, slon, sparent] = [
    'stop_id',
    'stop_name',
    'stop_lat',
    'stop_lon',
    'parent_station'
  ].map(stc.col);
  for (const r of stc.rows()) {
    all.set(at(r, sid), {
      name: at(r, sname),
      lngLat: [r6(Number(at(r, slon))), r6(Number(at(r, slat)))],
      parent: at(r, sparent)
    });
  }

  const peakHours = (p1 - p0) / 3600;
  const used = new Map<string, RawStop>();
  const patterns: RawPattern[] = [];
  const seq = new Map<string, number>();
  for (const key of [...pats.keys()].sort(cmp)) {
    const p = pats.get(key)!;
    const route = routes.get(p.route)!;
    const kept = p.stops
      .map((s, k) => ({ s, k }))
      .filter(({ s }) => {
        const st = all.get(s);
        return st !== undefined && opts.keep(st.lngLat);
      });
    if (kept.length === 0 || kept.every(({ k }) => p.peak[k] === 0)) continue;
    const rd = `${p.route}:${p.dir}`;
    const n = seq.get(rd) ?? 0;
    seq.set(rd, n + 1);
    for (const { s } of kept) {
      if (used.has(s)) continue;
      const st = all.get(s)!;
      const parent = st.parent ? all.get(st.parent) : undefined;
      used.set(s, {
        id: `${op}:${s}`,
        name: st.name,
        lngLat: st.lngLat,
        stationId: st.parent ? `${op}:${st.parent}` : null,
        stationName: parent?.name ?? null
      });
    }
    patterns.push({
      id: `${op}:${p.route}:${p.dir}:${n}`,
      operatorId: op,
      routeId: p.route,
      routeName: route.name,
      mode: route.mode,
      direction: p.dir,
      vehicle: route.vehicle,
      cars: route.cars,
      stops: kept.map(({ s, k }) => ({
        stopId: `${op}:${s}`,
        tph: Math.round((p.peak[k] / peakHours) * 10) / 10,
        tpd: p.day[k]
      }))
    });
  }
  return { serviceDate: date, stops: used, patterns };
}

/** Spec §4.2 step 6. Returns stop id -> placeId (the smallest node id in its group). */
export function assignPlaces(stops: RawStop[]): Map<string, string> {
  const nodes = new Map<string, { xy: XY; tokens: Set<string> }>();
  const nodeOf = (s: RawStop) => s.stationId ?? s.id;
  for (const s of [...stops].sort((a, b) => cmp(a.id, b.id))) {
    const k = nodeOf(s);
    if (!nodes.has(k))
      nodes.set(k, { xy: project(s.lngLat[0], s.lngLat[1]), tokens: placeTokens(s.stationName ?? s.name) });
  }
  const keys = [...nodes.keys()].sort(cmp);
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const r2 = PLACE_RADIUS_M * PLACE_RADIUS_M;
  for (let i = 0; i < keys.length; i++) {
    const a = nodes.get(keys[i])!;
    for (let j = i + 1; j < keys.length; j++) {
      const b = nodes.get(keys[j])!;
      const dx = a.xy[0] - b.xy[0];
      const dy = a.xy[1] - b.xy[1];
      if (dx * dx + dy * dy > r2) continue;
      if (![...a.tokens].some((t) => b.tokens.has(t))) continue;
      const [ra, rb] = [find(keys[i]), find(keys[j])];
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  }
  return new Map(stops.map((s) => [s.id, find(nodeOf(s))]));
}

type Ring = [number, number][];

/** Spec §4.2 step 3: inside any neighborhood polygon, or within `bufferM` of one. */
export function clipFilter(
  neighborhoods: { features: { geometry: { type: string; coordinates: unknown } }[] },
  bufferM: number
): (lngLat: [number, number]) => boolean {
  const rings: XY[][] = [];
  for (const f of neighborhoods.features) {
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as Ring[]]
        : (f.geometry.coordinates as Ring[][]);
    for (const poly of polys) rings.push(poly[0].map(([lng, lat]) => project(lng, lat)));
  }
  const b2 = bufferM * bufferM;
  return ([lng, lat]) => {
    const p = project(lng, lat);
    for (const ring of rings) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
          inside = !inside;
        if (segDist2(p, ring[j], ring[i]) <= b2) return true;
      }
      if (inside) return true;
    }
    return false;
  };
}

export function reduceTransit(feeds: FeedInput[], opts: ReduceOpts): ReduceResult {
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const parts = feeds.map((f) => ({ f, r: reduceFeed(f, opts, (m) => warnings.push(m), counts) }));
  const raw = parts.flatMap(({ r }) => [...r.stops.values()]).sort((a, b) => cmp(a.id, b.id));
  const index = new Map(raw.map((s, i) => [s.id, i]));
  const places = assignPlaces(raw);
  const patterns: Pattern[] = parts
    .flatMap(({ r }) => r.patterns)
    .sort((a, b) => cmp(a.id, b.id))
    .map((p) => ({
      ...p,
      stops: p.stops.map((s) => ({ stop: index.get(s.stopId)!, tph: s.tph, tpd: s.tpd }))
    }));
  const network: TransitNetwork = {
    peak: { start: PEAK.start, end: PEAK.end },
    operators: parts.map(({ f, r }) => ({
      id: f.spec.operator,
      label: f.spec.operatorLabel,
      serviceDate: r.serviceDate
    })),
    vehicles: Object.fromEntries(
      Object.entries(VEHICLES).map(([k, v]) => [k, { label: v.label, seats: v.seats, capacity: v.capacity }])
    ),
    stops: raw.map((s) => ({
      id: s.id,
      name: s.name,
      lngLat: s.lngLat,
      stationId: s.stationId,
      placeId: places.get(s.id)!
    })),
    patterns
  };
  counts['transit.stops'] = network.stops.length;
  counts['transit.patterns'] = network.patterns.length;
  return { network, warnings, counts };
}

/**
 * Build step: read every gtfs-* lock entry, reduce, write `<outDir>/transit.json`. Needs
 * `<outDir>/neighborhoods.geojson` (written earlier in the build) for the clip.
 */
export function writeTransit(a: {
  lock: Lock;
  rawDir: string;
  byName: boolean;
  outDir: string;
  targetDate: string;
  strict: boolean;
}): { bytes: number; counts: Record<string, number>; warnings: string[] } {
  const feeds: FeedInput[] = Object.values(GTFS_FEEDS).map((spec) => {
    const entry = a.lock.sources.find((s) => s.id === spec.lockId);
    if (!entry) throw new TransitBuildError(`lock has no ${spec.lockId} entry`);
    const files = entry.files.map((f) => ({ name: f.name, path: rawPath(a.rawDir, f, a.byName) }));
    return { spec, files: readGtfs(files) };
  });
  const nb = JSON.parse(readFileSync(join(a.outDir, 'neighborhoods.geojson'), 'utf8'));
  const r = reduceTransit(feeds, {
    targetDate: a.targetDate,
    keep: clipFilter(nb, CLIP_BUFFER_M),
    strict: a.strict
  });
  const body = Buffer.from(encodeTransit(r.network));
  writeFileSync(join(a.outDir, 'transit.json'), body);
  return { bytes: body.length, counts: { ...r.counts, 'transit.bytes': body.length }, warnings: r.warnings };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest --run --project pipeline pipeline/test/transit.test.ts pipeline/test/gtfs.test.ts`
Expected: PASS. If the Powell grouping test fails, the cause is a distance fixture value; the stop coordinates above come from the live feeds (BART `POWL`, Muni stop 5417), so check the token set first.

- [ ] **Step 6: Commit**

```bash
git add pipeline/transit-config.ts pipeline/steps/transit.ts pipeline/test/transit.test.ts
git commit -m "feat(pipeline): reduce GTFS feeds to the transit seed network" -m "Config lives in pipeline/transit-config.ts (not pipeline/config/, which would shadow config.ts). E and S are omitted from Muni assignments: absent from the current feed." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fetch, build, manifest, V14 and the fixture

**Files:**
- Create: `pipeline/sources/gtfs.ts`
- Modify: `pipeline/steps/fetch.ts` (`FETCH_IDS`, dispatch)
- Modify: `pipeline/steps/build.ts` (call `writeTransit`, counts, warnings, pass `transit` to the manifest)
- Modify: `pipeline/steps/manifest.ts` (`buildManifest` arg `transit?: boolean`)
- Modify: `pipeline/steps/check.ts` (V14)
- Modify: `pipeline/config.ts` (`InvariantProfile` fields, both profiles)
- Modify: `pipeline/steps/fixture.ts` (`GOLDEN_FILES`)
- Modify: `pipeline/test/golden.test.ts` (`COMPARED`)
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts`, `pipeline/test/fixtures/mini/README.md`
- Modify: `pipeline/test/fetch.test.ts`, `pipeline/test/manifest.test.ts`, `pipeline/test/invariants.test.ts`
- Regenerate: `pipeline/test/fixtures/mini/{raw,sources.lock.json,golden}`, `e2e/fixtures/data/fixture-0/`
- Modify: `pipeline/sources.lock.json` (live GTFS entries; needs network)

**Interfaces:**
- Consumes: `GTFS_FEEDS`, `GTFS_IDS` (Task 3), `gtfsFromZip`, `feedVersion`, `csv` (Task 2), `writeTransit` (Task 3), `decodeTransit` (Task 1).
- Produces: `fetchGtfs(id: GtfsLockId, rawDir: string, http: Http, now?: Date): Promise<LockEntry>`; the manifest `transit` URL in every build; `InvariantProfile.transitMinStops: number`; `InvariantProfile.transitHeavyRailStations: string[]`. After this task, fixture-0 contains `transit.json` with 8 stops.

- [ ] **Step 1: Write the failing fetch test**

Add to `pipeline/test/fetch.test.ts`. Read the file first and reuse its fake `Http` helper and temp-dir conventions.

```ts
import { strToU8, zipSync } from 'fflate';
import { fetchGtfs } from '../sources/gtfs';

describe('fetchGtfs', () => {
  it('stores the zip by sha256 and versions it from the feed', async () => {
    const zip = zipSync({
      'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\n1,A,37.7,-122.4\n2,B,37.7,-122.4\n'),
      'stop_times.txt': strToU8('trip_id,stop_id\n'),
      'calendar.txt': strToU8(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260901,20261231\n'
      )
    });
    const http = { get: async () => ({ status: 200, headers: new Headers(), body: zip }) };
    const raw = mkdtempSync(join(tmpdir(), 'sfh-gtfs-raw-'));
    const e = await fetchGtfs('gtfs-bart', raw, http, new Date('2026-10-14T00:00:00Z'));
    expect(e).toMatchObject({
      id: 'gtfs-bart',
      rowCount: 2,
      upstreamVersion: '20260901..20261231',
      retrievedAt: '2026-10-14T00:00:00.000Z',
      label: 'BART GTFS'
    });
    expect(e.files[0].name).toBe('gtfs-bart.zip');
  });

  it('rejects a response that is not a GTFS zip', async () => {
    const http = {
      get: async () => ({ status: 200, headers: new Headers(), body: zipSync({ 'x.txt': strToU8('x') }) })
    };
    await expect(fetchGtfs('gtfs-muni', tmpdir(), http)).rejects.toThrow(/not a GTFS zip/);
  });
});
```

(Add `mkdtempSync`, `tmpdir`, `join` imports if the file lacks them.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run --project pipeline pipeline/test/fetch.test.ts`
Expected: FAIL, "Cannot find module '../sources/gtfs'".

- [ ] **Step 3: Implement the fetcher and wire it into `fetch`**

Create `pipeline/sources/gtfs.ts`:

```ts
import type { Http } from '../lib/http';
import { csv, feedVersion, gtfsFromZip } from '../lib/gtfs';
import type { LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import { GTFS_FEEDS, type GtfsLockId } from '../transit-config';

/** Transit spec §4.1: one zip per operator feed, straight from the agency URL. */
export async function fetchGtfs(
  id: GtfsLockId,
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const spec = GTFS_FEEDS[id];
  const res = await http.get(spec.url);
  if (res.status !== 200) throw new Error(`GET ${spec.url}: HTTP ${res.status}`);
  const g = gtfsFromZip(res.body);
  if (!g.has('stops.txt') || !g.has('stop_times.txt'))
    throw new Error(`${id}: not a GTFS zip (no stops.txt / stop_times.txt)`);
  let rowCount = 0;
  for (const _ of csv(g.get('stops.txt')).rows()) rowCount++;
  return {
    id,
    files: [storeBytes(rawDir, `${id}.zip`, spec.url, res.body)],
    retrievedAt: now.toISOString(),
    upstreamVersion: feedVersion(g),
    rowCount,
    license: spec.license,
    label: spec.label,
    homepage: spec.homepage
  };
}
```

In `pipeline/steps/fetch.ts`, import `GTFS_IDS, type GtfsLockId` from `'../transit-config'` and `fetchGtfs` from `'../sources/gtfs'`. Then:

```ts
export const FETCH_IDS = [
  ...(Object.keys(DATASF) as DatasfId[]),
  'overture-buildings',
  'protomaps-basemap',
  'protomaps-fonts',
  ...GTFS_IDS
] as const;
```

In the dispatch, before the final `else entry = await fetchFonts(...)`:

```ts
    } else if ((GTFS_IDS as readonly string[]).includes(id)) {
      entry = await fetchGtfs(id as GtfsLockId, rawDir, http);
    } else entry = await fetchFonts(rawDir, http);
```

- [ ] **Step 4: Run the fetch tests**

Run: `npx vitest --run --project pipeline pipeline/test/fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing manifest and V14 tests**

In `pipeline/test/manifest.test.ts`, add:

```ts
  it('names transit.json when the build wrote one', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: [],
      transit: true
    });
    expect(m.transit).toBe('/data/fixture-3/transit.json');
  });
```

In `pipeline/test/invariants.test.ts`, read how it builds a dataset dir and calls `checkDataset`. Add V14 cases using the same helpers:
1. A dataset whose `transit.json` is `encodeTransit(tinyNetwork())`, with `tinyNetwork` from `src/lib/data/fixtures/transit-tiny.ts` (Task 1). With a profile of `{ transitMinStops: 2, transitHeavyRailStations: ['Fixture Station'] }`, V14 is ok.
2. The same dataset with `transitHeavyRailStations: ['Embarcadero']` fails with detail matching `/no heavy-rail service at Embarcadero/`.
3. A manifest without `transit` fails with `/manifest has no transit/`.
4. Every existing assertion on the result count (13) becomes 14.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/manifest.test.ts pipeline/test/invariants.test.ts`
Expected: FAIL. `transit` is unknown to `buildManifest`, and V14 is missing.

- [ ] **Step 7: Implement the manifest arg, V14 and the profile fields**

`pipeline/steps/manifest.ts`: add `transit?: boolean;` to the `buildManifest` argument type. In the object passed to `parseManifest`, after `neighborhoods`:

```ts
    neighborhoods: `${base}/neighborhoods.geojson`,
    ...(a.transit ? { transit: `${base}/transit.json` } : {})
```

`pipeline/config.ts`: add to `InvariantProfile`:

```ts
  /** V14: minimum stops in transit.json. */
  transitMinStops: number;
  /** V14: each name (case-insensitive substring) must be a stop with heavy-rail service > 0 tph. */
  transitHeavyRailStations: string[];
```

In `LIVE_PROFILE`:

```ts
  transitMinStops: 3000,
  transitHeavyRailStations: [
    'Embarcadero',
    'Montgomery',
    'Powell',
    'Civic Center',
    '16th',
    '24th',
    'Glen Park',
    'Balboa Park'
  ]
```

In `FIXTURE_PROFILE`, update the doc comment ("8 transit stops, one BART station") and add:

```ts
  transitMinStops: 8,
  transitHeavyRailStations: ['Fixture Station']
```

`pipeline/steps/check.ts`: import `decodeTransit` from `'../../src/lib/data/transit-codec'`. Change the doc comment to "V1–V14" and add before `return out;`:

```ts
  // V14 transit network (transit spec §4.3).
  {
    const problems: string[] = [];
    let detail = '';
    if (!m?.transit) problems.push('manifest has no transit');
    else {
      try {
        const rel = m.transit.slice(`/data/${m.datasetVersion}/`.length);
        const net = decodeTransit(readFileSync(join(outDir, rel), 'utf8'));
        if (net.stops.length < profile.transitMinStops)
          problems.push(`${net.stops.length} stops < ${profile.transitMinStops}`);
        const heavy = new Set<number>();
        for (const p of net.patterns)
          if (p.mode === 'heavy-rail') for (const s of p.stops) if (s.tph > 0) heavy.add(s.stop);
        const missing = profile.transitHeavyRailStations.filter(
          (name) =>
            ![...heavy].some((i) => net.stops[i].name.toLowerCase().includes(name.toLowerCase()))
        );
        if (missing.length) problems.push(`no heavy-rail service at ${missing.join(', ')}`);
        detail = `${net.stops.length} stops, ${net.patterns.length} patterns, ${heavy.size} heavy-rail stops`;
      } catch (e) {
        problems.push(`transit.json: ${(e as Error).message}`);
      }
    }
    add('V14', problems.length === 0, problems.length ? problems.join('; ') : detail);
  }
```

Codec validation already covers the round-trip, in-range stop indices and `tph ≥ 0` checks from spec V14: decoding fails otherwise.

- [ ] **Step 8: Wire `writeTransit` into the build**

In `pipeline/steps/build.ts`, import `writeTransit` from `'./transit'`. After `const neighborhoodsBytes = await writeNeighborhoods(db, outDir);`:

```ts
    const newest = lock.sources.reduce((d, s) => (s.retrievedAt > d ? s.retrievedAt : d), '');
    const transit = await report.time('transit', async () =>
      writeTransit({
        lock,
        rawDir: opts.rawDir,
        byName,
        outDir,
        targetDate: newest.slice(0, 10),
        // The mini fixture's feeds carry only a few lines; assignment checks are live-only.
        strict: !fixtureMode
      })
    );
    report.warnings.push(...transit.warnings);
```

Pass `transit: true` to `buildManifest({...})`, and spread `...transit.counts` into `counts` after `...chunkCounts(chunks)`.

- [ ] **Step 9: Run the unit tests**

Run: `npx vitest --run --project pipeline pipeline/test/manifest.test.ts pipeline/test/invariants.test.ts pipeline/test/fetch.test.ts`
Expected: PASS.

- [ ] **Step 10: Add mini GTFS to the fixture generator**

In `pipeline/test/fixtures/mini/make-fixture.ts`, import `GTFS_FEEDS` from `'../../../transit-config'`. Add before `// ---- write ----`:

```ts
// ---- GTFS (transit spec §4.4) ----
// Local metres from O like the lots. Expected: 8 kept stops (m1 m2 m3 m4 m5 FX-1 70011 70012);
// mx, FAR and far_ct lie > 1 km outside the neighborhoods and are clipped. Muni's 2026-10-13 is
// removed by calendar_dates, so Muni counts 2026-10-20 while BART and Caltrain count 2026-10-13.
// m4 ("Metro Fixture Station") and FX-1 (station "Fixture Station") share a place.
const hms = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
const every = (h: number, m: number, stepMin: number, count: number) =>
  Array.from({ length: count }, (_, k) => (h * 60 + m + k * stepMin) * 60);
interface FxStop { id: string; name: string; at: [number, number]; station?: boolean; parent?: string }
interface FxTrip { route: string; dir: 0 | 1; stops: string[]; starts: number[] }
const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WKDY,1,1,1,1,1,0,0,20260901,20261231\n';
function gtfs(f: { routes: string; stops: FxStop[]; trips: FxTrip[]; dates?: string }) {
  const stops = ['stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station'];
  for (const s of f.stops) {
    const [lng, lat] = ll(s.at);
    stops.push(`${s.id},"${s.name}",${lat},${lng},${s.station ? 1 : 0},${s.parent ?? ''}`);
  }
  const trips = ['route_id,service_id,trip_id,direction_id'];
  const times = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  let n = 0;
  for (const t of f.trips)
    for (const s0 of t.starts) {
      const id = `t${String(++n).padStart(3, '0')}`;
      trips.push(`${t.route},WKDY,${id},${t.dir}`);
      t.stops.forEach((s, k) => times.push(`${id},${hms(s0 + 60 * k)},${hms(s0 + 60 * k)},${s},${k + 1}`));
    }
  return {
    'calendar.txt': CAL,
    'calendar_dates.txt': f.dates ?? 'service_id,date,exception_type\n',
    'routes.txt': f.routes,
    'stop_times.txt': times.join('\n') + '\n',
    'stops.txt': stops.join('\n') + '\n',
    'trips.txt': trips.join('\n') + '\n'
  };
}
const GTFS: Record<string, Record<string, string>> = {
  'gtfs-muni': gtfs({
    routes:
      'route_id,route_short_name,route_long_name,route_type\n22,22,FILLMORE,3\n14,14,MISSION,3\nN,N,JUDAH,0\n',
    stops: [
      { id: 'm1', name: 'Mission St & 20th St', at: [0, -50] },
      { id: 'm2', name: 'Mission St & 22nd St', at: [0, -250] },
      { id: 'm3', name: 'Valencia St & 20th St', at: [170, -50] },
      { id: 'm4', name: 'Metro Fixture Station/Downtown', at: [100, 100] },
      { id: 'm5', name: 'Church St & 24th St', at: [300, 300] },
      { id: 'mx', name: 'Far Away St & Nowhere Ave', at: [3000, 0] }
    ],
    trips: [
      { route: '22', dir: 0, stops: ['m1', 'm2'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
      { route: '22', dir: 1, stops: ['m2', 'm1'], starts: [...every(7, 0, 10, 12), 12 * 3600] },
      { route: '14', dir: 0, stops: ['m3', 'm1', 'mx'], starts: every(7, 0, 15, 8) },
      { route: 'N', dir: 0, stops: ['m4', 'm5'], starts: every(7, 0, 12, 10) }
    ],
    dates: 'service_id,date,exception_type\nWKDY,20261013,2\n'
  }),
  'gtfs-bart': gtfs({
    routes:
      'route_id,route_short_name,route_long_name,route_type\n7,Red-S,Richmond to SFO,1\nBB-A,BridgeA,Bus Bridge,3\n',
    stops: [
      { id: 'FXST', name: 'Fixture Station', at: [120, 110], station: true },
      { id: 'FX-1', name: 'Fixture Station', at: [120, 110], parent: 'FXST' },
      { id: 'FAR', name: 'Far Station', at: [6000, 0] }
    ],
    trips: [{ route: '7', dir: 0, stops: ['FX-1', 'FAR'], starts: every(7, 0, 15, 8) }]
  }),
  'gtfs-caltrain': gtfs({
    routes: 'route_id,route_short_name,route_long_name,route_type\n77119,Local Weekday,,2\n',
    stops: [
      { id: 'fixture_ct', name: 'Fixture Caltrain Station', at: [-40, -80], station: true },
      { id: '70011', name: 'Fixture Caltrain Northbound', at: [-40, -78], parent: 'fixture_ct' },
      { id: '70012', name: 'Fixture Caltrain Southbound', at: [-40, -82], parent: 'fixture_ct' },
      { id: 'far_ct', name: 'Far Caltrain', at: [0, -8000] }
    ],
    // 40 trains each way (80/day at the station: SB 79 tier 1), 5 in the peak window -> 2.5 tph.
    trips: [
      { route: '77119', dir: 0, stops: ['70012', 'far_ct'], starts: every(5, 0, 25, 40) },
      { route: '77119', dir: 1, stops: ['far_ct', '70011'], starts: every(5, 0, 25, 40) }
    ]
  })
};
```

After `fs.mkdirSync(rawDir, { recursive: true });` in the write section, add:

```ts
for (const [id, files] of Object.entries(GTFS)) {
  fs.mkdirSync(path.join(rawDir, id), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(rawDir, id, name), body);
}
```

After the `protomaps-fonts` `binaryEntry` push, add:

```ts
for (const spec of Object.values(GTFS_FEEDS)) {
  entries.push(
    await binaryEntry(
      spec.lockId,
      Object.keys(GTFS[spec.lockId]).sort().map((n) => `${spec.lockId}/${n}`),
      { upstreamVersion: 'fixture', license: spec.license, homepage: spec.homepage, label: spec.label },
      (name) => `https://fixture.invalid/${name}`
    )
  );
}
```

In `pipeline/test/fixtures/mini/README.md`, add a "## Transit" section summarising the stops, routes and expected values from the comment above, and the 8-stop count.

In `pipeline/steps/fixture.ts`, change `GOLDEN_FILES` to `['parcels', 'manifest.json', 'neighborhoods.geojson', 'report.json', 'transit.json']`. In `pipeline/test/golden.test.ts`, add `f === 'transit.json' ||` to `COMPARED`.

- [ ] **Step 11: Regenerate the mini fixture, goldens and fixture-0**

Run, in order:
1. `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`. Expected: the output lists `gtfs-bart: 6`, `gtfs-caltrain: 6`, `gtfs-muni: 6` (files per entry).
2. `npm run pipeline -- fixture --update-golden`. Expected: every line prints `OK`, including `OK   V14  8 stops, 7 patterns, 1 heavy-rail stops`.

Then inspect `pipeline/test/fixtures/mini/golden/transit.json`:
- `operators` has Muni at `2026-10-20` and the others at `2026-10-13`.
- Stops `bart:FX-1` and `muni:m4` share a `place`.
- Pattern `muni:22:0:0` has `tph` `[60, 60]` and `tpd` `[13, 13]`.

- [ ] **Step 12: Run the pipeline suite**

Run: `npm run test:pipeline`
Expected: PASS (golden, invariants, fixture-out, fetch, transit, gtfs).

- [ ] **Step 13: Lock the live feeds (needs network)**

Run: `npm run pipeline -- fetch --only gtfs-muni,gtfs-bart,gtfs-caltrain`
Expected: three `fetch gtfs-…` lines, and `pipeline/sources.lock.json` gains three entries. The other entries are kept, because `--only` preserves them.

If there is no network, skip this step and say so in the task report. `build` will refuse with "lock has no gtfs-muni entry" until someone runs it.

- [ ] **Step 14: Commit**

```bash
git add pipeline e2e/fixtures/data/fixture-0
git commit -m "feat(pipeline): publish transit.json with every dataset (V14)" -m "Fetches Muni, BART and Caltrain GTFS, reduces them in build, names transit.json in the manifest, adds invariant V14 and a mini GTFS fixture. Assignment checks are strict on live builds only." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `npm run data:transit` bootstrap and docs

**Files:**
- Create: `scripts/data-transit.ts`
- Test: `scripts/data-transit.spec.ts`
- Modify: `package.json` (`"data:transit": "tsx scripts/data-transit.ts"`)
- Modify: `CLAUDE.md` (Setup, Commands table)
- Modify: `docs/dev/developing.md`
- Modify: `docs/dev/pipeline.md`

**Interfaces:**
- Consumes: `fetchAll` (`pipeline/steps/fetch.ts`, with a temp `lockPath`), `readLock`, `writeTransit` (Task 3), `parseManifest`, `wranglerTarget({ local: true })` (`pipeline/lib/r2.ts`), `putLocal` (`scripts/r2-put-local.ts`).
- Produces:
  - `devVarsVersion(text: string): string | null`.
  - `withTransit(manifest: Manifest): Manifest`, which adds `transit: /data/<v>/transit.json`.
  - `lockDrift(committed: Lock, fetched: Lock): string[]`, which returns one message per gtfs id whose sha differs.

- [ ] **Step 1: Write the failing tests**

Create `scripts/data-transit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import golden from '../src/lib/data/fixtures/manifest.golden.json';
import { parseManifest } from '../src/lib/data/manifest';
import { devVarsVersion, lockDrift, withTransit } from './data-transit';

describe('data:transit helpers', () => {
  it('reads PUBLIC_DATASET_VERSION from .dev.vars text', () => {
    expect(devVarsVersion('# c\nPUBLIC_DATASET_VERSION=fixture-0\nX=1\n')).toBe('fixture-0');
    expect(devVarsVersion('PUBLIC_DATASET_VERSION="2026-10-10-3fa9c2d1"')).toBe('2026-10-10-3fa9c2d1');
    expect(devVarsVersion('X=1')).toBeNull();
  });

  it('adds transit to a manifest and keeps it valid', () => {
    const m = withTransit(parseManifest(structuredClone(golden)));
    expect(m.transit).toBe(`/data/${m.datasetVersion}/transit.json`);
    expect(parseManifest(m).transit).toBe(m.transit);
  });

  it('reports gtfs entries whose bytes differ from the committed lock', () => {
    const entry = (id: string, sha256: string) => ({
      id,
      files: [{ url: 'u', sha256, bytes: 1, archiveKey: 'k', name: `${id}.zip` }],
      retrievedAt: '2026-10-14T00:00:00.000Z',
      upstreamVersion: 'v',
      rowCount: 1,
      license: 'l',
      homepage: 'https://x.invalid'
    });
    const committed = { sources: [entry('gtfs-muni', 'a'), entry('gtfs-bart', 'b')] };
    const fetched = { sources: [entry('gtfs-muni', 'a'), entry('gtfs-bart', 'c'), entry('gtfs-caltrain', 'd')] };
    expect(lockDrift(committed, fetched)).toEqual([
      'gtfs-bart: fetched bytes differ from pipeline/sources.lock.json (feed rolled over)',
      'gtfs-caltrain: not in pipeline/sources.lock.json'
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server scripts/data-transit.spec.ts`
Expected: FAIL, "Cannot find module './data-transit'".

- [ ] **Step 3: Implement the script**

Create `scripts/data-transit.ts`:

```ts
// `npm run data:transit` (transit spec §4.1): fetch Muni, BART and Caltrain GTFS straight from the
// agencies, build transit.json and add it to the local R2 copy of the dataset in .dev.vars.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATASET_VERSION_RE, parseManifest, type Manifest } from '../src/lib/data/manifest';
import { readLock, type Lock } from '../pipeline/lib/lock';
import { wranglerTarget } from '../pipeline/lib/r2';
import { fetchAll } from '../pipeline/steps/fetch';
import { writeTransit } from '../pipeline/steps/transit';
import { GTFS_IDS } from '../pipeline/transit-config';
import { putLocal } from './r2-put-local';

const ROOT = resolve(import.meta.dirname, '..');

export function devVarsVersion(text: string): string | null {
  const m = /^PUBLIC_DATASET_VERSION\s*=\s*"?([^"\s]+)"?\s*$/m.exec(text);
  return m ? m[1] : null;
}

export function withTransit(m: Manifest): Manifest {
  return { ...m, transit: `/data/${m.datasetVersion}/transit.json` };
}

export function lockDrift(committed: Lock, fetched: Lock): string[] {
  const out: string[] = [];
  for (const f of fetched.sources.filter((s) => s.id.startsWith('gtfs-'))) {
    const c = committed.sources.find((s) => s.id === f.id);
    if (!c) out.push(`${f.id}: not in pipeline/sources.lock.json`);
    else if (c.files[0]?.sha256 !== f.files[0]?.sha256)
      out.push(`${f.id}: fetched bytes differ from pipeline/sources.lock.json (feed rolled over)`);
  }
  return out;
}

async function main(): Promise<number> {
  const version =
    process.argv[2] ??
    (existsSync(join(ROOT, '.dev.vars'))
      ? devVarsVersion(readFileSync(join(ROOT, '.dev.vars'), 'utf8'))
      : null);
  if (!version || !DATASET_VERSION_RE.test(version)) {
    console.error('usage: npm run data:transit [-- <datasetVersion>] (default: .dev.vars)');
    return 2;
  }
  const work = mkdtempSync(join(tmpdir(), 'sfh-transit-'));
  try {
    const lockPath = join(work, 'transit.lock.json');
    const rawDir = join(ROOT, 'pipeline/.cache/raw');
    const code = await fetchAll({ only: GTFS_IDS.join(','), lockPath, rawDir });
    if (code !== 0) return code;
    const fetched = readLock(lockPath);
    const committedPath = join(ROOT, 'pipeline/sources.lock.json');
    if (existsSync(committedPath))
      for (const w of lockDrift(readLock(committedPath), fetched)) console.warn(`warning: ${w}`);
    const r2 = wranglerTarget({ local: true });
    for (const f of ['manifest.json', 'neighborhoods.geojson']) {
      if (!(await r2.get(`data/${version}/${f}`, join(work, f)))) {
        console.error(
          `data/${version}/${f} is not in local R2: load the dataset first (npm run data:fixture or data:local)`
        );
        return 1;
      }
    }
    const r = writeTransit({
      lock: fetched,
      rawDir,
      byName: false,
      outDir: work,
      targetDate: new Date().toISOString().slice(0, 10),
      strict: false
    });
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    const manifest = withTransit(parseManifest(JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8'))));
    writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest));
    putLocal(version, 'transit.json', join(work, 'transit.json'));
    putLocal(version, 'manifest.json', join(work, 'manifest.json'));
    rmSync(join(ROOT, '.wrangler/state/v3/cache'), { recursive: true, force: true });
    console.log(`transit.json (${r.bytes} B, ${r.counts['transit.stops']} stops) added to local data/${version}/`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? (e.stack ?? e.message) : e);
      process.exit(1);
    }
  );
}
```

Add to `package.json` scripts, after `data:fixture`:

```json
    "data:transit": "tsx scripts/data-transit.ts",
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project server scripts/data-transit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Docs**

- `CLAUDE.md`:
  - In **Setup**, add a commented optional step after `npm run data:fixture`: `npm run data:transit  # optional: live transit (Muni/BART/Caltrain GTFS) into the local dataset; fixture-0 already has a mini network`.
  - In the **Commands** table, add a row: `npm run data:transit [-- <version>]` with "Fetch Muni/BART/Caltrain GTFS from the agencies, build transit.json into the local dataset (`.dev.vars` version)".
- `docs/dev/developing.md`: in the local-data section, add a paragraph covering three points:
  - When to run `data:transit`: after `data:local` of a dataset older than transit, or to see live service.
  - It fetches directly from the agencies.
  - A sha mismatch with the committed lock is only a warning.
- `docs/dev/pipeline.md`:
  - Add GTFS (Muni, BART, Caltrain) to the opening source list, and `transit.json` to the outputs.
  - In **Invariants**, extend "V1 to V13" to "V1 to V14" and add "V14 `transit.json` decodes; enough stops; heavy-rail service at every SF BART station".
  - Add a **Transit** section covering four things:
    - Feeds come only from agency URLs, never 511.
    - Vehicles and route assignments live in `pipeline/transit-config.ts`. Update them when SFMTA reassigns fleets, and use a strict live build to catch renamed lines.
    - The service day is chosen per feed, and an expired feed calendar is a warning.
    - `data:transit` exists for local use.

- [ ] **Step 6: Run the docs index check**

Run: `npx vitest --run --project server scripts/docs-index.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/data-transit.ts scripts/data-transit.spec.ts package.json CLAUDE.md docs/dev/developing.md docs/dev/pipeline.md
git commit -m "feat(scripts): add data:transit bootstrap for local transit data" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Stop service, capacity, class and SB 79 tier

**Files:**
- Create: `src/lib/transit/types.ts`, `src/lib/transit/service.ts`, `src/lib/transit/index.ts`
- Create: `src/lib/transit/test-network.ts` (shared test network; Tasks 8 imports it)
- Test: `src/lib/transit/service.spec.ts`, `src/lib/transit/purity.spec.ts`

**Interfaces:**
- Consumes: `TransitNetwork`, `ModeId` from `$lib/data/transit` (Task 1).
- Produces:

```ts
export interface StopServiceEntry { routeKey: string; operatorId: string; routeName: string; mode: ModeId; tph: number; tpd: number; cap: number }
export type StopService = StopServiceEntry[][];         // index = stop index
export type StopClass = 'regional-rail' | 'rail' | 'bus';
export function routeKey(p: Pick<Pattern, 'operatorId' | 'routeId' | 'direction'>): string; // `${op}:${route}:${dir}`
export function stopService(net: TransitNetwork): StopService;
export function stopCapacity(net: TransitNetwork, service?: StopService): Float64Array;
export function stopClass(entries: readonly StopServiceEntry[]): StopClass;
export function sb79Tier(net: TransitNetwork, stop: number, service?: StopService): 1 | 2 | null;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/transit/test-network.ts`:

```ts
// Test network shared by service and map specs. Five stops: s0 bus, s1 bus + 2-car light rail,
// ct-nb / ct-sb the two platforms of Caltrain station "ct" (40 trains/day each), s4 BART.
import type { Pattern, TransitNetwork } from '$lib/data/transit';

const V = {
  'muni-bus-40': { label: 'bus', seats: 30, capacity: 44 },
  'muni-lrv4': { label: 'lrv', seats: 60, capacity: 139 },
  'bart-car': { label: 'bart', seats: 54, capacity: 107 },
  'caltrain-emu7': { label: 'ct', seats: 675, capacity: 810 }
};
const stop = (id: string, stationId: string | null = null) => ({
  id,
  name: id,
  lngLat: [-122.42, 37.76] as [number, number],
  stationId,
  placeId: stationId ?? id
});
const pat = (p: Partial<Pattern> & Pick<Pattern, 'id' | 'mode' | 'vehicle' | 'stops'>): Pattern => ({
  operatorId: 'muni',
  routeId: p.id,
  routeName: p.id,
  direction: 0,
  cars: 1,
  ...p
});
export function net(): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: V,
    stops: [stop('s0'), stop('s1'), stop('ct-nb', 'ct'), stop('ct-sb', 'ct'), stop('s4')],
    patterns: [
      // Two patterns of the same route-direction both serve s0: they sum.
      pat({ id: 'A', routeId: '22', routeName: '22', mode: 'bus', vehicle: 'muni-bus-40', stops: [{ stop: 0, tph: 6, tpd: 60 }] }),
      pat({ id: 'B', routeId: '22', routeName: '22', mode: 'bus', vehicle: 'muni-bus-40', stops: [{ stop: 0, tph: 2, tpd: 20 }, { stop: 1, tph: 2, tpd: 20 }] }),
      pat({ id: 'N', routeId: 'N', mode: 'light-rail', vehicle: 'muni-lrv4', cars: 2, stops: [{ stop: 1, tph: 5, tpd: 90 }] }),
      pat({ id: 'CTN', operatorId: 'caltrain', routeId: 'L', direction: 1, mode: 'commuter-rail', vehicle: 'caltrain-emu7', stops: [{ stop: 2, tph: 2.5, tpd: 40 }] }),
      pat({ id: 'CTS', operatorId: 'caltrain', routeId: 'L', direction: 0, mode: 'commuter-rail', vehicle: 'caltrain-emu7', stops: [{ stop: 3, tph: 2.5, tpd: 40 }] }),
      pat({ id: 'R', operatorId: 'bart', routeId: '7', routeName: 'Red', mode: 'heavy-rail', vehicle: 'bart-car', cars: 10, stops: [{ stop: 4, tph: 4, tpd: 80 }] })
    ]
  };
}
```

Create `src/lib/transit/service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { routeKey, sb79Tier, stopCapacity, stopClass, stopService } from './service';
import { net } from './test-network';

describe('stopService / stopCapacity', () => {
  it('sums patterns of one route-direction at a stop, cap = tph × capacity × cars', () => {
    const s = stopService(net());
    expect(s[0]).toEqual([
      { routeKey: 'muni:22:0', operatorId: 'muni', routeName: '22', mode: 'bus', tph: 8, tpd: 80, cap: 8 * 44 }
    ]);
    expect(stopCapacity(net())[1]).toBe(2 * 44 + 5 * 139 * 2);
    expect(stopCapacity(net())[4]).toBe(4 * 107 * 10);
  });

  it('recomputes from an edited network (nothing is baked)', () => {
    const n = net();
    n.patterns[2] = { ...n.patterns[2], cars: 1 };
    expect(stopCapacity(n)[1]).toBe(2 * 44 + 5 * 139);
  });

  it('builds route keys from operator, route and direction', () => {
    expect(routeKey({ operatorId: 'bart', routeId: '7', direction: 1 })).toBe('bart:7:1');
  });
});

describe('stopClass', () => {
  it('classes by the highest mode served', () => {
    const s = stopService(net());
    expect(stopClass(s[0])).toBe('bus');
    expect(stopClass(s[1])).toBe('rail');
    expect(stopClass(s[2])).toBe('regional-rail');
    expect(stopClass(s[4])).toBe('regional-rail');
    expect(stopClass([])).toBe('bus');
  });
});

describe('sb79Tier', () => {
  it('heavy rail is tier 1, light rail tier 2, bus-only null', () => {
    expect(sb79Tier(net(), 4)).toBe(1);
    expect(sb79Tier(net(), 1)).toBe(2);
    expect(sb79Tier(net(), 0)).toBeNull();
  });

  it('counts commuter trains across the whole station (both direction platforms)', () => {
    // 40 + 40 = 80 trains/day at station "ct" ≥ 72: tier 1, on either platform.
    expect(sb79Tier(net(), 2)).toBe(1);
    expect(sb79Tier(net(), 3)).toBe(1);
    const n = net();
    n.patterns[3] = { ...n.patterns[3], stops: [{ stop: 2, tph: 2.5, tpd: 20 }] };
    expect(sb79Tier(n, 3)).toBe(2); // 60/day: ≥ 48
    n.patterns[4] = { ...n.patterns[4], stops: [{ stop: 3, tph: 2.5, tpd: 20 }] };
    expect(sb79Tier(n, 3)).toBeNull(); // 40/day
  });
});
```

Create `src/lib/transit/purity.spec.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/lib/transit');
const runtime = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

describe('src/lib/transit purity (spec §5)', () => {
  it('imports no zod, $app, svelte or DOM globals', () => {
    for (const f of runtime) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, f).not.toMatch(/from ['"](zod|\$app\/|svelte)/);
      expect(src, f).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/transit`
Expected: FAIL, "Cannot find module './service'".

- [ ] **Step 3: Implement**

Create `src/lib/transit/types.ts`:

```ts
export type {
  ModeId,
  Operator,
  Pattern,
  PatternStop,
  Stop,
  TransitNetwork,
  Vehicle,
  VehicleId
} from '$lib/data/transit';
```

Create `src/lib/transit/service.ts`:

```ts
// Per-stop derivations (transit spec §5.2). Pure functions of a TransitNetwork: an edited network
// gives new answers, nothing is stored.
import type { ModeId, Pattern, TransitNetwork } from './types';

export interface StopServiceEntry {
  routeKey: string;
  operatorId: string;
  routeName: string;
  mode: ModeId;
  /** Peak trips per hour. */
  tph: number;
  /** Trips per day. */
  tpd: number;
  /** Peak riders per hour: tph × vehicle capacity × cars. */
  cap: number;
}
export type StopService = StopServiceEntry[][];
export type StopClass = 'regional-rail' | 'rail' | 'bus';

export function routeKey(p: Pick<Pattern, 'operatorId' | 'routeId' | 'direction'>): string {
  return `${p.operatorId}:${p.routeId}:${p.direction}`;
}

export function stopService(net: TransitNetwork): StopService {
  const out: StopService = net.stops.map(() => []);
  for (const p of net.patterns) {
    const key = routeKey(p);
    const perTrip = net.vehicles[p.vehicle].capacity * p.cars;
    for (const s of p.stops) {
      const list = out[s.stop];
      const e = list.find((x) => x.routeKey === key);
      if (e) {
        e.tph += s.tph;
        e.tpd += s.tpd;
        e.cap += s.tph * perTrip;
      } else {
        list.push({
          routeKey: key,
          operatorId: p.operatorId,
          routeName: p.routeName,
          mode: p.mode,
          tph: s.tph,
          tpd: s.tpd,
          cap: s.tph * perTrip
        });
      }
    }
  }
  return out;
}

export function stopCapacity(net: TransitNetwork, service = stopService(net)): Float64Array {
  const out = new Float64Array(net.stops.length);
  service.forEach((list, i) => {
    for (const e of list) out[i] += e.cap;
  });
  return out;
}

const REGIONAL = new Set<ModeId>(['heavy-rail', 'commuter-rail']);
const RAIL = new Set<ModeId>(['light-rail', 'streetcar']);

export function stopClass(entries: readonly { mode: ModeId }[]): StopClass {
  if (entries.some((e) => REGIONAL.has(e.mode))) return 'regional-rail';
  if (entries.some((e) => RAIL.has(e.mode))) return 'rail';
  return 'bus';
}

/**
 * SB 79 tier, estimated (spec §5.2). Commuter trains/day are counted over the whole station
 * (every stop sharing the stop's stationId), because Caltrain splits directions by platform.
 */
export function sb79Tier(
  net: TransitNetwork,
  stop: number,
  service = stopService(net)
): 1 | 2 | null {
  const station = net.stops[stop].stationId;
  const members =
    station === null
      ? [stop]
      : net.stops.flatMap((s, i) => (s.stationId === station ? [i] : []));
  const entries = members.flatMap((i) => service[i]);
  if (entries.some((e) => e.mode === 'heavy-rail')) return 1;
  const commuterPerDay = entries
    .filter((e) => e.mode === 'commuter-rail')
    .reduce((n, e) => n + e.tpd, 0);
  if (commuterPerDay >= 72) return 1;
  if (entries.some((e) => RAIL.has(e.mode)) || commuterPerDay >= 48) return 2;
  return null;
}
```

Create `src/lib/transit/index.ts`:

```ts
export * from './types';
export * from './service';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project server src/lib/transit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transit
git commit -m "feat(transit): add stop service, capacity, class and SB 79 tier" -m "sb79Tier counts commuter trains per station, since Caltrain splits directions by platform." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Access grid, legend bins and the budget bench

**Files:**
- Create: `src/lib/transit/grid.ts`, `src/lib/transit/legend.ts`
- Modify: `src/lib/transit/index.ts`
- Test: `src/lib/transit/grid.spec.ts`, `src/lib/transit/legend.spec.ts`, `src/lib/transit/grid.bench.spec.ts`

**Spec correction:** §5.3 writes `cap(r, s) = tph(r, s) · vehicleCapacity(mode(r))`. That predates the vehicle and consist table. This plan uses `StopServiceEntry.cap` (tph × vehicle capacity × cars), consistent with §5.2.

**Interfaces:**
- Consumes: `stopService`, `StopService` (Task 6); `project`, `LNG0`, `LAT0`, `M_PER_DEG_LNG`, `M_PER_DEG_LAT` from `$lib/plan/geometry`; `kdbush`.
- Produces:

```ts
export interface TransitParams { radiusM: number; fullM: number; gridSizeM: number }
export const DEFAULT_TRANSIT_PARAMS: TransitParams; // { radiusM: 800, fullM: 200, gridSizeM: 100 }
export interface AccessGrid { x0: number; y0: number; sizeM: number; cols: number; rows: number; values: Float32Array } // row-major, cell (c, r) spans [x0 + c·size, x0 + (c+1)·size] in projected metres
export function walkWeight(d: number, p?: TransitParams): number;
export function buildAccessGrid(net: TransitNetwork, params?: TransitParams, service?: StopService): AccessGrid;
export function accessAt(grid: AccessGrid, lngLat: [number, number]): number;
export function gridLngLat(grid: AccessGrid, x: number, y: number): [number, number]; // projected metres -> lng/lat
// legend.ts
export const ACCESS_BINS: readonly [200, 1000, 3000, 10000, 30000];
export type AccessBin = 0 | 1 | 2 | 3 | 4 | 5;
export function accessBin(v: number): AccessBin;
export const ACCESS_LEGEND: readonly string[]; // 5 labels, bin 1..5
export const ACCESS_CAPTION: string;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/transit/grid.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TransitNetwork } from '$lib/data/transit';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { DEFAULT_TRANSIT_PARAMS, accessAt, buildAccessGrid, walkWeight } from './grid';

const at = (x: number, y: number): [number, number] => [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];
const V = { bus: { label: 'b', seats: 30, capacity: 44 } };
function line(stops: [number, number][], tph = 10): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: V,
    stops: stops.map(([x, y], i) => ({ id: `s${i}`, name: `s${i}`, lngLat: at(x, y), stationId: null, placeId: `s${i}` })),
    patterns: [
      {
        id: 'p',
        operatorId: 'muni',
        routeId: '1',
        routeName: '1',
        mode: 'bus',
        direction: 0,
        vehicle: 'bus',
        cars: 1,
        stops: stops.map((_, i) => ({ stop: i, tph, tpd: tph * 18 }))
      }
    ]
  };
}

describe('walkWeight', () => {
  it('is 1 to d0, linear to 0 at R, 0 beyond', () => {
    expect(walkWeight(0)).toBe(1);
    expect(walkWeight(200)).toBe(1);
    expect(walkWeight(500)).toBeCloseTo(0.5);
    expect(walkWeight(800)).toBe(0);
    expect(walkWeight(900)).toBe(0);
  });
});

describe('buildAccessGrid', () => {
  it('counts a route-direction once, at its best stop, however many stops are near', () => {
    const one = buildAccessGrid(line([[0, 0]]));
    const six = buildAccessGrid(line([[0, 0], [60, 0], [120, 0], [180, 0], [240, 0], [300, 0]]));
    expect(accessAt(one, at(0, 0))).toBeCloseTo(440, 0);
    expect(accessAt(six, at(150, 0))).toBeCloseTo(440, 0);
  });

  it('decays with distance and is 0 beyond R', () => {
    const g = buildAccessGrid(line([[0, 0]]));
    expect(accessAt(g, at(500, 0))).toBeGreaterThan(150);
    expect(accessAt(g, at(500, 0))).toBeLessThan(290);
    expect(accessAt(g, at(2000, 0))).toBe(0);
  });

  it('sums different route-directions', () => {
    const n = line([[0, 0]]);
    n.patterns.push({ ...n.patterns[0], id: 'q', direction: 1 });
    expect(accessAt(buildAccessGrid(n), at(0, 0))).toBeCloseTo(880, 0);
  });

  it('changes when the network is edited (raise a route frequency)', () => {
    const n = line([[0, 0]]);
    const before = accessAt(buildAccessGrid(n), at(0, 0));
    n.patterns[0] = { ...n.patterns[0], stops: [{ stop: 0, tph: 20, tpd: 360 }] };
    expect(accessAt(buildAccessGrid(n), at(0, 0))).toBeCloseTo(2 * before, 0);
  });

  it('covers the stops plus R and is empty for an empty network', () => {
    const g = buildAccessGrid(line([[0, 0]]));
    expect(g.cols * g.sizeM).toBeGreaterThanOrEqual(2 * DEFAULT_TRANSIT_PARAMS.radiusM);
    const e = buildAccessGrid({ ...line([]), patterns: [] });
    expect(e.values.length).toBe(0);
    expect(accessAt(e, at(0, 0))).toBe(0);
  });
});
```

Create `src/lib/transit/legend.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ACCESS_BINS, ACCESS_LEGEND, accessBin } from './legend';

describe('access legend', () => {
  it('bins on 200 / 1k / 3k / 10k / 30k, below 200 is bin 0 (transparent)', () => {
    expect(ACCESS_BINS).toEqual([200, 1000, 3000, 10000, 30000]);
    expect([0, 199, 200, 999, 1000, 2999, 3000, 9999, 10000, 29999, 30000, 1e6].map(accessBin)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5
    ]);
    expect(ACCESS_LEGEND).toHaveLength(5);
  });
});
```

Create `src/lib/transit/grid.bench.spec.ts`:

```ts
// Budget (transit spec §5.3): buildAccessGrid ≤ 100 ms for an SF-sized network. Synthetic:
// 3,500 stops over 12 km × 12 km, 600 route-directions of 30 stops.
import { describe, expect, it } from 'vitest';
import type { TransitNetwork } from '$lib/data/transit';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { buildAccessGrid } from './grid';
import { stopService } from './service';

function synth(): TransitNetwork {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const stops = Array.from({ length: 3500 }, (_, i) => ({
    id: `s${i}`,
    name: `s${i}`,
    lngLat: [LNG0 + (rnd() * 12000 - 6000) / M_PER_DEG_LNG, LAT0 + (rnd() * 12000 - 6000) / M_PER_DEG_LAT] as [number, number],
    stationId: null,
    placeId: `s${i}`
  }));
  const patterns = Array.from({ length: 600 }, (_, k) => ({
    id: `p${k}`,
    operatorId: 'muni',
    routeId: `${k >> 1}`,
    routeName: `${k >> 1}`,
    mode: 'bus' as const,
    direction: (k & 1) as 0 | 1,
    vehicle: 'bus',
    cars: 1,
    stops: Array.from({ length: 30 }, () => ({ stop: Math.floor(rnd() * 3500), tph: 6, tpd: 100 }))
  }));
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [{ id: 'muni', label: 'Muni', serviceDate: '2026-10-13' }],
    vehicles: { bus: { label: 'b', seats: 30, capacity: 44 } },
    stops,
    patterns
  };
}

describe('buildAccessGrid budget', () => {
  it('builds an SF-sized grid in ≤ 100 ms (best of 3)', () => {
    const net = synth();
    const service = stopService(net);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      buildAccessGrid(net, undefined, service);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/transit`
Expected: FAIL, "Cannot find module './grid'".

- [ ] **Step 3: Implement**

Create `src/lib/transit/legend.ts`:

```ts
// Access-surface bins (transit spec §6.1), shared by the map layer and the View menu legend.
export const ACCESS_BINS = [200, 1000, 3000, 10000, 30000] as const;
export type AccessBin = 0 | 1 | 2 | 3 | 4 | 5;

export function accessBin(v: number): AccessBin {
  let b = 0;
  for (const t of ACCESS_BINS) if (v >= t) b++;
  return b as AccessBin;
}

export const ACCESS_LEGEND = ['< 1k', '1k–3k', '3k–10k', '10k–30k', '30k+'] as const;
export const ACCESS_CAPTION =
  'Estimated weekday 7–9 am capacity, riders per hour. Existing service only.';
```

Create `src/lib/transit/grid.ts`:

```ts
// Area-capacity surface (transit spec §5.3): peak riders/hr reachable on foot, each
// route-direction counted once at its best stop. Straight-line distance in plan-model metres.
import KDBush from 'kdbush';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG, project } from '$lib/plan/geometry';
import { stopService, type StopService } from './service';
import type { TransitNetwork } from './types';

export interface TransitParams {
  /** Walk radius R, metres. */
  radiusM: number;
  /** Full-weight distance d0, metres. */
  fullM: number;
  gridSizeM: number;
}
export const DEFAULT_TRANSIT_PARAMS: TransitParams = { radiusM: 800, fullM: 200, gridSizeM: 100 };

export interface AccessGrid {
  x0: number;
  y0: number;
  sizeM: number;
  cols: number;
  rows: number;
  /** Row-major (r * cols + c), value at the cell centre. */
  values: Float32Array;
}

export function walkWeight(d: number, p: TransitParams = DEFAULT_TRANSIT_PARAMS): number {
  if (d <= p.fullM) return 1;
  if (d >= p.radiusM) return 0;
  return 1 - (d - p.fullM) / (p.radiusM - p.fullM);
}

export function gridLngLat(_grid: AccessGrid, x: number, y: number): [number, number] {
  return [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];
}

export function buildAccessGrid(
  net: TransitNetwork,
  params: TransitParams = DEFAULT_TRANSIT_PARAMS,
  service: StopService = stopService(net)
): AccessGrid {
  const n = net.stops.length;
  const size = params.gridSizeM;
  if (n === 0) return { x0: 0, y0: 0, sizeM: size, cols: 0, rows: 0, values: new Float32Array(0) };
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const [x, y] = project(net.stops[i].lngLat[0], net.stops[i].lngLat[1]);
    xs[i] = x;
    ys[i] = y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const R = params.radiusM;
  const x0 = Math.floor((minX - R) / size) * size;
  const y0 = Math.floor((minY - R) / size) * size;
  const cols = Math.ceil((maxX + R - x0) / size);
  const rows = Math.ceil((maxY + R - y0) / size);

  const keyIx = new Map<string, number>();
  const keys: Int32Array[] = [];
  const caps: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const list = service[i];
    const k = new Int32Array(list.length);
    const c = new Float64Array(list.length);
    list.forEach((e, j) => {
      let ix = keyIx.get(e.routeKey);
      if (ix === undefined) keyIx.set(e.routeKey, (ix = keyIx.size));
      k[j] = ix;
      c[j] = e.cap;
    });
    keys.push(k);
    caps.push(c);
  }

  const tree = new KDBush(n);
  for (let i = 0; i < n; i++) tree.add(xs[i], ys[i]);
  tree.finish();
  const best = new Float64Array(keyIx.size);
  const touched: number[] = [];
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const cy = y0 + (r + 0.5) * size;
    for (let c = 0; c < cols; c++) {
      const cx = x0 + (c + 0.5) * size;
      for (const id of tree.within(cx, cy, R)) {
        const w = walkWeight(Math.hypot(xs[id] - cx, ys[id] - cy), params);
        if (w <= 0) continue;
        const k = keys[id];
        const cap = caps[id];
        for (let j = 0; j < k.length; j++) {
          const v = cap[j] * w;
          if (v <= 0) continue;
          if (best[k[j]] === 0) touched.push(k[j]);
          if (v > best[k[j]]) best[k[j]] = v;
        }
      }
      let sum = 0;
      for (const k of touched) {
        sum += best[k];
        best[k] = 0;
      }
      touched.length = 0;
      values[r * cols + c] = sum;
    }
  }
  return { x0, y0, sizeM: size, cols, rows, values };
}

/** Bilinear between cell centres; 0 outside the grid. */
export function accessAt(grid: AccessGrid, [lng, lat]: [number, number]): number {
  if (grid.cols === 0) return 0;
  const [x, y] = project(lng, lat);
  const fx = (x - grid.x0) / grid.sizeM - 0.5;
  const fy = (y - grid.y0) / grid.sizeM - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > grid.cols - 0.5 || fy > grid.rows - 0.5) return 0;
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(fy)));
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const v = (r: number, c: number) => grid.values[r * grid.cols + c];
  return (
    (v(r0, c0) * (1 - tx) + v(r0, c1) * tx) * (1 - ty) + (v(r1, c0) * (1 - tx) + v(r1, c1) * tx) * ty
  );
}
```

Append to `src/lib/transit/index.ts`:

```ts
export * from './grid';
export * from './legend';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project server src/lib/transit`
Expected: PASS, including the bench. If the bench exceeds 100 ms, record the measured time in the task report. Per spec §5.3, the fallback is moving the call into a dedicated worker in Task 10. Do not raise the budget.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transit
git commit -m "feat(transit): add area-capacity grid and legend bins" -m "Uses StopServiceEntry.cap (tph × vehicle capacity × cars), correcting spec §5.3's mode-capacity formula to match §5.2." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Palette tokens, style layers, GeoJSON builders and the stop tooltip

**Files:**
- Modify: `src/lib/map/palette.ts` (`TokenName`, `TOKENS`), `src/lib/map/palette.spec.ts`
- Modify: `src/lib/map/style.ts` (constants, `transitAccessLayer`, `transitStopLayers`, `buildStyle`), `src/lib/map/style.spec.ts`
- Create: `src/lib/map/transit-layer.ts`; Test: `src/lib/map/transit-layer.spec.ts`
- Modify: `src/lib/map/tooltip.ts` (`TooltipHit` gains `stop`), `src/lib/map/tooltip.spec.ts`

**Deviation:** the spec's single `transit-stops` circle layer becomes three layers, `transit-stops-bus` (minzoom 15), `transit-stops-rail` (minzoom 13) and `transit-stops-regional`. Each uses a class filter, which gives the zoom-dependent filtering in spec §6.1 without zoom expressions in filters.

**Interfaces:**
- Consumes: `stopService`, `stopCapacity`, `stopClass`, `sb79Tier`, `StopService`, `AccessGrid`, `gridLngLat`, `accessBin` (Tasks 6–7), `decodeTransit` (Task 1).
- Produces:

```ts
// style.ts
export const TRANSIT_ACCESS_SOURCE = 'transit-access';
export const TRANSIT_STOPS_SOURCE = 'transit-stops';
export const TRANSIT_ACCESS_LAYER = 'transit-access';
export const TRANSIT_STOP_LAYERS = ['transit-stops-bus', 'transit-stops-rail', 'transit-stops-regional'] as const;
// transit-layer.ts
export interface TransitView { net: TransitNetwork; service: StopService; cap: Float64Array }
export function transitView(net: TransitNetwork): TransitView;
export function loadTransitNetwork(url: string, fetchFn?: (u: string) => Promise<Response>): Promise<TransitNetwork>;
export function stopsCollection(t: TransitView): FeatureCollection<Point, { i: number; cls: StopClass; lc: number; name: string }>;
export function accessCollection(grid: AccessGrid): FeatureCollection<Polygon, { b: number }>;
export function stopTooltipLines(t: TransitView, i: number): [string, string];
// tooltip.ts
export type TooltipHit = ... | { kind: 'stop'; lines: [string, string] };
```

- [ ] **Step 1: Write the failing tests**

In `src/lib/map/palette.spec.ts`, inside the per-theme loop, add:

```ts
    it(`${theme}: the access ramp's contrast with land strictly increases`, () => {
      const cs = [1, 2, 3, 4, 5].map((k) =>
        contrast(TOKENS[theme][`transit-access-${k}` as const], TOKENS[theme].land)
      );
      for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    });
    it(`${theme}: stop classes are distinct (ΔE2000 ≥ 20)`, () => {
      const ids = ['transit-bus', 'transit-rail', 'transit-regional'] as const;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          expect(de(parse(TOKENS[theme][ids[i]])!, parse(TOKENS[theme][ids[j]])!)).toBeGreaterThanOrEqual(20);
    });
```

In `src/lib/map/style.spec.ts`, add a describe block. Read the top of the file for how it gets `manifest` (`m`); `withTransit` below is a local clone:

```ts
describe('transit layers', () => {
  const withTransit = { ...manifest, transit: `/data/${manifest.datasetVersion}/transit.json` };
  it('are absent when the manifest has no transit', () => {
    const s = buildStyle(manifest, 'light');
    expect(Object.keys(s.sources)).not.toContain(TRANSIT_STOPS_SOURCE);
    expect(s.layers.some((l) => l.id.startsWith('transit-'))).toBe(false);
  });
  it('put the access fill under buildings and the stops above the labels, hidden until applied', () => {
    const s = buildStyle(withTransit, 'light');
    const ids = s.layers.map((l) => l.id);
    expect(ids.indexOf(TRANSIT_ACCESS_LAYER)).toBeLessThan(ids.indexOf(BUILDINGS_LAYER));
    const lastLabel = ids.lastIndexOf(s.layers.filter((l) => l.type === 'symbol').at(-1)!.id);
    for (const id of TRANSIT_STOP_LAYERS) expect(ids.indexOf(id)).toBeGreaterThan(lastLabel);
    expect(ids.at(-1)).toBe(OVERLAY_ANCHOR);
    for (const id of [TRANSIT_ACCESS_LAYER, ...TRANSIT_STOP_LAYERS]) {
      const l = s.layers.find((x) => x.id === id) as { layout?: { visibility?: string } };
      expect(l.layout?.visibility).toBe('none');
    }
    expect(firstSymbolLayerId(s)).toBe(firstSymbolLayerId(buildStyle(manifest, 'light')));
  });
  it('theme-diff the transit paint', () => {
    const d = themePaintDiff(withTransit);
    expect(d.dark.some(([id]) => id === TRANSIT_ACCESS_LAYER)).toBe(true);
    expect(d.dark.some(([id]) => id === 'transit-stops-bus')).toBe(true);
  });
});
```

Import the new constants, plus `OVERLAY_ANCHOR` and `BUILDINGS_LAYER` (export `OVERLAY_ANCHOR` from `style.ts` if it is not exported).

Create `src/lib/map/transit-layer.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { encodeTransit } from '$lib/data/transit-codec';
import { buildAccessGrid } from '$lib/transit';
import { net } from '$lib/transit/test-network';
import {
  accessCollection,
  loadTransitNetwork,
  stopTooltipLines,
  stopsCollection,
  transitView
} from './transit-layer';

describe('transit-layer', () => {
  it('builds one point per stop with index, class and log capacity', () => {
    const fc = stopsCollection(transitView(net()));
    expect(fc.features).toHaveLength(5);
    expect(fc.features[4].properties).toMatchObject({ i: 4, cls: 'regional-rail' });
    expect(fc.features[4].properties.lc).toBeCloseTo(Math.log10(4280), 5);
  });

  it('merges same-bin runs per row into rectangles, skipping bin 0', () => {
    const fc = accessCollection(buildAccessGrid(net()));
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) {
      expect(f.properties.b).toBeGreaterThanOrEqual(1);
      expect(f.geometry.coordinates[0]).toHaveLength(5);
    }
  });

  it('describes a stop: name, routes by operator, capacity, estimated tier', () => {
    const t = transitView(net());
    expect(stopTooltipLines(t, 4)).toEqual(['s4', 'bart Red · ~4,280 riders/hr at peak · SB 79 tier 1 (est.)']);
    expect(stopTooltipLines(t, 0)[1]).toBe('Muni 22 · ~350 riders/hr at peak');
  });

  it('fetches and decodes, and rejects on HTTP errors', async () => {
    const ok = vi.fn(async () => new Response(encodeTransit(net())));
    await expect(loadTransitNetwork('/data/v/transit.json', ok)).resolves.toMatchObject({
      stops: expect.any(Array)
    });
    const bad = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadTransitNetwork('/x', bad)).rejects.toThrow(/HTTP 404/);
  });
});
```

The network from Task 6 lists only `muni` among its operators, so BART routes fall back to the raw `operatorId` (`bart`). That is why the expected string reads `bart Red`. The test pins that fallback.

In `src/lib/map/tooltip.spec.ts`, add:

```ts
  it('passes stop lines through', () => {
    expect(tooltipLines({ kind: 'stop', lines: ['Powell', 'BART Red'] })).toEqual(['Powell', 'BART Red']);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/map/palette.spec.ts src/lib/map/style.spec.ts src/lib/map/transit-layer.spec.ts src/lib/map/tooltip.spec.ts`
Expected: FAIL (missing tokens, constants, module and tooltip kind).

- [ ] **Step 3: Implement the tokens**

In `src/lib/map/palette.ts`, extend `TokenName`:

```ts
  | `gen-${TypologyId}`
  | `transit-access-${1 | 2 | 3 | 4 | 5}`
  | 'transit-bus'
  | 'transit-rail'
  | 'transit-regional'
  | 'transit-stroke';
```

Add to `TOKENS.light`:

```ts
    'transit-access-1': '#E4EEF3',
    'transit-access-2': '#BED7E3',
    'transit-access-3': '#8DB9CF',
    'transit-access-4': '#5596B5',
    'transit-access-5': '#2C6E8F',
    'transit-bus': '#4A6572',
    'transit-rail': '#7B3FA0',
    'transit-regional': '#1F5FBF',
    'transit-stroke': '#FFFFFF'
```

Add to `TOKENS.dark`:

```ts
    'transit-access-1': '#1E2A31',
    'transit-access-2': '#24414F',
    'transit-access-3': '#2D5D72',
    'transit-access-4': '#3A7F9C',
    'transit-access-5': '#5BA6C6',
    'transit-bus': '#9DB4BF',
    'transit-rail': '#C59BE0',
    'transit-regional': '#7FB2FF',
    'transit-stroke': '#111214'
```

The tokens become `--map-transit-*` CSS vars automatically, via SimMap's `rootStyle`.

- [ ] **Step 4: Implement the style layers**

In `src/lib/map/style.ts`, add (export `OVERLAY_ANCHOR` if it is a private `const`):

```ts
export const TRANSIT_ACCESS_SOURCE = 'transit-access';
export const TRANSIT_STOPS_SOURCE = 'transit-stops';
export const TRANSIT_ACCESS_LAYER = 'transit-access';
export const TRANSIT_STOP_LAYERS = [
  'transit-stops-bus',
  'transit-stops-rail',
  'transit-stops-regional'
] as const;
const EMPTY = { type: 'FeatureCollection', features: [] } as const;

/** Transit spec §6.1: binned fill under existing buildings; hidden until SimMap applies the view. */
export function transitAccessLayer(theme: Theme): LayerSpecification {
  const t = TOKENS[theme];
  return {
    id: TRANSIT_ACCESS_LAYER,
    type: 'fill',
    source: TRANSIT_ACCESS_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': [
        'match',
        ['get', 'b'],
        1,
        t['transit-access-1'],
        2,
        t['transit-access-2'],
        3,
        t['transit-access-3'],
        4,
        t['transit-access-4'],
        5,
        t['transit-access-5'],
        'rgba(0,0,0,0)'
      ],
      'fill-opacity': 0.45,
      'fill-antialias': false
    }
  } as unknown as LayerSpecification;
}

// Radius by log10(capacity): 100 riders/hr -> 2.5 px, ~30k -> 7 px at z11; ×3 by z16.
const STOP_R = ['interpolate', ['linear'], ['get', 'lc'], 2, 2.5, 4.5, 7];
const STOP_LAYER: Record<
  (typeof TRANSIT_STOP_LAYERS)[number],
  { cls: string; minzoom?: number; token: 'transit-bus' | 'transit-rail' | 'transit-regional' }
> = {
  'transit-stops-bus': { cls: 'bus', minzoom: 15, token: 'transit-bus' },
  'transit-stops-rail': { cls: 'rail', minzoom: 13, token: 'transit-rail' },
  'transit-stops-regional': { cls: 'regional-rail', token: 'transit-regional' }
};

/** Bus at z15+, rail at z13+, regional rail always (spec §6.1); on top of the labels. */
export function transitStopLayers(theme: Theme): LayerSpecification[] {
  const t = TOKENS[theme];
  return TRANSIT_STOP_LAYERS.map((id) => {
    const { cls, minzoom, token } = STOP_LAYER[id];
    return {
      id,
      type: 'circle',
      source: TRANSIT_STOPS_SOURCE,
      ...(minzoom !== undefined ? { minzoom } : {}),
      filter: ['==', ['get', 'cls'], cls],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': t[token],
        'circle-stroke-color': t['transit-stroke'],
        'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, STOP_R, 16, ['*', 3, STOP_R]]
      }
    } as unknown as LayerSpecification;
  });
}
```

In `buildStyle`, extend the stack comment to "base, transit-access, existing-buildings, chunk layers, labels, transit stops, overlay-anchor". Then:

```ts
  const transit = manifest.transit !== undefined;
  return {
    version: 8,
    glyphs: manifest.glyphs,
    sources: {
      protomaps: { type: 'vector', url: 'pmtiles://' + manifest.basemapTiles },
      [BUILDINGS_SOURCE]: buildingsSource(manifest),
      [CHUNK_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      ...(transit
        ? {
            [TRANSIT_ACCESS_SOURCE]: { type: 'geojson', data: EMPTY },
            [TRANSIT_STOPS_SOURCE]: { type: 'geojson', data: EMPTY }
          }
        : {})
    },
    layers: [
      ...base,
      ...(transit ? [transitAccessLayer(theme)] : []),
      existingBuildingsLayer(theme),
      ...chunkLayers(theme),
      ...labels,
      ...(transit ? transitStopLayers(theme) : []),
      { id: OVERLAY_ANCHOR, type: 'background', layout: { visibility: 'none' } }
    ]
  } as StyleSpecification;
```

- [ ] **Step 5: Implement `transit-layer.ts` and the tooltip kind**

Create `src/lib/map/transit-layer.ts`:

```ts
// Transit network -> map data (transit spec §6.1). Pure apart from the fetch.
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { decodeTransit } from '$lib/data/transit-codec';
import {
  accessBin,
  gridLngLat,
  sb79Tier,
  stopCapacity,
  stopClass,
  stopService,
  type AccessGrid,
  type StopClass,
  type StopService,
  type TransitNetwork
} from '$lib/transit';

export interface TransitView {
  net: TransitNetwork;
  service: StopService;
  cap: Float64Array;
}

export function transitView(net: TransitNetwork): TransitView {
  const service = stopService(net);
  return { net, service, cap: stopCapacity(net, service) };
}

export async function loadTransitNetwork(
  url: string,
  fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)
): Promise<TransitNetwork> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`transit ${url}: HTTP ${res.status}`);
  return decodeTransit(await res.text());
}

export function stopsCollection(
  t: TransitView
): FeatureCollection<Point, { i: number; cls: StopClass; lc: number; name: string }> {
  return {
    type: 'FeatureCollection',
    features: t.net.stops.map((s, i) => ({
      type: 'Feature',
      properties: {
        i,
        cls: stopClass(t.service[i]),
        lc: Math.log10(Math.max(1, t.cap[i])),
        name: s.name
      },
      geometry: { type: 'Point', coordinates: s.lngLat }
    }))
  };
}

/** One rectangle per run of equal non-zero bins along a grid row. */
export function accessCollection(grid: AccessGrid): FeatureCollection<Polygon, { b: number }> {
  const features: Feature<Polygon, { b: number }>[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const y0 = grid.y0 + r * grid.sizeM;
    const y1 = y0 + grid.sizeM;
    let c = 0;
    while (c < grid.cols) {
      const b = accessBin(grid.values[r * grid.cols + c]);
      let e = c + 1;
      while (e < grid.cols && accessBin(grid.values[r * grid.cols + e]) === b) e++;
      if (b > 0) {
        const x0 = grid.x0 + c * grid.sizeM;
        const x1 = grid.x0 + e * grid.sizeM;
        const ring = [
          gridLngLat(grid, x0, y0),
          gridLngLat(grid, x1, y0),
          gridLngLat(grid, x1, y1),
          gridLngLat(grid, x0, y1),
          gridLngLat(grid, x0, y0)
        ];
        features.push({ type: 'Feature', properties: { b }, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
      c = e;
    }
  }
  return { type: 'FeatureCollection', features };
}

const nf = new Intl.NumberFormat('en-US');
const natural = new Intl.Collator('en', { numeric: true }).compare;

export function stopTooltipLines(t: TransitView, i: number): [string, string] {
  const labels = new Map(t.net.operators.map((o) => [o.id, o.label]));
  const byOp = new Map<string, Set<string>>();
  for (const e of t.service[i]) {
    const op = labels.get(e.operatorId) ?? e.operatorId;
    if (!byOp.has(op)) byOp.set(op, new Set());
    byOp.get(op)!.add(e.routeName);
  }
  const parts = [...byOp].map(([op, names]) => `${op} ${[...names].sort(natural).join(', ')}`);
  parts.push(`~${nf.format(Math.round(t.cap[i] / 10) * 10)} riders/hr at peak`);
  const tier = sb79Tier(t.net, i, t.service);
  if (tier !== null) parts.push(`SB 79 tier ${tier} (est.)`);
  return [t.net.stops[i].name, parts.join(' · ')];
}
```

`geojson` types are already a transitive dependency; `pick.ts` imports them. If `pick.ts` imports types from elsewhere, mirror its import.

In `src/lib/map/tooltip.ts`, extend `TooltipHit`:

```ts
  | { kind: 'stop'; lines: [string, string] };
```

At the top of `tooltipLines`:

```ts
  if (hit.kind === 'stop') return hit.lines;
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest --run --project server src/lib/map src/lib/transit && npm run check`
Expected: PASS. Also, `svelte-check` reports no errors. If some code switches exhaustively on `TooltipHit.kind`, the check names it; add the `'stop'` case there.

- [ ] **Step 7: Commit**

```bash
git add src/lib/map
git commit -m "feat(map): add transit tokens, layers, GeoJSON builders and stop tooltip" -m "Stops are three class-filtered circle layers (bus z15+, rail z13+, regional always) instead of one, to get spec §6.1's zoom filtering without zoom-in-filter expressions." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: View prefs and the View menu

**Files:**
- Create: `src/lib/view/prefs.ts`; Test: `src/lib/view/prefs.spec.ts`
- Create: `src/lib/view/ViewMenu.svelte`; Test: `src/lib/view/ViewMenu.svelte.spec.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 8), `ACCESS_LEGEND`, `ACCESS_CAPTION` (Task 7).
- Produces:

```ts
export interface ViewPrefs { transitStops: boolean; transitAccess: boolean }
export const VIEW_KEY = 'sfhousing:view';
export const DEFAULT_VIEW: ViewPrefs; // both true
export function readViewPrefs(storage?: Pick<Storage, 'getItem'> | null): ViewPrefs;
export function writeViewPrefs(v: ViewPrefs, storage?: Pick<Storage, 'setItem'> | null): void;
// ViewMenu.svelte props: { view: ViewPrefs; onchange(v: ViewPrefs): void }
```

- [ ] **Step 1: Write the failing prefs tests**

Create `src/lib/view/prefs.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, VIEW_KEY, readViewPrefs, writeViewPrefs } from './prefs';

const mem = (v: string | null) => ({ getItem: (k: string) => (k === VIEW_KEY ? v : null) });

describe('view prefs', () => {
  it('defaults to both layers on', () => {
    expect(DEFAULT_VIEW).toEqual({ transitStops: true, transitAccess: true });
    expect(readViewPrefs(mem(null))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(null)).toEqual(DEFAULT_VIEW);
  });

  it('reads stored booleans and falls back per field on junk', () => {
    expect(readViewPrefs(mem('{"transitStops":false,"transitAccess":true}'))).toEqual({
      transitStops: false,
      transitAccess: true
    });
    expect(readViewPrefs(mem('{"transitStops":3}'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('"nope"'))).toEqual(DEFAULT_VIEW);
    expect(readViewPrefs(mem('{'))).toEqual(DEFAULT_VIEW);
  });

  it('never throws when storage throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      }
    };
    expect(readViewPrefs(boom)).toEqual(DEFAULT_VIEW);
    expect(() => writeViewPrefs(DEFAULT_VIEW, boom)).not.toThrow();
  });

  it('writes exactly the two fields', () => {
    let saved = '';
    writeViewPrefs({ transitStops: false, transitAccess: true, extra: 1 } as never, {
      setItem: (_k, v) => (saved = v)
    });
    expect(JSON.parse(saved)).toEqual({ transitStops: false, transitAccess: true });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/view/prefs.spec.ts`
Expected: FAIL, "Cannot find module './prefs'".

- [ ] **Step 3: Implement prefs**

Create `src/lib/view/prefs.ts`, following the guarded pattern of `src/lib/brush/settings.ts`:

```ts
// Per-viewer map layer toggles (transit spec T6, §6.3). Best-effort persistence.

export interface ViewPrefs {
  transitStops: boolean;
  transitAccess: boolean;
}

export const VIEW_KEY = 'sfhousing:view';
export const DEFAULT_VIEW: ViewPrefs = { transitStops: true, transitAccess: true };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readViewPrefs(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage()
): ViewPrefs {
  try {
    const raw = storage?.getItem(VIEW_KEY);
    if (!raw) return { ...DEFAULT_VIEW };
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
    return {
      transitStops: bool(v?.transitStops, DEFAULT_VIEW.transitStops),
      transitAccess: bool(v?.transitAccess, DEFAULT_VIEW.transitAccess)
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export function writeViewPrefs(
  v: ViewPrefs,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage()
): void {
  try {
    storage?.setItem(
      VIEW_KEY,
      JSON.stringify({ transitStops: v.transitStops, transitAccess: v.transitAccess })
    );
  } catch {
    // storage unavailable or full: persistence is best-effort
  }
}
```

(`readViewPrefs(mem('"nope"'))`: `v` is a string, so `v?.transitStops` is undefined and the result is the defaults, as intended.)

- [ ] **Step 4: Write the failing menu test**

Create `src/lib/view/ViewMenu.svelte.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import ViewMenu from './ViewMenu.svelte';
import { DEFAULT_VIEW } from './prefs';

const button = () => page.getByRole('button', { name: 'View' });

describe('ViewMenu', () => {
  it('is a disclosure: toggles aria-expanded, Esc closes and returns focus', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, onchange: vi.fn() } });
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
    await button().click();
    await expect.element(button()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('checkbox', { name: 'Transit stops' })).toBeChecked();
    await userEvent.keyboard('{Escape}');
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(button()).toHaveFocus();
  });

  it('reports each toggle as a whole new prefs value', async () => {
    const onchange = vi.fn();
    render(ViewMenu, { props: { view: DEFAULT_VIEW, onchange } });
    await button().click();
    await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).click();
    expect(onchange).toHaveBeenCalledWith({ transitStops: true, transitAccess: false });
  });

  it('shows both legends and the caption', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, onchange: vi.fn() } });
    await button().click();
    await expect.element(page.getByText('BART / Caltrain')).toBeVisible();
    await expect.element(page.getByText('30k+')).toBeVisible();
    await expect
      .element(page.getByText('Estimated weekday 7–9 am capacity, riders per hour. Existing service only.'))
      .toBeVisible();
  });

  it('closes on an outside pointer down without stealing focus', async () => {
    render(ViewMenu, { props: { view: DEFAULT_VIEW, onchange: vi.fn() } });
    await button().click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect.element(button()).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest --run --project client src/lib/view/ViewMenu.svelte.spec.ts`
Expected: FAIL (component missing).

- [ ] **Step 6: Implement the menu**

Create `src/lib/view/ViewMenu.svelte`:

```svelte
<script lang="ts">
  // Header View menu (transit spec §6.3): a disclosure with one checkbox + legend per layer. A
  // list, so later layers add rows.
  import { TOKENS } from '$lib/map/palette';
  import { ACCESS_CAPTION, ACCESS_LEGEND } from '$lib/transit/legend';
  import type { ViewPrefs } from './prefs';

  interface Props {
    view: ViewPrefs;
    onchange(v: ViewPrefs): void;
  }
  let { view, onchange }: Props = $props();

  const id = $props.id();
  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  let dark = $state(false);
  const t = $derived(TOKENS[dark ? 'dark' : 'light']);

  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    dark = mq.matches;
    const on = (e: MediaQueryListEvent) => (dark = e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  const STOP_LEGEND = [
    ['transit-regional', 'BART / Caltrain'],
    ['transit-rail', 'Muni Metro / streetcar'],
    ['transit-bus', 'Bus / cable car']
  ] as const;
  const ACCESS_TOKENS = [
    'transit-access-1',
    'transit-access-2',
    'transit-access-3',
    'transit-access-4',
    'transit-access-5'
  ] as const;

  function close(refocus: boolean): void {
    open = false;
    if (refocus) button?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  }

  function onpointerdown(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (open && target && !panel?.contains(target) && !button?.contains(target)) close(false);
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<div class="relative">
  <button
    bind:this={button}
    type="button"
    aria-expanded={open}
    aria-controls="{id}-panel"
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    onclick={() => (open = !open)}>View</button
  >
  {#if open}
    <div
      bind:this={panel}
      id="{id}-panel"
      role="group"
      aria-label="Map layers"
      class="absolute top-full right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-gray-300 bg-white p-3 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-900"
    >
      <label class="flex min-h-6 items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={view.transitStops}
          onchange={(e) => onchange({ ...view, transitStops: e.currentTarget.checked })}
        />
        Transit stops
      </label>
      <ul class="mt-1 mb-3 space-y-1 pl-6" aria-label="Transit stops legend">
        {#each STOP_LEGEND as [token, label] (token)}
          <li class="flex items-center gap-2">
            <span aria-hidden="true" class="inline-block size-3 rounded-full" style="background: {t[token]}"></span>
            {label}
          </li>
        {/each}
      </ul>
      <label class="flex min-h-6 items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={view.transitAccess}
          onchange={(e) => onchange({ ...view, transitAccess: e.currentTarget.checked })}
        />
        Transit capacity within a 10-minute walk
      </label>
      <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6" aria-label="Transit capacity legend">
        {#each ACCESS_LEGEND as label, k (label)}
          <li class="flex items-center gap-1">
            <span aria-hidden="true" class="inline-block size-3" style="background: {t[ACCESS_TOKENS[k]]}"></span>
            {label}
          </li>
        {/each}
      </ul>
      <p class="mt-2 pl-6 text-xs text-gray-700 dark:text-gray-300">{ACCESS_CAPTION}</p>
    </div>
  {/if}
</div>
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest --run --project server src/lib/view && npx vitest --run --project client src/lib/view`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/view
git commit -m "feat(view): add view prefs and the View menu" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Wire transit into SimMap, BrushEditor and the page

**Files:**
- Modify: `src/lib/map/types.ts` (`SimMapProps`)
- Modify: `src/lib/map/SimMap.svelte` (props, `Live`, `onLoad`, `teardown`, `pickAt`, effect)
- Test: `src/lib/map/SimMap.transit.svelte.spec.ts`
- Modify: `src/lib/brush/BrushEditor.svelte` (`Props.view`, pass to SimMap)
- Modify: `src/routes/+page.svelte` (view state, menu in the header snippet, pass `view`)

**Interfaces:**
- Consumes: Task 8 (`TRANSIT_*`, `transitView`, `loadTransitNetwork`, `stopsCollection`, `accessCollection`, `stopTooltipLines`, `TransitView`); Task 7 (`buildAccessGrid`, `DEFAULT_TRANSIT_PARAMS`); Task 9 (`ViewPrefs`, `DEFAULT_VIEW`, `readViewPrefs`, `writeViewPrefs`, `ViewMenu`). After Task 4, fixture-0 has `transit.json`.
- Produces: `SimMapProps.view?: ViewPrefs` and `SimMapProps.fetchTransit?: (url: string) => Promise<TransitNetwork>` (test injection); `BrushEditor` prop `view?: ViewPrefs`.

- [ ] **Step 1: Write the failing SimMap test**

Create `src/lib/map/SimMap.transit.svelte.spec.ts`. Copy the mount scaffolding from `SimMap.svelte.spec.ts`: the `FIXTURE` re-rooting of `manifestJson`, `host()`, `mount()` and the error listeners. Then:

```ts
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { TRANSIT_ACCESS_LAYER, TRANSIT_ACCESS_SOURCE, TRANSIT_STOP_LAYERS, TRANSIT_STOPS_SOURCE } from './style';

async function features(map: MapLibreMap, source: string): Promise<number> {
  const d = (await (map.getSource(source) as GeoJSONSource).getData()) as { features: unknown[] };
  return d.features.length;
}
const vis = (map: MapLibreMap, id: string) => map.getLayoutProperty(id, 'visibility') ?? 'visible';

describe('SimMap transit', () => {
  it('loads the fixture network into both sources and shows both layers by default', async () => {
    const { ready } = await mount();
    const map = (await ready).getMap()!;
    await expect.poll(() => features(map, TRANSIT_STOPS_SOURCE), { timeout: 10_000 }).toBe(8);
    await expect.poll(() => features(map, TRANSIT_ACCESS_SOURCE), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(vis(map, TRANSIT_ACCESS_LAYER)).toBe('visible');
    for (const id of TRANSIT_STOP_LAYERS) expect(vis(map, id)).toBe('visible');
    expect(errors).toEqual([]);
  });

  it('applies view changes without remounting', async () => {
    const { ready, screen } = await mount({ view: { transitStops: true, transitAccess: false } });
    const map = (await ready).getMap()!;
    await expect.poll(() => vis(map, TRANSIT_ACCESS_LAYER)).toBe('none');
    await screen.rerender({ view: { transitStops: false, transitAccess: true } });
    await expect.poll(() => vis(map, TRANSIT_ACCESS_LAYER)).toBe('visible');
    for (const id of TRANSIT_STOP_LAYERS) expect(vis(map, id)).toBe('none');
    expect((await ready).getMap()).toBe(map);
  });

  it('stays ready with empty layers when transit.json fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ready, root } = await mount({ fetchTransit: () => Promise.reject(new Error('HTTP 404')) });
    const map = (await ready).getMap()!;
    await expect.element(root).toHaveAttribute('data-state', 'ready');
    await expect.poll(() => warn.mock.calls.some((c) => String(c[0]).includes('transit'))).toBe(true);
    expect(await features(map, TRANSIT_STOPS_SOURCE)).toBe(0);
  });

  it('makes no transit fetch and adds no transit layers without manifest.transit', async () => {
    const fetchTransit = vi.fn();
    const { transit: _omit, ...plain } = manifest;
    const { ready } = await mount({ manifest: plain as typeof manifest, fetchTransit });
    const map = (await ready).getMap()!;
    expect(map.getSource(TRANSIT_STOPS_SOURCE)).toBeUndefined();
    expect(fetchTransit).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run --project client src/lib/map/SimMap.transit.svelte.spec.ts`
Expected: FAIL. Sources stay empty and the `view` prop is unknown.

- [ ] **Step 3: Add the props**

In `src/lib/map/types.ts`, inside `SimMapProps` (add the imports `ViewPrefs` from `'$lib/view/prefs'` and `TransitNetwork` from `'$lib/data/transit'`):

```ts
  /** Transit layer visibility (transit spec §6.3); default both on. */
  view?: ViewPrefs;
  /** Loads `manifest.transit`; tests inject. Default: fetch + decode. */
  fetchTransit?: (url: string) => Promise<TransitNetwork>;
```

- [ ] **Step 4: Wire SimMap**

In `src/lib/map/SimMap.svelte`:

1. Imports:
   - `DEFAULT_VIEW` from `'$lib/view/prefs'`.
   - `buildAccessGrid`, `DEFAULT_TRANSIT_PARAMS` from `'$lib/transit'`.
   - `accessCollection`, `loadTransitNetwork`, `stopTooltipLines`, `stopsCollection`, `transitView`, `type TransitView` from `'./transit-layer'`.
   - `TRANSIT_ACCESS_LAYER`, `TRANSIT_ACCESS_SOURCE`, `TRANSIT_STOP_LAYERS`, `TRANSIT_STOPS_SOURCE` from `'./style'` (extend the existing import).
2. Props: add `view = undefined, fetchTransit = undefined` to the destructure.
3. `Live`: add `transit: TransitView | null;` and `transitIdle: (() => void) | null;`. In `newLive()`, add `transit: null, transitIdle: null`.
4. Add the helpers below `pushChunkData`:

```ts
  /** Transit spec §6.3: layer visibility from the view prefs; re-run after every (re)load. */
  function applyView(): void {
    const l = live;
    const map = l?.loaded ? l.map : null;
    if (!map) return;
    const v = view ?? DEFAULT_VIEW;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    set(TRANSIT_ACCESS_LAYER, v.transitAccess);
    for (const id of TRANSIT_STOP_LAYERS) set(id, v.transitStops);
    if (!v.transitStops && shown?.hit.kind === 'stop') clearShown();
  }

  function onIdle(fn: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(fn, { timeout: 2000 });
      return () => cancelIdleCallback(h);
    }
    const h = setTimeout(fn, 0);
    return () => clearTimeout(h);
  }

  /** Transit spec §5.3/§6.1: stops right away, the access grid in an idle callback. */
  async function startTransit(l: Live, map: MapLibreMap): Promise<void> {
    const url = manifest.transit;
    if (!url) return;
    let t: TransitView;
    try {
      t = transitView(await (fetchTransit ?? ((u: string) => loadTransitNetwork(u)))(url));
    } catch (e) {
      console.warn('[map] transit data unavailable', e);
      return;
    }
    if (l.dead) return;
    l.transit = t;
    (map.getSource(TRANSIT_STOPS_SOURCE) as GeoJSONSource | undefined)?.setData(stopsCollection(t));
    l.transitIdle = onIdle(() => {
      l.transitIdle = null;
      if (l.dead) return;
      const grid = buildAccessGrid(t.net, DEFAULT_TRANSIT_PARAMS, t.service);
      (map.getSource(TRANSIT_ACCESS_SOURCE) as GeoJSONSource | undefined)?.setData(
        accessCollection(grid)
      );
    });
  }
```

5. In `onLoad`, after `applyTheme(theme);`:

```ts
    applyView();
    void startTransit(l, map);
```

6. In `teardown`, after the `chunkRaf` cancel:

```ts
    l.transitIdle?.();
    l.transitIdle = null;
    l.transit = null;
```

7. Effect, next to the theme effect:

```ts
  $effect(() => {
    void [view?.transitStops, view?.transitAccess];
    untrack(() => applyView());
  });
```

8. In `pickAt`, after the `if (!map || !l.loaded) return null;` line. Stops draw on top, so they win:

```ts
    if (l.transit && map.getZoom() >= 14) {
      const layers = TRANSIT_STOP_LAYERS.filter((id) => map.getLayer(id));
      const f = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - TAP_PX, y - TAP_PX],
              [x + TAP_PX, y + TAP_PX]
            ],
            { layers }
          )[0]
        : undefined;
      const i = f?.properties?.i;
      if (typeof i === 'number')
        return { hit: { kind: 'stop', lines: stopTooltipLines(l.transit, i) }, cell: null };
    }
```

(`queryRenderedFeatures` skips hidden layers, so a toggled-off stops layer never produces a tooltip.)

- [ ] **Step 5: Thread `view` through BrushEditor and mount the menu**

`src/lib/brush/BrushEditor.svelte`:
- Add to `Props`: `/** Map layer toggles (transit spec §6.3), passed to SimMap. */ view?: ViewPrefs;`.
- Destructure `view = undefined`.
- Pass `{view}` on `<SimMap …>`.
- Import the type from `'$lib/view/prefs'`.

`src/routes/+page.svelte`:
- Import `ViewMenu` from `'$lib/view/ViewMenu.svelte'`, and `readViewPrefs`, `writeViewPrefs`, `type ViewPrefs` from `'$lib/view/prefs'`.
- Add in the script, beside the other state:

```ts
  // Map layer toggles (transit spec §6.3), per viewer.
  let view = $state<ViewPrefs>(readViewPrefs());
  function onViewChange(v: ViewPrefs): void {
    view = v;
    writeViewPrefs(v);
  }
```

- In the `headerActions` snippet, make this the first child:

```svelte
  {#if data.manifest?.transit}
    <ViewMenu {view} onchange={onViewChange} />
  {/if}
```

- Pass `{view}` to `<BrushEditor … />`.

SSR has no `localStorage`, so `readViewPrefs()` returns the defaults on the server and the stored value on the client. This matches how the brush settings behave. If hydration warns about a mismatched `checked`, read the prefs in `onMount` instead and keep `DEFAULT_VIEW` for the first render.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest --run --project client src/lib/map src/lib/brush src/routes && npm run check`
Expected: PASS, with no svelte-check errors. The existing SimMap and page specs must still pass. A spec that asserts the exact header contents now sees a View button when its manifest has `transit`; update such assertions to include it rather than removing transit from the fixture.

- [ ] **Step 7: Commit**

```bash
git add src/lib/map src/lib/brush/BrushEditor.svelte src/routes/+page.svelte
git commit -m "feat(map): show transit stops and capacity surface with a View menu" -m "SimMap fetches manifest.transit after load, sets the stops source at once and the access grid in an idle callback, applies view prefs on every load, and picks stops first at z14+." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Attribution, end-to-end and docs

**Files:**
- Modify: `src/routes/attribution/+page.svelte`; `src/routes/attribution/page.svelte.spec.ts`
- Create: `e2e/transit.spec.ts`
- Modify: `e2e/map.spec.ts` (snapshot test hides transit layers)
- Modify: `e2e/attribution.spec.ts`
- Modify: `docs/dev/map-interfaces.md`, `docs/dev/map-perf.md`

**Interfaces:**
- Consumes: everything above; fixture-0 with `transit.json` (Task 4); `window.__sfhMap.map` (VITE_E2E build); `expectNoA11yViolations` (`e2e/helpers/a11y.ts`).

- [ ] **Step 1: Write the failing attribution tests**

In `src/routes/attribution/page.svelte.spec.ts`, follow the existing render pattern:
- Render with a manifest that has `transit`, and assert the text `Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds.` is visible.
- Render without `transit`, and assert that text is absent.

In `e2e/attribution.spec.ts`, append that sentence to `NOTICES`; fixture-0 has transit. Add:

```ts
  await expect(page.getByRole('link', { name: 'SFMTA Muni GTFS' })).toBeVisible();
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `npx vitest --run --project client src/routes/attribution`
Expected: FAIL (notice missing).

- [ ] **Step 3: Add the notice**

In `src/routes/attribution/+page.svelte`, inside the "Licences and notices" `<ul>`, after the DataSF item:

```svelte
  {#if manifest?.transit}
    <li>
      Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds. These are facts,
      credited as a courtesy; vehicle capacities are agency planning figures.
    </li>
  {/if}
```

Keep the first sentence exactly as the tests quote it.

- [ ] **Step 4: Write the e2e test**

Create `e2e/transit.spec.ts`:

```ts
// Transit layers e2e (transit spec §7) on fixture-0: 8 stops, View menu, persistence, a11y.
import { expect, test, type Page } from '@playwright/test';
import type { SfhMapDebug } from '../src/lib/map/debug';
import { expectNoA11yViolations } from './helpers/a11y';

type Win = Window & { __sfhMap?: SfhMapDebug };

async function gotoReady(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
}

const visibility = (page: Page, id: string) =>
  page.evaluate((l) => (window as Win).__sfhMap!.map!.getLayoutProperty(l, 'visibility') ?? 'visible', id);

test('fixture stops load and both layers are on by default', async ({ page }) => {
  await gotoReady(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const src = (window as Win).__sfhMap!.map!.getSource('transit-stops') as unknown as {
          getData(): Promise<{ features: unknown[] }>;
        };
        return (await src.getData()).features.length;
      })
    )
    .toBe(8);
  expect(await visibility(page, 'transit-access')).toBe('visible');
  expect(await visibility(page, 'transit-stops-regional')).toBe('visible');
});

test('the View menu toggles a layer and the choice survives a reload', async ({ page }) => {
  await gotoReady(page);
  await page.getByRole('button', { name: 'View' }).click();
  await expectNoA11yViolations(page, { include: ['header'] });
  await page.getByRole('checkbox', { name: 'Transit capacity within a 10-minute walk' }).uncheck();
  await expect.poll(() => visibility(page, 'transit-access')).toBe('none');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'View' })).toBeFocused();
  await gotoReady(page);
  await expect.poll(() => visibility(page, 'transit-access')).toBe('none');
  expect(await visibility(page, 'transit-stops-regional')).toBe('visible');
});
```

Check the option names in `e2e/helpers/a11y.ts` (`include` takes CSS selectors) and that the header element is a `<header>`. Adjust the selector to match `SiteHeader`.

- [ ] **Step 5: Keep the map snapshots stable**

In `e2e/map.spec.ts`, find the `toHaveScreenshot` test (around line 694). Before its `page.goto`, add an init script so the baseline images are unaffected by the new default-on layers:

```ts
    await page.addInitScript(() =>
      localStorage.setItem('sfhousing:view', JSON.stringify({ transitStops: false, transitAccess: false }))
    );
```

If the test already calls `addInitScript`, add this line inside the existing callback.

- [ ] **Step 6: Run the e2e suite**

Run: `npx playwright test e2e/transit.spec.ts e2e/attribution.spec.ts e2e/map.spec.ts e2e/pages-a11y.spec.ts --project=chromium`
Expected: PASS. Port 4173 must be free; see `docs/dev/testing.md`. Then run `--project=mobile` for `transit.spec.ts` too, to cover the 375 px header with the extra button.

- [ ] **Step 7: Docs**

- `docs/dev/map-interfaces.md`: add a **Transit layers** section with:
  - The source and layer ids (`transit-access`, `transit-stops-{bus,rail,regional}`) and their stack position (access under existing buildings, stops above labels).
  - The `SimMapProps.view` and `fetchTransit` props.
  - That MapLibre layers are used, not `setOverlayLayers`, because that is single-owner.
  - That the transit UI hides when `manifest.transit` is absent.
- `docs/dev/map-perf.md`: add a note that `npm run bench:map` must be run with both transit layers on (the default) on the bench machine. Record the p50/p95 result next to the existing results table. If it misses the pass bar, record that rather than skipping it.

- [ ] **Step 8: Full gate**

Run: `npm run lint && npm run check && npm run test:unit && npm run test:pipeline`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/routes/attribution e2e docs/dev/map-interfaces.md docs/dev/map-perf.md
git commit -m "test(e2e): cover transit layers, View menu and attribution" -m "Map snapshot test turns transit layers off so the baseline images stay valid." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (resolved inline)

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §4.1 sources and bootstrap | 4, 5 |
  | §4.2 steps 1–7 | 2, 3 |
  | §4.3 format and V14 | 1, 4 |
  | §4.4 fixture | 4 |
  | §5.1–5.2 | 1, 6 |
  | §5.3 | 7 |
  | §6.1 | 8, 10 |
  | §6.2 | 11 |
  | §6.3 | 9, 10 |
  | §7 testing | throughout; perf in 7 and 11 |
  | §8 seams | Nothing built. `TransitNetwork` is the only input everywhere, and Task 6 / Task 7 tests pin "edits change results". |
- **Spec gaps resolved:**
  1. `tpd` was added for `sb79Tier`.
  2. Service dates are per operator, because the live Muni feed's calendar has ended.
  3. §5.3's capacity formula is aligned with the vehicle/consist table.
  4. The config file was renamed to avoid `pipeline/config.ts` ambiguity.
  5. Stops use three layers instead of one.
  6. Strict route-assignment checks run on live builds only (fixture feeds carry two Muni lines).
  7. `E` and `S` are absent from the live Muni feed and are dropped from the seed table.
  8. Caltrain's tier counts the whole station.
- **Type names used across tasks:**
  - `TransitNetwork`, `StopServiceEntry`, `StopService`, `TransitView`, `AccessGrid`, `TransitParams`, `ViewPrefs`, `GtfsFiles`, `GtfsFeedSpec`, `GtfsLockId`.
  - Functions `stopService(net)`, `stopCapacity(net, service?)`, `sb79Tier(net, stop, service?)`, `buildAccessGrid(net, params?, service?)`, `accessAt(grid, lngLat)`.
  - Constants `TRANSIT_STOP_LAYERS`.
  - Each is defined once and consumed under the same name.
