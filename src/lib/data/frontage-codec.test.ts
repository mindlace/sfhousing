import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { idsHash } from './column-file';
import { CORNER_ROW, DEEP_ROW, frontageTiny } from './fixtures/frontage-tiny';
import { scenarioTiny } from './fixtures/scenario-tiny';
import {
  FrontageFormatError,
  STREET_CLASSES,
  decodeFrontagePayload,
  encodeFrontagePayload,
  frontingRows,
  readFrontage,
  type Frontage
} from './frontage-codec';

const tiny = scenarioTiny();
const good = frontageTiny(tiny);
const bytes = encodeFrontagePayload(good);

/** Byte offset of a named column in `bytes`. */
function columnAt(name: string): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + dv.getUint32(8, true))));
  return h.columns.find((c: { name: string }) => c.name === name).offset;
}
const corrupt = (patch: Partial<Frontage>) => ({ ...good, ...patch });

describe('sfh-frontage/1 codec', () => {
  it('round-trips and derives rowStart', () => {
    const d = decodeFrontagePayload(bytes, tiny);
    expect(d.rowStart[d.count]).toBe(d.frontSeg.length);
    expect(Array.from(d.rowStart)).toEqual(Array.from(good.rowStart));
    expect(encodeFrontagePayload(d)).toEqual(bytes);
    expect(d.idsHash).toBe(idsHash(tiny.id));
  });

  it('frontingRows selects by class or by name, with or without depth 1', () => {
    const d = decodeFrontagePayload(bytes, tiny);
    const byName = (n: string) => (s: number) => d.names[d.segName[s]] === n;
    expect(frontingRows(d, byName('MISSION ST'), 0)).toEqual([CORNER_ROW]);
    expect(frontingRows(d, byName('MISSION ST'), 1)).toEqual([CORNER_ROW, DEEP_ROW]);
    expect(frontingRows(d, (s) => STREET_CLASSES[d.segClass[s]] === 'residential', 0)).toEqual([
      CORNER_ROW
    ]);
    expect(frontingRows(d, () => false, 1)).toEqual([]);
  });

  it('refuses a parcels.bin it was not built for', () => {
    // Order mirrors the policy codec: datasetVersion, count, idsHash.
    expect(() => decodeFrontagePayload(bytes, { ...tiny, datasetVersion: 'fixture-9' })).toThrow(
      /datasetVersion/
    );
    const short = { ...tiny, count: tiny.count - 1, id: tiny.id.slice(0, -1) };
    expect(() => decodeFrontagePayload(bytes, short)).toThrow(
      `count ${tiny.count} is not parcels.bin's ${tiny.count - 1}`
    );
    expect(() => decodeFrontagePayload(bytes, { ...tiny, id: [...tiny.id].reverse() })).toThrow(
      /idsHash/
    );
    // One id changed, last and middle rows as well as index 0.
    for (const at of [0, 2, tiny.count - 1])
      expect(() =>
        decodeFrontagePayload(bytes, {
          ...tiny,
          id: tiny.id.map((x, i) => (i === at ? x + 'X' : x))
        })
      ).toThrow(/idsHash/);
  });

  it('refuses unsorted entries', () => {
    // Corner row entries are (seg 0, seg 2) at depth 0; swap them.
    const swapped = bytes.slice();
    const segAt = columnAt('frontSeg') + 2 * good.rowStart[CORNER_ROW];
    swapped[segAt] = 2;
    swapped[segAt + 2] = 0;
    expect(() => decodeFrontagePayload(swapped, tiny)).toThrow(/not sorted by \(depth, seg\)/);
  });

  it('refuses a segment at both depths and an entry total that is not the sum', () => {
    expect(() =>
      encodeFrontagePayload(
        corrupt({
          rowStart: Uint32Array.from([0, 0, 3, 3, 3, 3, 3]),
          frontSeg: Uint16Array.of(0, 2, 0),
          frontDepth: Uint8Array.of(0, 0, 1)
        })
      )
    ).toThrow(/segment 0 at both depths/);
    // A frontCount raised by one makes the sum exceed the entry columns.
    const more = bytes.slice();
    more[columnAt('frontCount') + 0] = 1;
    expect(() => decodeFrontagePayload(more, tiny)).toThrow(FrontageFormatError);
  });

  it('refuses a segCnn that is not ascending and out-of-range indices', () => {
    const cnn = bytes.slice();
    cnn[columnAt('segCnn') + 4] = 0; // segCnn[1] low byte 0x...: 1002 -> 1002 & ~0xff
    cnn[columnAt('segCnn') + 5] = 0;
    expect(() => decodeFrontagePayload(cnn, tiny)).toThrow(/segCnn\[1\] is not ascending/);
    const cls = bytes.slice();
    cls[columnAt('segClass')] = STREET_CLASSES.length;
    expect(() => decodeFrontagePayload(cls, tiny)).toThrow(/segClass\[0\]/);
    const seg = bytes.slice();
    seg[columnAt('frontSeg')] = 3;
    expect(() => decodeFrontagePayload(seg, tiny)).toThrow(/frontSeg\[0\]/);
    const depth = bytes.slice();
    depth[columnAt('frontDepth')] = 2;
    expect(() => decodeFrontagePayload(depth, tiny)).toThrow(/frontDepth\[0\]/);
    expect(() => encodeFrontagePayload(corrupt({ names: ['MISSION ST', 'FIXTURE AVE'] }))).toThrow(
      /sorted/
    );
  });

  it('surfaces a truncated buffer as FrontageFormatError', async () => {
    for (const cut of [5, 40, bytes.length - 1])
      expect(() => decodeFrontagePayload(bytes.subarray(0, cut), tiny)).toThrow(
        FrontageFormatError
      );
    await expect(readFrontage(deflateRawSync(bytes.subarray(0, 40)), tiny)).rejects.toThrow(
      FrontageFormatError
    );
  });

  it('readFrontage inflates a body and turns a corrupt deflate body into FrontageFormatError', async () => {
    expect((await readFrontage(deflateRawSync(bytes), tiny)).count).toBe(tiny.count);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(deflateRawSync(bytes)));
        c.close();
      }
    });
    expect((await readFrontage(stream, tiny)).count).toBe(tiny.count);
    const packed = new Uint8Array(deflateRawSync(bytes));
    packed.fill(0xff, 0, 8);
    await expect(readFrontage(packed, tiny)).rejects.toThrow(FrontageFormatError);
    await expect(readFrontage(packed, tiny)).rejects.toThrow(/not valid deflate-raw/);
  });
});
