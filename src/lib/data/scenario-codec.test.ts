import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '../timelapse/types';
import { scenarioTiny } from './fixtures/scenario-tiny';
import {
  FILL_LEVELS,
  ScenarioFormatError,
  decodeScenarioPayload,
  encodeScenarioPayload,
  envelopeOf,
  featureValue,
  fillStories,
  readScenarioParcels
} from './scenario-codec';

interface Column {
  name: string;
  type: string;
  offset: number;
  byteLength: number;
}

const headerLen = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset).getUint32(8, true);
const header = (b: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + headerLen(b)))) as Record<
    string,
    unknown
  > & { columns: Column[] };

/** Rewrites the header JSON in place, space-padded to its original length (JSON allows it). */
function withHeader(b: Uint8Array, mutate: (h: ReturnType<typeof header>) => void): Uint8Array {
  const h = header(b);
  mutate(h);
  const json = new TextEncoder().encode(JSON.stringify(h));
  const len = headerLen(b);
  expect(json.length).toBeLessThanOrEqual(len);
  const out = b.slice();
  out.fill(0x20, 12, 12 + len);
  out.set(json, 12);
  return out;
}

const rejects = (b: Uint8Array, message: RegExp) => {
  expect(() => decodeScenarioPayload(b)).toThrow(ScenarioFormatError);
  expect(() => decodeScenarioPayload(b)).toThrow(message);
};

describe('sfh-scenario/1 codec', () => {
  it('round-trips the tiny fixture', () => {
    const t = scenarioTiny();
    expect(decodeScenarioPayload(encodeScenarioPayload(t))).toEqual(t);
  });

  it('round-trips existingFloorAreaM2 at 0, a typical value and 2^32 - 1', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    expect(d.existingFloorAreaM2).toBeInstanceOf(Uint32Array);
    expect([...d.existingFloorAreaM2]).toEqual([186, 0, 0, 0xffffffff, 1250, 77]);
  });

  it('decodes a row with imputed bit 6 (existingFloorAreaM2 from the chunk record)', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    expect(d.imputed[1]).toBe(95);
    expect(d.imputed[1] & 0b1000000).toBe(0b1000000);
  });

  it('encodes deterministically', () => {
    expect(encodeScenarioPayload(scenarioTiny())).toEqual(encodeScenarioPayload(scenarioTiny()));
  });

  it('writes the header keys in order and 8-aligned columns', () => {
    const b = encodeScenarioPayload(scenarioTiny());
    expect(new TextDecoder().decode(b.subarray(0, 4))).toBe('SFHS');
    const h = header(b);
    expect(Object.keys(h)).toEqual([
      'format',
      'datasetVersion',
      'scenario',
      'rollYear',
      'count',
      'fillLevels',
      'cells',
      'districts',
      'landUseClasses',
      'provenance',
      'columns'
    ]);
    const start = 12 + headerLen(b);
    for (const c of h.columns) {
      expect(c.offset % 8, c.name).toBe(0);
      expect(c.offset, c.name).toBeGreaterThanOrEqual(start);
    }
    expect(h.columns.map((c) => c.name)).toEqual([
      'idPrefix',
      'idSuffixLen',
      'idSuffix',
      'labelLng',
      'labelLat',
      'cell',
      'district',
      'envelopeStories',
      'baseStories',
      'flags',
      'imputed',
      'existingUnits',
      'existingFloorAreaM2',
      'existingStories',
      'lotAreaM2',
      'yearBuilt',
      'improvementShare',
      'landUseClass',
      'baseCap',
      'baseYield',
      'yield'
    ]);
  });

  it('front-codes ids across a cell boundary', () => {
    const t = scenarioTiny();
    const b = encodeScenarioPayload(t);
    expect(decodeScenarioPayload(b).id).toEqual([
      '0026T001A',
      '3512001',
      '3512002',
      '3512008',
      '3512010',
      '8711023C'
    ]);
    const prefix = header(b).columns.find((c) => c.name === 'idPrefix')!;
    const first = t.cells[1].start;
    const prev = t.id[first - 1];
    const cur = t.id[first];
    let shared = 0;
    while (shared < prev.length && prev[shared] === cur[shared]) shared++;
    expect(shared).toBe(6);
    expect(b[prefix.offset + first]).toBe(shared);
  });

  it('derives potentialRatio and storiesGap', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    const F = d.fillLevels.length;
    for (let i = 0; i < d.count; i++) {
      const units = Math.max(d.existingUnits[i], 1);
      expect(d.potentialRatio.fzp[i]).toBe(Math.fround(d.yield[i * F + F - 1] / units));
      expect(d.potentialRatio.base[i]).toBe(Math.fround(d.baseYield[i * F + F - 1] / units));
      expect(d.storiesGap.fzp[i]).toBe(d.envelopeStories[i] - d.existingStories[i]);
      expect(d.storiesGap.base[i]).toBe(d.baseStories[i] - d.existingStories[i]);
    }
  });

  describe('rejects bad input with ScenarioFormatError', () => {
    const good = () => encodeScenarioPayload(scenarioTiny());

    it('bad magic', () => {
      const b = good();
      b[0] = 0x58;
      rejects(b, /bad magic/);
    });

    it('major 2', () => {
      const b = good();
      new DataView(b.buffer).setUint16(4, 2, true);
      rejects(b, /unsupported major version 2/);
    });

    it('header not JSON', () => {
      const b = good();
      b[12] = 0x7a;
      rejects(b, /header is not JSON/);
    });

    it('header missing columns', () => {
      rejects(
        withHeader(good(), (h) => delete (h as Partial<typeof h>).columns),
        /header missing key columns/
      );
    });

    it('a truncated column', () => {
      const b = withHeader(good(), (h) => {
        const c = h.columns.find((c) => c.name === 'cell')!;
        c.byteLength = (scenarioTiny().count - 1) * 2;
      });
      rejects(b, /column cell is 10 bytes, want 12/);
    });

    it('a missing existingFloorAreaM2 column (a file written before RA1)', () => {
      rejects(
        withHeader(good(), (h) => {
          h.columns = h.columns.filter((c) => c.name !== 'existingFloorAreaM2');
        }),
        /column existingFloorAreaM2 is missing/
      );
    });

    /** Sets `bit` in row `row` of the u8 column `name`, in place in the column bytes. */
    const withBit = (name: string, row: number, bit: number) => {
      const b = good();
      const c = header(b).columns.find((c) => c.name === name)!;
      b[c.offset + row] |= 1 << bit;
      return b;
    };

    it('a set reserved bit 7 in imputed', () => {
      rejects(withBit('imputed', 2, 7), /imputed\[2\] = \d+ sets reserved bits/);
    });

    it('a set reserved bit 5, 6 or 7 in flags', () => {
      for (const bit of [5, 6, 7])
        rejects(withBit('flags', 0, bit), /flags\[0\] = \d+ sets reserved bits/);
    });

    it('a district index past districts', () => {
      rejects(
        withHeader(good(), (h) => (h.districts = [''])),
        /district\[\d\] = \d is past its dictionary \(1\)/
      );
    });

    it('fillLevels not ascending', () => {
      rejects(
        withHeader(good(), (h) => (h.fillLevels = [0.5, 0.25, 1])),
        /fillLevels not ascending/
      );
    });

    it('fillLevels ending at 0.9', () => {
      rejects(
        withHeader(good(), (h) => (h.fillLevels = [0.25, 0.5, 0.9])),
        /fillLevels does not end at 1/
      );
    });
  });

  it('encode rejects an id suffix over 255 bytes', () => {
    const t = scenarioTiny();
    t.id[1] = '9'.repeat(256);
    expect(() => encodeScenarioPayload(t)).toThrow(ScenarioFormatError);
  });

  it('encode rejects a yield above 65,535 instead of wrapping', () => {
    const t = scenarioTiny();
    t.yield = Object.assign([...t.yield], { 4: 65536 }) as unknown as Uint16Array;
    expect(() => encodeScenarioPayload(t)).toThrow(ScenarioFormatError);
  });

  it('encode rejects a negative or non-integer existingFloorAreaM2', () => {
    for (const v of [-1, 12.5, 2 ** 32]) {
      const t = scenarioTiny();
      t.existingFloorAreaM2 = Object.assign([...t.existingFloorAreaM2], {
        0: v
      }) as unknown as Uint32Array;
      expect(() => encodeScenarioPayload(t), String(v)).toThrow(ScenarioFormatError);
      expect(() => encodeScenarioPayload(t), String(v)).toThrow(/existingFloorAreaM2\[0\]/);
    }
  });

  it('encode rejects a set reserved bit 7 in imputed', () => {
    const t = scenarioTiny();
    t.imputed[0] = 0x80;
    expect(() => encodeScenarioPayload(t)).toThrow(/imputed\[0\] = 128 sets reserved bits/);
  });

  it('featureValue covers every FeatureId × env', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    const table: [FeatureId, number, number][] = [
      ['potentialRatio', 10 / 2, 4 / 2],
      ['existingUnits', 2, 2],
      ['lotAreaM2', 450, 450],
      ['yearBuilt', 1925, 1925],
      ['storiesGap', 6 - 2, 4 - 2],
      ['improvementShare', Math.fround(0.35), Math.fround(0.35)],
      ['rentControlLikely', 1, 1],
      ['landUseClass', 1, 1]
    ];
    for (const [f, fzp, base] of table) {
      expect(featureValue(d, 0, f, 'fzp'), `${f} fzp`).toBe(fzp);
      expect(featureValue(d, 0, f, 'base'), `${f} base`).toBe(base);
    }
  });

  it('envelopeOf returns { maxStories: envelopeStories[i] }', () => {
    const d = scenarioTiny();
    expect(envelopeOf(d, 0)).toEqual({ maxStories: 6 });
    expect(envelopeOf(d, 4)).toEqual({ maxStories: 24 });
    expect(envelopeOf(d, 5)).toEqual({ maxStories: 0 });
  });

  it('fillStories table', () => {
    const over = (max: number) => FILL_LEVELS.map((f) => fillStories(f, max));
    expect(over(4)).toEqual([1, 2, 3, 4, 4]);
    expect(over(8)).toEqual([2, 4, 6, 7, 8]);
    expect(over(24)).toEqual([6, 12, 18, 22, 24]);
    expect(over(1)).toEqual([1, 1, 1, 1, 1]);
    expect([...FILL_LEVELS].sort((a, b) => a - b)).toEqual([...FILL_LEVELS]);
    expect(FILL_LEVELS[FILL_LEVELS.length - 1]).toBe(1);
  });

  it('readScenarioParcels inflates a Uint8Array body', async () => {
    const t = scenarioTiny();
    const z = new Uint8Array(deflateRawSync(encodeScenarioPayload(t), { level: 9 }));
    await expect(readScenarioParcels(z)).resolves.toEqual(t);
    await expect(readScenarioParcels(z.subarray(0, z.length >> 1))).rejects.toThrow(
      ScenarioFormatError
    );
  });
});
