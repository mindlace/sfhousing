import { describe, it, expect } from 'vitest';
import * as moved from '$lib/ids/base58';
import { newId, isValidId, decodeId } from './base58';

describe('server ids path', () => {
  it('re-exports the moved id helpers', () => {
    expect(newId).toBe(moved.newId);
    expect(isValidId).toBe(moved.isValidId);
    expect(decodeId).toBe(moved.decodeId);
  });
});
