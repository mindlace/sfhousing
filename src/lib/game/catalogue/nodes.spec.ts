import { describe, expect, it } from 'vitest';
import { NODES } from './nodes';

describe('nodes', () => {
  it('starts empty', () => {
    expect(NODES).toEqual([]);
  });
});
