import { describe, expect, it } from 'vitest';
import { createSound } from './sound';

describe('sound', () => {
  it('createSound throws until run-play writes it', () => {
    expect(() => createSound(() => false)).toThrow('not implemented');
  });
});
