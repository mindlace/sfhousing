// The car system's cost per world (perf project; prints only, no bar): on the live city, one
// world stepped through months 1 to 480, the car step's median and p90 per world-month, and the
// whole window's `step` time with cars on and off. The live dataset's own car data when it has
// it, else hand-built data of the live build's size (about 580 zones, 96 types). Skips without a
// live city (`SFH_WORLD_LIVE`). Run on a quiet machine:
// `npx vitest --run --project perf src/lib/sim/world/cars/cars.perf.spec.ts`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeCarData, type CarData } from '$lib/data/cars-codec';
import { parseManifest } from '$lib/data/manifest';
import type { CarModel } from '$lib/sim/cars';
import { parseCalibration } from '$lib/timelapse/model';
import { staticsOf } from '../statics';
import { liveDir, liveInput } from '../test/cities.node';
import { frameOf, oneFrame } from '../test/timeline';
import type { CarSystem, StepSink, WorldEvent } from '../types';
import { withFunding } from '../world';
import { carSnapshotOf } from './columns';
import { createCarSystem } from './system';
import { LIVE_BANDS, carCity } from './test/city';

const MONTHS = 480;
const SEED = 1;
const dir = liveDir();

/** The dataset's car data and model, when it ships them. */
function ownCars(d: string, lots: number): { data: CarData; model: CarModel } | null {
  const manifest = parseManifest(JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')));
  const fzp = manifest.scenarios?.fzp;
  if (!fzp?.cars) return null;
  const prefix = `/data/${manifest.datasetVersion}/`;
  const pathOf = (url: string) => join(d, url.slice(prefix.length));
  const bin = pathOf(fzp.cars);
  if (!existsSync(bin)) return null;
  const cal = parseCalibration(JSON.parse(readFileSync(pathOf(fzp.calibration), 'utf8')));
  if (!cal.cars) return null;
  return {
    data: decodeCarData(new Uint8Array(inflateRawSync(readFileSync(bin))), lots),
    model: cal.cars
  };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

describe.skipIf(dir === null)('car system cost per world, live city', () => {
  it('prints the car step per world-month and the window with cars on and off', async () => {
    const input = await liveInput(dir!);
    const statics = staticsOf(input);
    const timeline = oneFrame(frameOf(input));
    const own = ownCars(dir!, input.parcels.id.length);
    const { data, model } = own ?? carCity(input, { zones: 580, bands: LIVE_BANDS });
    const inner = createCarSystem(data, model, { link: false });
    const carMs: number[] = [];
    const cars: CarSystem = {
      create: (w, s) => inner.create(w, s),
      onEvent: (w, s, e) => inner.onEvent(w, s, e),
      step(ctx) {
        const t0 = performance.now();
        inner.step(ctx);
        carMs.push(performance.now() - t0);
      },
      timelineOf: (w, s, t) => inner.timelineOf(w, s, t)
    };

    const window = (sys: CarSystem | null) => {
      const api = withFunding(null, sys);
      let events = 0;
      const out: StepSink = { event: (_e: WorldEvent) => void events++ };
      const w = api.createWorld(statics, timeline, SEED, out);
      const due = api.planDue(w, statics, timeline, SEED, MONTHS);
      const t0 = performance.now();
      for (let m = 1; m <= MONTHS; m++) api.step(w, due, statics, timeline, SEED, out);
      return { ms: performance.now() - t0, events, w };
    };
    const off = window(null);
    const on = window(cars);
    const median = quantile(carMs, 0.5);
    const p90 = quantile(carMs, 0.9);
    const snap = carSnapshotOf(on.w)!;
    console.log(
      `cars (${own ? 'dataset' : 'hand-built'}: ${data.zones.length} zones, ${data.types} types): ` +
        `car step per world-month median ${median.toFixed(3)} ms, p90 ${p90.toFixed(3)} ms; ` +
        `window ${MONTHS} months: off ${off.ms.toFixed(0)} ms, on ${on.ms.toFixed(0)} ms; ` +
        `households ${snap.households}, cars/household ${(snap.cars / snap.households).toFixed(3)}`
    );
    expect(carMs).toHaveLength(MONTHS);
    expect(Number.isFinite(median) && median > 0 && Number.isFinite(p90)).toBe(true);
    expect(off.ms > 0 && on.ms > 0).toBe(true);
    expect(on.events).toBe(off.events);
    expect(snap.households).toBeGreaterThan(0);
    expect(snap.carless).toBeLessThanOrEqual(snap.households);
  }, 600_000);
});
