/**
 * Painted-area rows for the Paint tab, mode-agnostic: a row is one painted height (or an erase)
 * with its strokes and lot status. The modes build the rows (`/sim`: `simPaintRows` in
 * sim-page/brush-summary.ts); this file imports nothing from sim-page, which imports from here.
 */

import type { PlanOp } from '$lib/plan';

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

/**
 * "Removed: 8 stories", "Removed: Erased": a Paint row's Remove, announced (and on `/sim` named by
 * Undo) the same way on both pages.
 */
export function removedLabel(r: Pick<PaintRow, 'kind' | 'stories'>): string {
  return `Removed: ${rowName(r)}`;
}

/** "3 strokes · 52 lots". */
export function rowMeta(r: PaintRow): string {
  return `${count(r.strokes, 'stroke', 'strokes')} · ${lotsText(r.lots)}`;
}

/** One row of `/`'s Paint tab: the plan's ops that group together. */
export interface PlanRowGroup {
  /** The row's first op id. */
  id: string;
  kind: 'paint' | 'erase';
  /** Null for erase. */
  stories: number | null;
  opIds: string[];
}

/**
 * Consecutive ops of one kind (and, for paint, one height) form a row; its id is its first op's.
 * This is the join rule of `/sim`'s `appendStroke` and `removeCustomBrush`
 * (sim-page/stroke-adapter.ts), so a row means the same on both pages: after a row is removed,
 * equal neighbours group into one row.
 */
export function planRowGroups(ops: readonly PlanOp[]): PlanRowGroup[] {
  const groups: PlanRowGroup[] = [];
  for (const op of ops) {
    const stories = op.kind === 'paint' ? op.stories : null;
    const last = groups.at(-1);
    if (last && last.kind === op.kind && last.stories === stories) last.opIds.push(op.id);
    else groups.push({ id: op.id, kind: op.kind, stories, opIds: [op.id] });
  }
  return groups;
}

/** The groups as rows, with each row's lot status from `status`. */
export function planPaintRows(
  groups: readonly PlanRowGroup[],
  status: (id: string) => LotStatus
): PaintRow[] {
  return groups.map((g) => ({
    id: g.id,
    kind: g.kind,
    stories: g.stories,
    strokes: g.opIds.length,
    lots: status(g.id)
  }));
}
