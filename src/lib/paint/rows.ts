/**
 * Painted-area rows for the Paint tab: a row is one painted height (or an erase) with its strokes
 * and lot status. Only `/sim` lists them (`simPaintRows` in sim-page/brush-summary.ts); this file
 * imports nothing from sim-page, which imports from here.
 */

const nf = new Intl.NumberFormat('en-US');
export const count = (k: number, one: string, many: string) =>
  `${nf.format(k)} ${k === 1 ? one : many}`;

export type LotStatus =
  { kind: 'found'; lots: number } | { kind: 'finding' } | { kind: 'failed'; keys: string[] };

export function lotsText(s: LotStatus): string {
  return s.kind === 'found'
    ? count(s.lots, 'lot', 'lots')
    : s.kind === 'finding'
      ? 'Finding lots…'
      : "Couldn't find lots";
}

export interface PaintRow {
  /** /sim: the custom brush id; /: the row's first op id. */
  id: string;
  kind: 'paint' | 'erase';
  /** Null for erase. */
  stories: number | null;
  strokes: number;
  lots: LotStatus;
}

/** "8 stories", "1 story", "Erased". */
export function rowName(r: Pick<PaintRow, 'kind' | 'stories'>): string {
  return r.kind === 'erase' || r.stories === null ? 'Erased' : count(r.stories, 'story', 'stories');
}

/** "Removed: 8 stories", "Removed: Erased": `/sim`'s Remove, announced and named by Undo. */
export function removedLabel(r: Pick<PaintRow, 'kind' | 'stories'>): string {
  return `Removed: ${rowName(r)}`;
}

/** "3 strokes · 52 lots". */
export function rowMeta(r: PaintRow): string {
  return `${count(r.strokes, 'stroke', 'strokes')} · ${lotsText(r.lots)}`;
}
