import { describe, expect, it } from 'vitest';
import { isFullHeightRoute } from './layout';

describe('isFullHeightRoute', () => {
  it.each([
    ['/', true],
    ['/p/[id]', true],
    ['/s/[id]', true],
    ['/sim', false],
    ['/sim/x', false],
    ['/lesscars', false],
    ['/fzp', false],
    ['/about', false],
    ['/attribution', false],
    [null, false]
  ])('%s -> %s', (id, expected) => {
    expect(isFullHeightRoute(id)).toBe(expected);
  });
});
