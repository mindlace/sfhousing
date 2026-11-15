import { describe, expect, it } from 'vitest';
import { F } from './test/fixtures';
import { NAME_KEY, isStrokeKeyOf, policyKey, spanKey, strokeKeyBase, strokeKeys } from './keys';

describe('item keys', () => {
  it('names items', () => {
    expect([NAME_KEY, policyKey('z1'), spanKey('z1', 20000)]).toEqual([
      'sim',
      'p:z1',
      's:20000:z1'
    ]);
  });
  it('pins the stroke digest (a change breaks every stored stroke key)', () => {
    expect(strokeKeyBase(F)).toBe('k:b9e72c9b421bb2613e2a6d2b06c47b89');
  });
  it('identical strokes get ~n', () => {
    const b = strokeKeyBase(F);
    const other = { ...F, radiusM: 10 };
    expect(strokeKeys([F, other, F, F])).toEqual([b, strokeKeyBase(other), `${b}~2`, `${b}~3`]);
    expect(isStrokeKeyOf(`${b}~2`, F)).toBe(true);
    expect(isStrokeKeyOf(`${b}~1`, F)).toBe(false);
  });
});
