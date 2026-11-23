import { describe, expect, it } from 'vitest';
import { gamePath, remixPath } from './navigate';

describe('gamePath', () => {
  it('is / at level 1', () => {
    expect(gamePath(1)).toBe('/');
  });

  it('is /sim at level 2', () => {
    expect(gamePath(2)).toBe('/sim');
  });

  it('is /sim at level 3', () => {
    expect(gamePath(3)).toBe('/sim');
  });

  it('is /sim at level 4', () => {
    expect(gamePath(4)).toBe('/sim');
  });

  it('is /sim at level 5', () => {
    expect(gamePath(5)).toBe('/sim');
  });
});

describe('remixPath', () => {
  it('is / for a plan', () => {
    expect(remixPath('plan')).toBe('/');
  });

  it('is /sim for a policy', () => {
    expect(remixPath('sim')).toBe('/sim');
  });
});
