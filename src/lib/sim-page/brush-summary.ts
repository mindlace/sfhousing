/**
 * Rules and custom brushes in words: the card summary ("Up to 8 stories · Arterials · 1,204
 * lots"; "Allow 8 stories · 3 strokes · 52 lots"), the undo label of a change ("Allowed up to 8
 * stories on arterials"), and the rule kinds "Add a rule" offers, with why one is unavailable.
 * Pure TS.
 */
import type { BrushCatalog, StopType, StreetClass } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import {
  bandsInnermostFirst,
  customQuery,
  queryKey,
  ruleQueries,
  type CustomBrush,
  type ZoningRule
} from './policy';
import { ERASE_LABEL, strokeLabel } from './stroke-adapter';

/** "Add a rule" kinds: a commercial corridor is a preset Street rule. */
export type RuleKind = 'transit' | 'street' | 'corridor';

export const RULE_KINDS: { id: RuleKind; label: string }[] = [
  { id: 'transit', label: 'Transit' },
  { id: 'street', label: 'Street' },
  { id: 'corridor', label: 'Commercial corridor' }
];

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

/** The street classes the Street form offers, in the codec's ids. */
export const FORM_STREET_CLASSES: { id: StreetClass; label: string }[] = [
  { id: 'major', label: 'Major streets' },
  { id: 'arterial', label: 'Arterials' },
  { id: 'collector', label: 'Collectors' },
  { id: 'residential', label: 'Residential streets' }
];
const CLASS_LABEL: Partial<Record<StreetClass, string>> = Object.fromEntries(
  FORM_STREET_CLASSES.map((c) => [c.id, c.label])
);
const classLabel = (c: StreetClass) => CLASS_LABEL[c] ?? `${c[0].toUpperCase()}${c.slice(1)}`;

export const CORRIDOR_TEXT = 'Arterial frontage zoned neighborhood commercial (NC or NCT)';

/** The form a saved rule opens in. */
export function ruleKindOf(r: ZoningRule): RuleKind {
  if (r.kind === 'street') return r.ncOnly ? 'corridor' : 'street';
  return r.kind;
}

/**
 * Why a kind cannot be added: the catalog is still loading (undefined), unavailable (null), or
 * the dataset lacks the kind's file. Null when the kind is available.
 */
export function kindUnavailable(
  kind: RuleKind,
  catalog: BrushCatalog | null | undefined
): string | null {
  if (catalog === undefined) return 'Loading brush data…';
  if (catalog === null) return "Brush data isn't available right now.";
  if (kind === 'transit' && !catalog.has.transit) return 'This dataset has no transit data.';
  if ((kind === 'street' || kind === 'corridor') && !catalog.has.frontage)
    return 'This dataset has no street frontage data.';
  return null;
}

const nf = new Intl.NumberFormat('en-US');
export const count = (k: number, one: string, many: string) =>
  `${nf.format(k)} ${k === 1 ? one : many}`;

/** "a, b and c"; past `max` items, "a, b and 3 more". */
function list(items: string[], max = 3): string {
  const shown =
    items.length > max ? [...items.slice(0, max - 1), `${items.length - max + 1} more`] : items;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const storiesText = (n: number) => count(n, 'story', 'stories');

/**
 * What a street rule covers ("Arterials and Market St"; "Commercial corridors"); `lower`
 * lower-cases the class words for mid-sentence use, never a street name.
 */
function streetTarget(r: Extract<ZoningRule, { kind: 'street' }>, lower = false): string {
  const cls = (c: string) => (lower ? c.toLowerCase() : c);
  if (r.ncOnly) return cls('Commercial corridors');
  const t = list([...r.classes.map((c) => cls(classLabel(c))), ...r.names]);
  return r.depth === 1 ? `${t}, one lot deep` : t;
}
const stopsTarget = (types: StopType[]) => list(types.map((t) => STOP_SHORT[t]));

/** The rule's effect: "Up to 8 stories"; transit "Up to 6 stories within 402 m, 4 stories …". */
function ruleEffect(r: ZoningRule): string {
  if (r.kind === 'street') return `Up to ${storiesText(r.stories)}`;
  const bands = bandsInnermostFirst(r.bands).map(
    (b) => `${storiesText(b.stories)} within ${nf.format(b.maxM)} m`
  );
  return `Up to ${bands.join(', ')}`;
}

/** The rule in words, without its lot count: effect · target. */
export function ruleHead(r: ZoningRule): string {
  const target = r.kind === 'street' ? streetTarget(r) : `Near ${stopsTarget(r.stopTypes)}`;
  return `${ruleEffect(r)} · ${target}`;
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

/** The undo label of adding this rule ("Allowed up to 8 stories on arterials"). */
export function ruleChangeLabel(r: ZoningRule): string {
  if (r.kind === 'street')
    return `Allowed up to ${storiesText(r.stories)} on ${streetTarget(r, true)}`;
  const top = Math.max(...r.bands.map((b) => b.stories));
  return `Allowed up to ${storiesText(top)} near ${stopsTarget(r.stopTypes)}`;
}

/** The undo label of a custom brush ("Allowed 8 stories"; "Erased custom zoning"). */
export function customChangeLabel(b: CustomBrush): string {
  return b.kind === 'paint' ? strokeLabel(b.stories) : ERASE_LABEL;
}

export type LotStatus =
  { kind: 'found'; lots: number } | { kind: 'finding' } | { kind: 'failed'; keys: string[] };

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

export function lotsText(s: LotStatus): string {
  return s.kind === 'found'
    ? count(s.lots, 'lot', 'lots')
    : s.kind === 'finding'
      ? 'Finding lots…'
      : "Couldn't find lots";
}
