// G4: limits from what is bought.
import { STORIES_MAX } from '$lib/plan/constants';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import { PRESETS } from '$lib/sim-page/timing';
import { MAX_BANDS, OPEN_REACH_M } from '$lib/sim-page/transit-edit';
import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import { NODES } from './catalogue/nodes';
import { finished } from './ladder';
import type { GameState } from './state';
import type { TreeNode } from './tree';

export interface Hands {
  radiusPx: number;
  lingerMs: number;
  auto: boolean;
}

export interface Limits {
  open: boolean;
  presets: ReadonlySet<string>;
  measures: ReadonlySet<string>;
  stops: ReadonlySet<StopType>;
  bands: number;
  stories: number;
  reachM: number;
  custom: boolean;
  hands: Hands;
}

export const BASE_HANDS: Hands = Object.freeze({ radiusPx: 48, lingerMs: 4000, auto: false });

export const FREE_MEASURES: readonly string[] = Object.freeze(['state-off', 'federal-credits-off']);

/** The floor once a stop type is bought: the editor's own defaults. */
export const START_BANDS = 1;
/** The lowest band of DEFAULT_BANDS (src/lib/sim-page/policy.ts:75-78). */
export const START_STORIES = 4;
/** NEW_BAND_STEP_M and DEFAULT_BANDS' inner distance (src/lib/sim-page/transit-edit.ts:23). */
export const START_REACH_M = 402;

/** The funding preset ids fundingPresets() writes (funding-presets.ts:289-487). */
export const FUNDING_PRESET_IDS: readonly string[] = Object.freeze([
  'housing-bond',
  'general-revenue',
  'htf-2026',
  'revolving-fund',
  'public-bank',
  'state-bond-2026',
  'state-off',
  'state-double',
  'federal-support',
  'federal-credits-off',
  'regional-bond'
]);

export const OPEN_LIMITS: Limits = Object.freeze({
  open: true,
  presets: new Set<string>(PRESETS.map((p) => p.id)),
  measures: new Set<string>(FUNDING_PRESET_IDS),
  stops: new Set<StopType>(STOP_TYPES),
  bands: MAX_BANDS,
  stories: STORIES_MAX,
  reachM: OPEN_REACH_M,
  custom: true,
  hands: BASE_HANDS
});

export function limitsOf(s: GameState, nodes: readonly TreeNode[] = NODES): Limits {
  const presets = new Set<string>();
  const measures = new Set<string>();
  const stops = new Set<StopType>();
  let bands = 0;
  let stories = 0;
  let reachM = 0;
  let { radiusPx, lingerMs, auto } = BASE_HANDS;
  for (const node of nodes) {
    const level = Math.min(s.bought[node.id] ?? 0, node.levels.length);
    for (let i = 0; i < level; i++) {
      const g = node.levels[i].grant;
      if (g.tag === 'preset') presets.add(g.preset);
      else if (g.tag === 'measure') measures.add(g.preset);
      else if (g.tag === 'stop') stops.add(g.stop);
      else if (g.tag === 'bands') bands = Math.max(bands, g.max);
      else if (g.tag === 'stories') stories = Math.max(stories, g.max);
      else if (g.tag === 'reach') reachM = Math.max(reachM, g.maxM);
      else if (g.what === 'radius') radiusPx = Math.max(radiusPx, g.value);
      else if (g.what === 'linger') lingerMs = Math.max(lingerMs, g.value);
      else auto = true;
    }
  }
  const done = finished(s);
  if (done) {
    for (const t of STOP_TYPES) stops.add(t);
    presets.add('observed');
  }
  const transit = done
    ? { bands: MAX_BANDS, stories: STORIES_MAX, reachM: OPEN_REACH_M }
    : stops.size === 0
      ? { bands: 0, stories: 0, reachM: 0 }
      : {
          bands: Math.min(MAX_BANDS, Math.max(START_BANDS, bands)),
          stories: Math.min(STORIES_MAX, Math.max(START_STORIES, stories)),
          reachM: Math.min(OPEN_REACH_M, Math.max(START_REACH_M, reachM))
        };
  return {
    open: false,
    presets,
    measures,
    stops,
    ...transit,
    custom: done,
    hands: { radiusPx, lingerMs, auto }
  };
}

const TAGS: Record<PolicyKind, readonly Policy['where']['tag'][]> = {
  zoning: ['transit', 'painted', 'category'],
  permitting: ['routes'],
  money: ['baseline', 'fund', 'terms']
};

export function within(kind: PolicyKind, p: Policy, l: Limits): boolean {
  if (l.open) return true;
  if (!TAGS[kind].includes(p.where.tag)) return false;
  switch (p.where.tag) {
    case 'painted':
      return false;
    case 'category':
      return l.stops.size > 0;
    case 'transit':
      return l.stops.size > 0 && p.where.stopTypes.every((t) => l.stops.has(t));
    case 'routes':
      return (
        p.preset !== null &&
        l.presets.has(p.preset) &&
        (l.custom ||
          p.spans.every(
            (s) =>
              s.what.tag !== 'timing' ||
              (s.what.set.edits.length === 0 && s.what.set.routeShares === null)
          ))
      );
    case 'baseline':
    case 'fund':
    case 'terms':
      return (
        isGiven(p) &&
        (l.measures.has(p.preset as string) ||
          (FREE_MEASURES.includes(p.preset as string) && l.measures.size > 0))
      );
  }
}

const KINDS: readonly PolicyKind[] = ['zoning', 'permitting', 'money'];

export function runnable(doc: SimPolicy4, l: Limits): SimPolicy4 {
  if (l.open) return doc;
  const kinds = { ...doc.kinds };
  let changed = false;
  for (const kind of KINDS) {
    const list = doc.kinds[kind];
    const kept = list.filter((p) => within(kind, p, l));
    if (kept.length !== list.length) {
      kinds[kind] = kept;
      changed = true;
    }
  }
  return changed ? { ...doc, kinds } : doc;
}

/** A money policy made from a funding preset: its `preset` is the preset's id. */
export function isGiven(p: Policy): boolean {
  return (
    typeof p.preset === 'string' &&
    (p.where.tag === 'fund' || p.where.tag === 'baseline' || p.where.tag === 'terms')
  );
}
