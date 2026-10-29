import { describe, expect, it } from 'vitest';
import { encodeColumnFile, idsHash, inflateRawBody, openColumnFile } from './column-file';

const fail = (m: string): never => {
  throw new Error(m);
};
const bytes = encodeColumnFile('TEST', 1, {}, [{ name: 'a', type: 'u8', values: [1, 2] }], fail);

describe('column file', () => {
  it('round-trips columns of every type with 8-aligned offsets', () => {
    const b = encodeColumnFile(
      'TEST',
      1,
      { k: 'v' },
      [
        { name: 'a', type: 'u8', values: [0, 255] },
        { name: 'b', type: 'u16', values: [65535, 1] },
        { name: 'c', type: 'u32', values: [4294967295, 0] },
        { name: 'd', type: 'i32', values: [-2147483648, 7] }
      ],
      fail
    );
    const f = openColumnFile(b, 'TEST', 1, ['a', 'b', 'c', 'd'], fail);
    expect(f.header.k).toBe('v');
    expect(Array.from(f.read('a', 'u8', 2))).toEqual([0, 255]);
    expect(Array.from(f.read('b', 'u16', 2))).toEqual([65535, 1]);
    expect(Array.from(f.read('c', 'u32', 2))).toEqual([4294967295, 0]);
    expect(Array.from(f.read('d', 'i32', 2))).toEqual([-2147483648, 7]);
    for (const c of f.header.columns as { offset: number }[]) expect(c.offset % 8).toBe(0);
  });
  it('rejects an out-of-range value, a wrong magic, a missing column and a wrong length', () => {
    expect(() =>
      encodeColumnFile('TEST', 1, {}, [{ name: 'a', type: 'u8', values: [256] }], fail)
    ).toThrow(/does not fit u8/);
    expect(() => openColumnFile(bytes, 'NOPE', 1, ['a'], fail)).toThrow(/bad magic/);
    expect(() => openColumnFile(bytes, 'TEST', 1, ['a', 'z'], fail)).toThrow(/column z is missing/);
    expect(() => openColumnFile(bytes, 'TEST', 1, ['a'], fail).read('a', 'u8', 3)).toThrow(
      /bytes, want/
    );
  });
  it('reads from a view with an unaligned byteOffset', () => {
    const shifted = new Uint8Array(bytes.length + 3);
    shifted.set(bytes, 3);
    const f = openColumnFile(shifted.subarray(3), 'TEST', 1, ['a'], fail);
    expect(Array.from(f.read('a', 'u8', 2))).toEqual([1, 2]);
  });
  it('idsHash depends on order and content', () => {
    expect(idsHash(['a', 'b'])).not.toBe(idsHash(['b', 'a']));
    expect(idsHash(['a', 'b'])).toBe(idsHash(['a', 'b']));
  });
  it('inflateRawBody inflates raw deflate bytes', async () => {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(new Uint8Array(bytes));
    void w.close();
    const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    expect(Array.from(await inflateRawBody(packed))).toEqual(Array.from(bytes));
  });
});
