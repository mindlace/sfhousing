import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import type { Option } from '../sim/choice/types';
import { BUILDING_FORMS, BUILDING_TYPES } from '../sim/choice/types';
import {
  OPTIONS_MAX_PER_LOT,
  decodeOptionPayload,
  encodeOptionPayload,
  optionTableOf,
  optionTableProblem,
  readOptionTable
} from './option-table';
import type { ScenarioParcels } from './scenario-codec';

/** 300 options, stories rising, every type and form code, homes past the one-byte varint. */
const many: Option[] = Array.from({ length: 300 }, (_, i) => ({
  type: BUILDING_TYPES[i % 3],
  form: BUILDING_FORMS[i % 6],
  stories: 1 + Math.floor(i / 4),
  homes: 1 + i * 211,
  plates: i % 5
}));
const rows = [
  { options: [], locationValue: 0.8 },
  { options: many, locationValue: 1 },
  {
    options: [{ type: 'V', form: 'walkup', stories: 4, homes: 12, plates: 0 } as Option],
    locationValue: 2.5
  }
];
const rowOf = (t: ReturnType<typeof optionTableOf>, i: number): Option[] => {
  const out: Option[] = [];
  for (let j = t.offset[i]; j < t.offset[i + 1]; j++)
    out.push({
      type: BUILDING_TYPES[t.type[j]],
      form: BUILDING_FORMS[t.form[j]],
      stories: t.stories[j],
      homes: t.homes[j],
      plates: t.plates[j]
    });
  return out;
};

describe('option table', () => {
  it('round-trips rows through the payload', () => {
    const t = optionTableOf('v-test', rows);
    expect(t.format).toBe('sfh-options/1');
    expect(t.count).toBe(3);
    expect(Array.from(t.offset)).toEqual([0, 0, 300, 301]);
    const d = decodeOptionPayload(encodeOptionPayload(t));
    expect(d).toEqual(t);
    expect(d.datasetVersion).toBe('v-test');
    expect(rowOf(d, 0)).toEqual([]);
    expect(rowOf(d, 1)).toEqual(many);
    expect(rowOf(d, 2)).toEqual(rows[2].options);
    expect(d.locationValue[2]).toBe(2.5);
    expect(d.locationValue[0]).toBeCloseTo(0.8, 6);
  });
  it('reads a deflate-raw body', async () => {
    const t = optionTableOf('v-test', rows);
    const body = new Uint8Array(deflateRawSync(encodeOptionPayload(t)));
    expect(await readOptionTable(body)).toEqual(t);
  });
  it('rejects a truncated payload', () => {
    const bytes = encodeOptionPayload(optionTableOf('v-test', rows));
    expect(() => decodeOptionPayload(bytes.subarray(0, bytes.length - 3))).toThrow(
      'options: truncated'
    );
    expect(() => decodeOptionPayload(bytes.subarray(0, 2))).toThrow('options: truncated');
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    expect(() => decodeOptionPayload(extra)).toThrow('trailing');
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeOptionPayload(bad)).toThrow('options: bad magic');
  });
  it('refuses a row of more than OPTIONS_MAX_PER_LOT options', () => {
    expect(OPTIONS_MAX_PER_LOT).toBe(1023);
    const row = (n: number) => ({
      options: Array.from({ length: n }, () => many[0]),
      locationValue: 1
    });
    expect(optionTableOf('v', [row(1023)]).count).toBe(1);
    expect(() => optionTableOf('v', [row(1024)])).toThrow(RangeError);
  });
  it('refuses homes above 65,535 and rows out of story order', () => {
    const one = (o: Partial<Option>) => [{ options: [{ ...many[0], ...o }], locationValue: 1 }];
    expect(optionTableOf('v', one({ homes: 65_535 })).homes[0]).toBe(65_535);
    expect(() => optionTableOf('v', one({ homes: 65_536 }))).toThrow(RangeError);
    expect(() => optionTableOf('v', [{ options: [many[8], many[0]], locationValue: 1 }])).toThrow(
      RangeError
    );
  });
  it('names a table that belongs to another build', () => {
    const t = optionTableOf('v-test', rows);
    const p = { count: 3, datasetVersion: 'v-test' } as ScenarioParcels;
    expect(optionTableProblem(t, p)).toBeNull();
    expect(optionTableProblem(t, { ...p, count: 4 })).toMatch('3 rows');
    expect(optionTableProblem(t, { ...p, datasetVersion: 'other' })).toMatch('dataset v-test');
  });
});
