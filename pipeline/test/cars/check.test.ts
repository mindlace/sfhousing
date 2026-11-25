import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeCarData, type CarData } from '../../../src/lib/data/cars-codec';
import type { Manifest } from '../../../src/lib/data/manifest';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { CARS_BIN, CAR_ZONES_JSON } from '../../lib/scenario-files';
import { checkCars } from '../../steps/check';

const V = 'fixture-0';
const fzp = (cars: boolean) => ({
  parcels: `/data/${V}/scenarios/fzp/parcels.bin`,
  projects: `/data/${V}/scenarios/fzp/projects.json`,
  calibration: `/data/${V}/scenarios/fzp/calibration.json`,
  ...(cars ? { cars: `/data/${V}/${CARS_BIN}`, carZones: `/data/${V}/${CAR_ZONES_JSON}` } : {})
});
const manifest = (cars: boolean) =>
  ({ datasetVersion: V, scenarios: { fzp: fzp(cars) } }) as unknown as Manifest;
/** Three lots: 10, 4 and 7 homes. */
const parcels = { count: 3, existingUnits: Uint16Array.from([10, 4, 7]) } as ScenarioParcels;

/** Two zones: lots 0 and 1 in zone 0 (14 homes x 0.5 = 7), lot 2 in zone 1 (7 x 1 = 7). */
function data(): CarData {
  const households = new Int32Array(2 * 1 * 4);
  households.set([3, 2, 1, 1], 0);
  households.set([7, 0, 0, 0], 4);
  return {
    zones: ['060750101001', '060750101002'],
    pumas: ['07507'],
    zonePuma: Int32Array.from([0, 0]),
    lotZone: Int32Array.from([0, 0, 1]),
    areaM2: Float64Array.from([1, 1]),
    occupied: Float64Array.from([0.5, 1]),
    access: new Float64Array(2),
    constant: new Float64Array(6),
    types: 1,
    households
  };
}

function outDir(d: CarData | null, features = d?.zones.length ?? 0): string {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-cars-check-'));
  mkdirSync(join(dir, 'scenarios/fzp'), { recursive: true });
  if (d) {
    writeFileSync(join(dir, CARS_BIN), deflateRawSync(encodeCarData(d)));
    writeFileSync(
      join(dir, CAR_ZONES_JSON),
      JSON.stringify({
        type: 'FeatureCollection',
        features: Array.from({ length: features }, (_, z) => ({
          type: 'Feature',
          properties: { z },
          geometry: null
        }))
      })
    );
  }
  return dir;
}

describe('V38 and V39', () => {
  it('pass as no car data without the files or the manifest keys', () => {
    expect(checkCars(outDir(null), manifest(false), parcels)).toEqual([
      { id: 'V38', ok: true, detail: 'no car data' },
      { id: 'V39', ok: true, detail: 'no car data' }
    ]);
  });

  it('pass on a cars.bin that decodes, aligns and sums per zone, and one feature per zone', () => {
    const [v38, v39] = checkCars(outDir(data()), manifest(true), parcels);
    expect(v38).toEqual({
      id: 'V38',
      ok: true,
      detail: '2 zones, 14 households, 0 lots in no zone'
    });
    expect(v39).toEqual({ id: 'V39', ok: true, detail: '2 features' });
  });

  it('V38 fails on a zone total off round(occupied x homes), a misaligned file or no manifest key', () => {
    const off = data();
    off.households[4] = 8;
    expect(checkCars(outDir(off), manifest(true), parcels)[0]).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/zone 1 \(060750101002\) has 8 households, want 7/)
    });
    const four = { ...parcels, count: 4 } as ScenarioParcels;
    expect(checkCars(outDir(data()), manifest(true), four)[0]).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/does not decode.*3 lots, want 4/)
    });
    expect(checkCars(outDir(data()), manifest(false), parcels)[0]).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/not named in the manifest/)
    });
  });

  it('V38 fails on a file with no zones, and on no households while the zones hold homes', () => {
    const empty: CarData = {
      ...data(),
      zones: [],
      zonePuma: new Int32Array(0),
      lotZone: Int32Array.from([-1, -1, -1]),
      areaM2: new Float64Array(0),
      occupied: new Float64Array(0),
      access: new Float64Array(0),
      constant: new Float64Array(0),
      households: new Int32Array(0)
    };
    expect(checkCars(outDir(empty), manifest(true), parcels)[0]).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/has no zones/)
    });
    // Occupied 0 everywhere: each zone's total (0) is met, but 21 homes hold no household.
    const vacant = data();
    vacant.occupied.fill(0);
    vacant.households.fill(0);
    expect(checkCars(outDir(vacant), manifest(true), parcels)[0]).toMatchObject({
      ok: false,
      detail: '0 households on 21 homes'
    });
  });

  it('V39 fails when the feature count is not the zone count', () => {
    expect(checkCars(outDir(data(), 1), manifest(true), parcels)[1]).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/1 features, want 2/)
    });
  });
});
