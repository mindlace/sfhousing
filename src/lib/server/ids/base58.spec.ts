import { describe, it, expect } from 'vitest';
import { newId, isValidId, decodeId } from './base58';

describe('base58-id', () => {
  it('newId returns a base58 string that decodes to a v7 UUID', () => {
    const id = newId();
    expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // bitcoin base58 alphabet, no 0/O/I/l
    expect(id).not.toContain('-');
    expect(isValidId(id)).toBe(true);
    const uuid = decodeId(id);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('newId is unique across calls', () => {
    expect(newId()).not.toBe(newId());
  });

  it('isValidId rejects garbage, wrong-length, and non-v7', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('not!base58')).toBe(false); // ! is outside the alphabet
    expect(isValidId('1111')).toBe(false); // decodes to too-few bytes
    // a v4 uuid re-encoded as base58 must be rejected (version nibble != 7)
    const v4 = '00000000-0000-4000-8000-000000000000';
    const v4b58 = encodeForTest(v4);
    expect(isValidId(v4b58)).toBe(false);
  });
});

// local helper so the test does not depend on production encode internals
import bs58 from 'bs58';
import { parse as uuidParse } from 'uuid';
function encodeForTest(uuid: string): string {
  return bs58.encode(uuidParse(uuid));
}
