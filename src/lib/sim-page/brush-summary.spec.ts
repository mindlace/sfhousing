import { describe, expect, it } from 'vitest';
import { rowMeta } from '$lib/paint/rows';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { simPaintRows } from './brush-summary';
import { customQuery, DEFAULT_POLICY, queryKey, type CustomBrush } from './policy';

const stroke = { path: [[-122.4, 37.7]] as [number, number][], radiusM: 30 };
const strokes = (n: number) => Array.from({ length: n }, () => stroke);
const paint = (id: string, stories: number, n: number): CustomBrush => ({
  id,
  kind: 'paint',
  stories,
  strokes: strokes(n)
});
const erase = (id: string, n: number): CustomBrush => ({ id, kind: 'erase', strokes: strokes(n) });
const found = (n: number): BrushLotsResult => ({
  ok: true,
  lots: Array.from({ length: n }, (_, i) => `p${i}`) as never,
  points: new Float64Array()
});

describe('simPaintRows', () => {
  it('has one row per custom brush in order, with strokes and lot status', () => {
    const p = { ...DEFAULT_POLICY, custom: [paint('a', 8, 3), erase('b', 1)] };
    const rows = simPaintRows(p, (k) =>
      k === queryKey(customQuery(p.custom[0])) ? found(52) : undefined
    );
    expect(rows).toEqual([
      { id: 'a', kind: 'paint', stories: 8, strokes: 3, lots: { kind: 'found', lots: 52 } },
      { id: 'b', kind: 'erase', stories: null, strokes: 1, lots: { kind: 'finding' } }
    ]);
    expect(rowMeta(rows[0])).toBe('3 strokes · 52 lots');
  });
});
