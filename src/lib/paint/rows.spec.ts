import { describe, expect, it } from 'vitest';
import type { PlanOp } from '$lib/plan';
import {
  count,
  lotsText,
  planPaintRows,
  planRowGroups,
  rowMeta,
  removedLabel,
  rowName,
  type PaintRow
} from './rows';

const row = (over: Partial<PaintRow> = {}): PaintRow => ({
  id: 'a',
  kind: 'paint',
  stories: 8,
  strokes: 3,
  lots: { kind: 'found', lots: 52 },
  ...over
});

describe('paint rows', () => {
  it('names rows by height or as erased', () => {
    expect(rowName({ kind: 'paint', stories: 8 })).toBe('8 stories');
    expect(rowName({ kind: 'paint', stories: 1 })).toBe('1 story');
    expect(rowName({ kind: 'erase', stories: null })).toBe('Erased');
  });

  it('names a removed row the same way on both pages', () => {
    expect(removedLabel({ kind: 'paint', stories: 8 })).toBe('Removed: 8 stories');
    expect(removedLabel({ kind: 'paint', stories: 1 })).toBe('Removed: 1 story');
    expect(removedLabel({ kind: 'erase', stories: null })).toBe('Removed: Erased');
  });

  it('describes strokes and lots', () => {
    expect(rowMeta(row())).toBe('3 strokes · 52 lots');
    expect(rowMeta(row({ strokes: 1, lots: { kind: 'found', lots: 1 } }))).toBe('1 stroke · 1 lot');
    expect(rowMeta(row({ lots: { kind: 'finding' } }))).toBe('3 strokes · Finding lots…');
    expect(rowMeta(row({ lots: { kind: 'failed', keys: ['k'] } }))).toBe(
      "3 strokes · Couldn't find lots"
    );
  });

  it('keeps the moved count and lotsText behaviour', () => {
    expect(count(1204, 'lot', 'lots')).toBe('1,204 lots');
    expect(lotsText({ kind: 'found', lots: 0 })).toBe('0 lots');
  });
});

describe('plan row groups', () => {
  const p = (id: string, stories: number): PlanOp => ({
    kind: 'paint',
    id,
    stories,
    radiusM: 20,
    path: [[-122.4, 37.7]]
  });
  const e = (id: string): PlanOp => ({ kind: 'erase', id, radiusM: 20, path: [[-122.4, 37.7]] });

  it('groups consecutive ops of one kind and (paint) one height, naming a row by its first op', () => {
    const groups = planRowGroups([p('a', 8), p('b', 8), p('c', 6), e('d'), e('f'), p('g', 8)]);
    expect(groups).toEqual([
      { id: 'a', kind: 'paint', stories: 8, opIds: ['a', 'b'] },
      { id: 'c', kind: 'paint', stories: 6, opIds: ['c'] },
      { id: 'd', kind: 'erase', stories: null, opIds: ['d', 'f'] },
      { id: 'g', kind: 'paint', stories: 8, opIds: ['g'] }
    ]);
  });

  it('is empty for no ops, and re-groups equal neighbours once a row between them is gone', () => {
    expect(planRowGroups([])).toEqual([]);
    const after = planRowGroups([p('a', 8), p('b', 8), p('g', 8)]);
    expect(after).toEqual([{ id: 'a', kind: 'paint', stories: 8, opIds: ['a', 'b', 'g'] }]);
  });

  it('turns groups into paint rows carrying each row status and stroke count', () => {
    const groups = planRowGroups([p('a', 8), p('b', 8), e('d')]);
    const rows = planPaintRows(groups, (id) =>
      id === 'a' ? { kind: 'found', lots: 5 } : { kind: 'finding' }
    );
    expect(rows).toEqual([
      { id: 'a', kind: 'paint', stories: 8, strokes: 2, lots: { kind: 'found', lots: 5 } },
      { id: 'd', kind: 'erase', stories: null, strokes: 1, lots: { kind: 'finding' } }
    ]);
  });
});
