import { describe, expect, it } from 'vitest';
import { count, lotsText, rowMeta, rowName, type PaintRow } from './rows';

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
