/**
 * Rules and custom brushes in words: the card summary ("Up to 6 stories within 402 m · Near
 * Muni Metro · 1,204 lots"; "Allow 8 stories · 3 strokes · 52 lots"), the undo label of a change
 * ("Allowed up to 6 stories near Muni Metro"), and why a transit rule cannot be added. Pure TS.
 */
import type { BrushCatalog, StopType } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import { count, lotsText, type LotStatus, type PaintRow } from '$lib/paint/rows';
import {
  bandsInnermostFirst,
  customQuery,
  queryKey,
  ruleQueries,
  type CustomBrush,
  type SimPolicy,
  type ZoningRule
} from './policy';
import { ERASE_LABEL, strokeLabel } from './stroke-adapter';

export { count, lotsText, type LotStatus };

export const STOP_LABELS: Record<StopType, string> = {
  regionalRail: 'Regional rail (BART, Caltrain)',
  metro: 'Muni Metro',
  rapidBus: 'Muni Rapid bus',
  frequentBus: 'Frequent bus (6+ trips an hour)'
};
/** Short stop names for summaries and labels. */
const STOP_SHORT: Record<StopType, string> = {
  regionalRail: 'regional rail',
  metro: 'Muni Metro',
  rapidBus: 'Rapid bus',
  frequentBus: 'frequent bus'
};

/**
 * Why a transit rule cannot be added: the catalog is still loading (undefined), unavailable
 * (null), or the dataset lacks transit data. Null when it can be added.
 */
export function transitUnavailable(catalog: BrushCatalog | null | undefined): string | null {
  if (catalog === undefined) return 'Loading brush data…';
  if (catalog === null) return "Brush data isn't available right now.";
  if (!catalog.has.transit) return 'This dataset has no transit data.';
  return null;
}

const nf = new Intl.NumberFormat('en-US');

/** "a, b and c"; past `max` items, "a, b and 3 more". */
function list(items: string[], max = 3): string {
  const shown =
    items.length > max ? [...items.slice(0, max - 1), `${items.length - max + 1} more`] : items;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const storiesText = (n: number) => count(n, 'story', 'stories');

const stopsTarget = (types: StopType[]) => list(types.map((t) => STOP_SHORT[t]));

/** The stops a rule applies near, in words: "Muni Metro", "regional rail and Muni Metro". */
export const ruleTarget = (r: ZoningRule): string => stopsTarget(r.stopTypes);

/** The rule's effect: "Up to 6 stories within 402 m, 4 stories within 805 m". */
function ruleEffect(r: ZoningRule): string {
  const bands = bandsInnermostFirst(r.bands).map(
    (b) => `${storiesText(b.stories)} within ${nf.format(b.maxM)} m`
  );
  return `Up to ${bands.join(', ')}`;
}

/** The rule in words, without its lot count: effect · target. */
export function ruleHead(r: ZoningRule): string {
  return `${ruleEffect(r)} · Near ${stopsTarget(r.stopTypes)}`;
}

/** The custom brush in words, without its lot count: "Allow 8 stories · 3 strokes". */
export function customHead(b: CustomBrush): string {
  const what = b.kind === 'paint' ? `Allow ${storiesText(b.stories)}` : 'Erase';
  return `${what} · ${count(b.strokes.length, 'stroke', 'strokes')}`;
}

/** The rule card's one line: effect · target · lots. */
export function ruleSummary(r: ZoningRule, lotsText: string): string {
  return `${ruleHead(r)} · ${lotsText}`;
}

/** The custom card's one line: "Allow 8 stories · 3 strokes · 52 lots". */
export function customSummary(b: CustomBrush, lotsText: string): string {
  return `${customHead(b)} · ${lotsText}`;
}

/** The undo label of adding this rule ("Allowed up to 6 stories near Muni Metro"). */
export function ruleChangeLabel(r: ZoningRule): string {
  const top = Math.max(...r.bands.map((b) => b.stories));
  return `Allowed up to ${storiesText(top)} near ${stopsTarget(r.stopTypes)}`;
}

/** The undo label of a custom brush ("Allowed 8 stories"; "Erased custom zoning"). */
export function customChangeLabel(b: CustomBrush): string {
  return b.kind === 'paint' ? strokeLabel(b.stories) : ERASE_LABEL;
}

/**
 * A rule's lots: found (the union over its queries), finding (unanswered, or parked by a
 * `no-session` answer until the next session), or failed with the keys to retry.
 */
export function ruleLotStatus(
  r: ZoningRule,
  result: (key: string) => BrushLotsResult | undefined
): LotStatus {
  return statusOf(ruleQueries(r).map(queryKey), result);
}

/** A custom brush's lots (its strokes' query), as `ruleLotStatus`. */
export function customLotStatus(
  b: CustomBrush,
  result: (key: string) => BrushLotsResult | undefined
): LotStatus {
  return statusOf([queryKey(customQuery(b))], result);
}

function statusOf(keys: string[], result: (key: string) => BrushLotsResult | undefined): LotStatus {
  const results = keys.map((k) => result(k));
  const failed = keys.filter((_, i) => {
    const r = results[i];
    return r !== undefined && !r.ok && r.reason !== 'no-session';
  });
  if (failed.length > 0) return { kind: 'failed', keys: failed };
  if (results.every((r): r is Extract<BrushLotsResult, { ok: true }> => r?.ok === true)) {
    return { kind: 'found', lots: new Set(results.flatMap((r) => r.lots)).size };
  }
  return { kind: 'finding' };
}

/** /sim's Paint rows: one per custom brush, in policy order. */
export function simPaintRows(
  p: SimPolicy,
  result: (key: string) => BrushLotsResult | undefined
): PaintRow[] {
  return p.custom.map((b) => ({
    id: b.id,
    kind: b.kind,
    stories: b.kind === 'paint' ? b.stories : null,
    strokes: b.strokes.length,
    lots: customLotStatus(b, result)
  }));
}
