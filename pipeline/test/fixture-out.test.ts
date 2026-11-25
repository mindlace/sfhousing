// `fixture --out` empties its target, so it must refuse anything that is not a fresh or previous
// fixture output. Only temp dirs are written; repo paths are probed with names that do not exist.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeCarData } from '../../src/lib/data/cars-codec';
import { parseManifest } from '../../src/lib/data/manifest';
import { parseCalibration } from '../../src/lib/timelapse/model';
import { CARS_BIN, CAR_ZONES_JSON, PARCELS_BIN, readParcelsBin } from '../lib/scenario-files';
import { CALIBRATION_JSON } from '../steps/calibration';
import { checkCars } from '../steps/check';
import { fixture, outTargetError } from '../steps/fixture';

const ROOT = resolve(import.meta.dirname, '../..');
const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-fx-out-'));

describe('fixture --out target guard', () => {
  it('refuses a non-empty directory that is not a previous fixture output, leaving it intact', async () => {
    const d = tmp();
    writeFileSync(join(d, 'precious.txt'), 'keep me');
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(1);
    expect(readFileSync(join(d, 'precious.txt'), 'utf8')).toBe('keep me');
  });

  it('refuses a directory whose manifest is not a fixture version', async () => {
    const d = tmp();
    writeFileSync(
      join(d, 'manifest.json'),
      JSON.stringify({ datasetVersion: '2026-10-10-abcdef12' })
    );
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(1);
    expect(existsSync(join(d, 'manifest.json'))).toBe(true);
  });

  it('replaces a previous fixture output', async () => {
    const d = tmp();
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ datasetVersion: 'fixture-3' }));
    writeFileSync(join(d, 'stale.txt'), 'old');
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(0);
    expect(existsSync(join(d, 'stale.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')).datasetVersion).toBe(
      'fixture-0'
    );
  });

  it('refuses targets inside the committed fixture trees, without creating them', async () => {
    for (const rel of ['e2e/fixtures/__sfh_nope__', 'pipeline/test/fixtures/mini/__sfh_nope__']) {
      const p = join(ROOT, rel);
      expect(outTargetError(p), rel).toMatch(/^refusing --out .*: inside /);
      expect(await fixture({ outDir: p, skipTiles: true })).toBe(1);
      expect(existsSync(p)).toBe(false);
    }
    expect(outTargetError(join(ROOT, 'e2e/fixtures/data/fixture-0/../fixture-0'))).toMatch(
      /inside e2e\/fixtures$/
    );
  });

  it('allows a missing or empty directory', () => {
    expect(outTargetError(tmp())).toBeNull();
    expect(outTargetError(join(tmp(), 'new'))).toBeNull();
  });
});

// Car-ownership plan Task 7: the mini city has a Census population, so fixture-0 carries the car
// files and the car model, and e2e covers the car path.
describe('fixture-0 car model', () => {
  const e2e = join(ROOT, 'e2e/fixtures/data/fixture-0');
  const json = (f: string) => JSON.parse(readFileSync(join(e2e, f), 'utf8')) as unknown;

  it('names cars.bin and car-zones.json in the manifest', () => {
    const m = parseManifest(json('manifest.json'));
    expect(m.scenarios?.fzp?.cars).toBe(`/data/fixture-0/${CARS_BIN}`);
    expect(m.scenarios?.fzp?.carZones).toBe(`/data/fixture-0/${CAR_ZONES_JSON}`);
  });

  it('decodes cars.bin against parcels.bin', () => {
    const p = readParcelsBin(join(e2e, PARCELS_BIN));
    const d = decodeCarData(
      new Uint8Array(inflateRawSync(readFileSync(join(e2e, CARS_BIN)))),
      p.count
    );
    expect(d.zones.length).toBeGreaterThan(1);
    expect(d.households.reduce((s, h) => s + h, 0)).toBeGreaterThan(0);
  });

  it('parses calibration.json with cars, the parking link on at an invented tier-4 cost', () => {
    const cars = parseCalibration(json(CALIBRATION_JSON)).cars;
    expect(cars).toBeDefined();
    expect(cars!.parking.costPerSpace).not.toBeNull();
    const cost = cars!.parking.provenance.filter((x) => x.label.startsWith('Cost per'));
    expect(cost.length).toBeGreaterThan(0);
    for (const c of cost) {
      expect(c.tier).toBe(4);
      expect(c.method).toMatch(/invented/i);
    }
  });

  it('passes V38 and V39', () => {
    const r = checkCars(
      e2e,
      parseManifest(json('manifest.json')),
      readParcelsBin(join(e2e, PARCELS_BIN))
    );
    expect(r.map((x) => x.id)).toEqual(['V38', 'V39']);
    for (const x of r) {
      expect(x.ok, x.detail).toBe(true);
      expect(x.detail).not.toBe('no car data');
    }
  });
});
