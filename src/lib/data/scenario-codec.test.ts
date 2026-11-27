import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '../timelapse/types';
import { scenarioTiny } from './fixtures/scenario-tiny';
import {
  ScenarioFormatError,
  decodeScenarioPayload,
  encodeScenarioPayload,
  envelopeOf,
  featureValue,
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

describe('sfh-scenario/2 codec', () => {
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

  it('round-trips the scenario eligibility as flags bit 5 and decodes it as 0/1', () => {
    const t = scenarioTiny();
    const b = encodeScenarioPayload(t);
    const flags = header(b).columns.find((c) => c.name === 'flags')!;
    const bit5 = Array.from({ length: t.count }, (_, i) => (b[flags.offset + i] >> 5) & 1);
    expect(bit5).toEqual([1, 1, 1, 0, 1, 1]);
    const d = decodeScenarioPayload(b);
    expect(d.eligible).toBeInstanceOf(Uint8Array);
    expect([...d.eligible]).toEqual([1, 1, 1, 0, 1, 1]);
    // Bit 5 is independent of the other flags: clearing it leaves hostable and hostableBase.
    t.eligible[4] = 0;
    const e = decodeScenarioPayload(encodeScenarioPayload(t));
    expect([e.eligible[4], e.hostable[4], e.hostableBase[4], e.localProgram[4]]).toEqual([
      0, 1, 1, 1
    ]);
  });

  it('encode rejects an eligible value that is not 0/1', () => {
    const t = scenarioTiny();
    t.eligible[2] = 2;
    expect(() => encodeScenarioPayload(t)).toThrow(/eligible\[2\] = 2 is not 0\/1/);
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
      'fzpCap'
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

  it('round-trips the FZP cap, none on Local Program parcels', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    expect([...d.fzpCap]).toEqual([0xffff, 0xffff, 3, 2, 0xffff, 0xffff]);
  });

  describe('rejects bad input with ScenarioFormatError', () => {
    const good = () => encodeScenarioPayload(scenarioTiny());

    it('bad magic', () => {
      const b = good();
      b[0] = 0x58;
      rejects(b, /bad magic/);
    });

    it('unsupported major 1 (the fill-level format)', () => {
      const b = good();
      new DataView(b.buffer).setUint16(4, 1, true);
      rejects(b, /unsupported major 1 \(this decoder reads major 2\)/);
    });

    it('major 3', () => {
      const b = good();
      new DataView(b.buffer).setUint16(4, 3, true);
      rejects(b, /unsupported major 3/);
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

    it('a set reserved bit 6 or 7 in flags', () => {
      for (const bit of [6, 7])
        rejects(withBit('flags', 0, bit), /flags\[0\] = \d+ sets reserved bits/);
    });

    it('not flags bit 5: it is the eligibility flag', () => {
      // Row 3 (3512008) is not eligible; setting its bit 5 decodes as eligible.
      expect(decodeScenarioPayload(withBit('flags', 3, 5)).eligible[3]).toBe(1);
    });

    it('a district index past districts', () => {
      rejects(
        withHeader(good(), (h) => (h.districts = [''])),
        /district\[\d\] = \d is past its dictionary \(1\)/
      );
    });
  });

  it('encode rejects an id suffix over 255 bytes', () => {
    const t = scenarioTiny();
    t.id[1] = '9'.repeat(256);
    expect(() => encodeScenarioPayload(t)).toThrow(ScenarioFormatError);
  });

  it('encode rejects an fzpCap above 65,535 instead of wrapping', () => {
    const t = scenarioTiny();
    t.fzpCap = Object.assign([...t.fzpCap], { 2: 65536 }) as unknown as Uint16Array;
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

  it('featureValue reads the choice row for the choice features and the columns for the rest', () => {
    const d = decodeScenarioPayload(encodeScenarioPayload(scenarioTiny()));
    const choice = { potentialRatio: 2.5, storiesGap: 3, choiceMargin: 0.1 };
    const table: [FeatureId, number][] = [
      ['potentialRatio', 2.5],
      ['storiesGap', 3],
      ['choiceMargin', 0.1],
      ['existingUnits', 2],
      ['lotAreaM2', 450],
      ['yearBuilt', 1925],
      ['improvementShare', Math.fround(0.35)],
      ['rentControlLikely', 1],
      ['landUseClass', 1]
    ];
    for (const [f, want] of table) expect(featureValue(d, 0, f, choice), f).toBe(want);
  });

  it('envelopeOf returns { maxStories: envelopeStories[i] }', () => {
    const d = scenarioTiny();
    expect(envelopeOf(d, 0)).toEqual({ maxStories: 6 });
    expect(envelopeOf(d, 4)).toEqual({ maxStories: 24 });
    expect(envelopeOf(d, 5)).toEqual({ maxStories: 0 });
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
