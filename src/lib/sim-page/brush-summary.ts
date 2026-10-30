/**
 * Brushes in words: the card summary ("Raise to 8 stories · Arterials · 1,204 lots · density
 * limits off"), the undo label of a change ("Raised arterials to 8 stories"), and the rule brush
 * kinds "Add a brush" offers, with why one is unavailable. Pure TS.
 */
import type { BrushCatalog, StopType, StreetClass } from '$lib/sim/levers/brushes';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import {
  brushQueries,
  protectQueryKeys,
  protectedLots,
  queryKey,
  type BrushMode,
  type SimPolicy,
  type ZoningBrush
} from './policy';
import { strokeLabel } from './stroke-adapter';

/** "Add a brush" kinds: a commercial corridor is a preset Street brush. */
export type RuleKind = 'transit' | 'street' | 'corridor' | 'area';

export const RULE_KINDS: { id: RuleKind; label: string }[] = [
  { id: 'transit', label: 'Transit' },
  { id: 'street', label: 'Street' },
  { id: 'corridor', label: 'Commercial corridor' },
  { id: 'area', label: 'Area' }
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

/** The form a saved rule brush opens in; null for freehand and erase. */
export function ruleKindOf(b: ZoningBrush): RuleKind | null {
  if (b.kind === 'street') return b.ncOnly ? 'corridor' : 'street';
  if (b.kind === 'transit' || b.kind === 'area') return b.kind;
  return null;
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

const VERB: Record<BrushMode, string> = { raise: 'Raise', lower: 'Lower', set: 'Set' };
const PAST: Record<BrushMode, string> = { raise: 'Raised', lower: 'Lowered', set: 'Set' };
/**
 * What a street brush covers ("Arterials and Market St"; "Commercial corridors"); `lower`
 * lower-cases the class words for mid-sentence use, never a street name.
 */
function streetTarget(b: Extract<ZoningBrush, { kind: 'street' }>, lower = false): string {
  const cls = (c: string) => (lower ? c.toLowerCase() : c);
  if (b.ncOnly) return cls('Commercial corridors');
  const t = list([...b.classes.map((c) => cls(classLabel(c))), ...b.names]);
  return b.depth === 1 ? `${t}, one lot deep` : t;
}
const areaTarget = (b: Extract<ZoningBrush, { kind: 'area' }>) =>
  list([...b.districts, ...b.neighborhoods]);
const stopsTarget = (types: StopType[]) => list(types.map((t) => STOP_SHORT[t]));

/** The brush in words, without its lot count. */
function describe(b: ZoningBrush): string[] {
  switch (b.kind) {
    case 'freehand':
      return [
        `${VERB[b.effect.mode]} to ${count(b.effect.stories, 'story', 'stories')}`,
        count(b.strokes.length, 'stroke', 'strokes')
      ];
    case 'erase':
      return ['Erase', count(b.strokes.length, 'stroke', 'strokes')];
    case 'transit': {
      const bands = [...b.bands]
        .sort((x, y) => x.maxM - y.maxM)
        .map((x) => `${count(x.stories, 'story', 'stories')} within ${nf.format(x.maxM)} m`);
      return [`${VERB[b.mode]} to ${bands.join(', ')}`, `Near ${stopsTarget(b.stopTypes)}`];
    }
    case 'street':
      return [
        `${VERB[b.effect.mode]} to ${count(b.effect.stories, 'story', 'stories')}`,
        streetTarget(b)
      ];
    case 'area':
      return [
        `${VERB[b.effect.mode]} to ${count(b.effect.stories, 'story', 'stories')}`,
        areaTarget(b)
      ];
  }
}

const densityOf = (b: ZoningBrush): boolean | null =>
  b.kind === 'erase' ? null : b.kind === 'transit' ? b.densityLimits : b.effect.densityLimits;

/** The card's line around its lot count: `head · {lots}` then ` · tail` when there is one. */
export function summaryParts(b: ZoningBrush): { head: string; tail: string | null } {
  const d = densityOf(b);
  return {
    head: describe(b).join(' · '),
    tail: d === null ? null : `density limits ${d ? 'on' : 'off'}`
  };
}

/** The card's one line: effect · target · lots · density limits. */
export function brushSummary(b: ZoningBrush, lotsText: string): string {
  const { head, tail } = summaryParts(b);
  return [head, lotsText, ...(tail === null ? [] : [tail])].join(' · ');
}

/** The undo label of adding this brush ("Raised arterials to 8 stories"). */
export function changeLabel(b: ZoningBrush): string {
  switch (b.kind) {
    case 'freehand':
      return strokeLabel(b.effect);
    case 'erase':
      return 'Erased brushed zoning';
    case 'transit':
      return `${PAST[b.mode]} lots near ${stopsTarget(b.stopTypes)}`;
    case 'street':
    case 'area': {
      const target = b.kind === 'street' ? streetTarget(b, true) : areaTarget(b);
      return `${PAST[b.effect.mode]} ${target} to ${count(b.effect.stories, 'story', 'stories')}`;
    }
  }
}

export type LotStatus =
  { kind: 'found'; lots: number } | { kind: 'finding' } | { kind: 'failed'; keys: string[] };

/**
 * A brush's lots: found (the union over its queries), finding (unanswered, or parked by a
 * `no-session` answer until the next session), or failed with the keys to retry.
 */
export function lotStatus(
  b: ZoningBrush,
  result: (key: string) => BrushLotsResult | undefined
): LotStatus {
  return statusOf(brushQueries(b).map(queryKey), result, (lots) => new Set(lots.flat()).size);
}

/**
 * The brushed protections' lots: the size of the compiled `protect.lots` (protect runs minus
 * unprotect runs) once every run is found; finding or failed as `lotStatus`.
 */
export function protectLotStatus(
  p: SimPolicy,
  result: (key: string) => BrushLotsResult | undefined
): LotStatus {
  return statusOf(protectQueryKeys(p), result, () => {
    const lots = protectedLots(p, (k) => {
      const r = result(k);
      return r?.ok ? r.lots : undefined;
    });
    return lots?.length ?? 0;
  });
}

function statusOf(
  keys: string[],
  result: (key: string) => BrushLotsResult | undefined,
  count: (lots: readonly (readonly string[])[]) => number
): LotStatus {
  const results = keys.map((k) => result(k));
  const failed = keys.filter((_, i) => {
    const r = results[i];
    return r !== undefined && !r.ok && r.reason !== 'no-session';
  });
  if (failed.length > 0) return { kind: 'failed', keys: failed };
  if (results.every((r): r is Extract<BrushLotsResult, { ok: true }> => r?.ok === true)) {
    return { kind: 'found', lots: count(results.map((r) => r.lots)) };
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
