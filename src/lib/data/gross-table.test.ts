import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { rectRing } from '$lib/generator/fixtures/geom';
import type { ParcelId, ParcelRecord } from './parcel';
import { scenarioRecordOf } from './scenario-codec';
import { scenarioYield } from './scenario-yield';
import {
  clampGross,
  decodeGrossPayload,
  encodeGrossPayload,
  grossAt,
  grossRowOf,
  grossStoryBound,
  grossTableOf,
  grossTableProblem,
  readGrossTable,
  type GrossRow
} from './gross-table';

const EMPTY: GrossRow = { first: 0, plateau: 0, values: [], clamped: 0 };
const A: GrossRow = { first: 1, plateau: 5, values: [4, 8, 12, 12, 16], clamped: 0 };
const B: GrossRow = { first: 2, plateau: 7, values: [10, 30, 25, 0, 40, 41], clamped: 0 };
const T = grossTableOf('mini-v', [EMPTY, A, B]);

const city = miniCity();
const eligibleIndex = city.parcels.eligible.findIndex((e) => e === 1);
const viewOf = (i: number) =>
  scenarioRecordOf(city.parcels, i, city.records.get(city.parcels.id[i] as ParcelId)!);
const eligibleRec: ParcelRecord = {
  ...viewOf(eligibleIndex),
  polygon: [rectRing(160, 160)]
};

describe('gross table', () => {
  it('round-trips a table through encode and decode', () => {
    expect(decodeGrossPayload(encodeGrossPayload(T))).toEqual(T);
  });

  it('looks up 0 at s <= 0 and below first, g(plateau) at and above plateau', () => {
    expect([grossAt(T, 2, -3), grossAt(T, 2, 0), grossAt(T, 2, 1)]).toEqual([0, 0, 0]);
    expect([grossAt(T, 2, 3), grossAt(T, 2, 5)]).toEqual([30, 0]);
    expect([grossAt(T, 2, 7), grossAt(T, 2, 80), grossAt(T, 2, 255)]).toEqual([41, 41, 41]);
    expect([grossAt(T, 0, 1), grossAt(T, 0, 80)]).toEqual([0, 0]);
    expect([grossAt(T, 1, 1), grossAt(T, 1, 4), grossAt(T, 1, 5)]).toEqual([4, 12, 16]);
  });

  it('grossRowOf keeps first..plateau of the sweep, interior zeros and dips included', () => {
    const sweep = [0, 0, 10, 30, 25, 0, 40, 41];
    const row = grossRowOf(eligibleRec, (_, s) => sweep[s - 1] ?? 41);
    expect(row).toEqual({ first: 3, plateau: 8, values: [10, 30, 25, 0, 40, 41], clamped: 0 });
  });

  it('grossRowOf clamps above 0xFFFF and counts the stored values it clamped', () => {
    const row = grossRowOf(eligibleRec, (_, s) => (s >= 3 ? 162_730 : 1000 * s));
    expect(row).toEqual({ first: 1, plateau: 3, values: [1000, 2000, 65535], clamped: 1 });
    expect(clampGross(70000)).toBe(65535);
    expect(clampGross(12)).toBe(12);
  });

  it('an ineligible or missing record gives an empty row', () => {
    expect(grossRowOf(undefined)).toEqual(EMPTY);
    expect(grossRowOf({ ...eligibleRec, eligible: false })).toEqual(EMPTY);
  });

  it('grossStoryBound: 0 ineligible, 80 for a district-size lot, else physicalMaxStories', () => {
    expect(grossStoryBound({ ...eligibleRec, eligible: false })).toBe(0);
    expect(grossStoryBound(eligibleRec)).toBe(80);
    expect(grossStoryBound({ ...eligibleRec, polygon: [rectRing(7.62, 30.48)] })).toBe(6);
  });

  describe('decode rejections', () => {
    const good = () => Array.from(encodeGrossPayload(grossTableOf('v', [A])));
    // header: 4 magic + version + len + 'v' + u32 count = 11 bytes, then the row
    const withRow = (...row: number[]) => Uint8Array.from([...good().slice(0, 11), ...row]);
    it('rejects bad magic', () => {
      const b = good();
      b[0] = 0;
      expect(() => decodeGrossPayload(Uint8Array.from(b))).toThrow(/magic/);
    });
    it('rejects a newer version', () => {
      const b = good();
      b[4] = 2;
      expect(() => decodeGrossPayload(Uint8Array.from(b))).toThrow(/version/);
    });
    it('rejects a truncated row', () => {
      expect(() => decodeGrossPayload(Uint8Array.from(good().slice(0, -2)))).toThrow(/truncated/);
    });
    it('rejects trailing bytes', () => {
      expect(() => decodeGrossPayload(Uint8Array.from([...good(), 0]))).toThrow(/trailing/);
    });
    it('rejects plateau < first, first 0 with plateau, and plateau above 80', () => {
      expect(() => decodeGrossPayload(withRow(3, 2, 2, 2, 2))).toThrow(/below first/);
      expect(() => decodeGrossPayload(withRow(0, 2, 2, 2))).toThrow(/first 0/);
      expect(() => decodeGrossPayload(withRow(1, 81, 2))).toThrow(/above 80/);
    });
    it('rejects a value outside 0..0xFFFF', () => {
      expect(() => decodeGrossPayload(withRow(1, 1, 0x80, 0x80, 0x08))).toThrow(/out of range/);
      expect(() => decodeGrossPayload(withRow(1, 1, 1))).toThrow(/out of range/);
    });
  });

  it('encode throws a RangeError for a value above 0xFFFF', () => {
    const big: GrossRow = { first: 1, plateau: 1, values: [70000], clamped: 0 };
    expect(() => grossTableOf('v', [big])).toThrow(RangeError);
    // a hand-built table whose values are not a Uint16Array
    const t = { ...grossTableOf('v', [A]), values: [70000] as unknown as Uint16Array };
    expect(() => encodeGrossPayload({ ...t, count: 1, offset: Uint32Array.of(0, 1) })).toThrow(
      RangeError
    );
  });

  it('readGrossTable inflates deflate-raw bytes', async () => {
    expect(await readGrossTable(deflateRawSync(encodeGrossPayload(T)))).toEqual(T);
  });

  it('grossTableProblem names a count or datasetVersion that differs from parcels.bin', () => {
    const p = city.parcels;
    const rows = Array<GrossRow>(p.count).fill(EMPTY);
    expect(grossTableProblem(grossTableOf(p.datasetVersion, rows), p)).toBeNull();
    expect(grossTableProblem(grossTableOf(p.datasetVersion, [EMPTY]), p)).toMatch(/1 rows/);
    expect(grossTableProblem(grossTableOf('other', rows), p)).toMatch(/other/);
  });

  it('on the mini city every row matches clampGross(scenarioYield) at s = 0..81 and 255', () => {
    const p = city.parcels;
    const views = Array.from({ length: p.count }, (_, i) => viewOf(i));
    const table = grossTableOf(
      p.datasetVersion,
      views.map((v) => grossRowOf(v))
    );
    let positive = 0;
    const stories = [...Array.from({ length: 82 }, (_, s) => s), 255];
    for (let i = 0; i < p.count; i++) {
      for (const s of stories) {
        const want = clampGross(scenarioYield(views[i], s, null));
        if (want > 0) positive++;
        expect(grossAt(table, i, s), `row ${i} s ${s}`).toBe(want);
      }
    }
    expect(positive).toBeGreaterThan(0);
  });
});
