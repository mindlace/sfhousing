/**
 * Edits to a transit layer (a `ZoningRule`) that cannot produce an invalid rule: every value is
 * clamped to the range its neighbours leave it, so the band rule (`bandProblem`) holds after any
 * edit and the last stop type cannot be turned off. Every edit returns bands innermost first,
 * whatever order a saved rule had. Band indexes count innermost first. Pure TS.
 */
import { newOpId } from '$lib/brush/ids';
import { STORIES_MAX, STORIES_MIN } from '$lib/plan/constants';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import { ruleTarget } from './brush-summary';
import {
  DEFAULT_BANDS,
  bandsInnermostFirst,
  type SimPolicy,
  type TransitBand,
  type ZoningRule
} from './policy';

export const MAX_BANDS = 3;
/** Tier 4 (UI): the largest band distance the editor offers, 2 miles. */
export const BAND_MAX_M = 3219;
/** Tier 4: a new band sits a quarter mile beyond the outermost. */
export const NEW_BAND_STEP_M = 402;

/** "+ Transit layer": rail (BART, Caltrain) and Muni Metro, at DEFAULT_BANDS. */
export function newLayer(): ZoningRule {
  return {
    id: newOpId(),
    kind: 'transit',
    stopTypes: ['regionalRail', 'metro'],
    bands: DEFAULT_BANDS.map((b) => ({ ...b }))
  };
}

/** The policy with rule `next` replacing the rule of the same id, in the same place. */
export function replaceRule(p: SimPolicy, next: ZoningRule): SimPolicy {
  return { ...p, rules: p.rules.map((r) => (r.id === next.id ? next : r)) };
}

/** "Near Muni Metro". */
export function layerName(r: ZoningRule): string {
  return `Near ${ruleTarget(r)}`;
}

/** The swatch: the tallest band's stories. */
export function layerTop(r: ZoningRule): number {
  return Math.max(...r.bands.map((b) => b.stories));
}

/** A range whose floor wins if a saved rule left it upside down. */
const range = (min: number, max: number) => ({ min, max: Math.max(min, max) });

/** Bounds for band i (innermost first): stories between the outer band's and the inner band's. */
export function storiesRange(
  bands: readonly TransitBand[],
  i: number
): { min: number; max: number } {
  const s = bandsInnermostFirst(bands);
  return range(s[i + 1]?.stories ?? STORIES_MIN, s[i - 1]?.stories ?? STORIES_MAX);
}

/** Bounds for band i's distance: strictly between its neighbours, 1 m to BAND_MAX_M. */
export function distanceRange(
  bands: readonly TransitBand[],
  i: number
): { min: number; max: number } {
  const s = bandsInnermostFirst(bands);
  const inner = s[i - 1];
  const outer = s[i + 1];
  return range(inner ? inner.maxM + 1 : 1, outer ? outer.maxM - 1 : BAND_MAX_M);
}

const clamp = (n: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, Math.round(n)));

function setBand(
  r: ZoningRule,
  i: number,
  field: 'stories' | 'maxM',
  n: number,
  bounds: (bands: readonly TransitBand[], i: number) => { min: number; max: number }
): ZoningRule {
  const bands = bandsInnermostFirst(r.bands);
  if (!bands[i] || Number.isNaN(n)) return { ...r, bands };
  const value = clamp(n, bounds(bands, i));
  return { ...r, bands: bands.map((b, k) => (k === i ? { ...b, [field]: value } : b)) };
}

export function setBandStories(r: ZoningRule, i: number, n: number): ZoningRule {
  return setBand(r, i, 'stories', n, storiesRange);
}

export function setBandDistance(r: ZoningRule, i: number, m: number): ZoningRule {
  return setBand(r, i, 'maxM', m, distanceRange);
}

/** null when MAX_BANDS exist or the outermost is at BAND_MAX_M. New band: step out, same stories. */
export function addBand(r: ZoningRule): ZoningRule | null {
  const bands = bandsInnermostFirst(r.bands);
  const outer = bands.at(-1);
  if (!outer || bands.length >= MAX_BANDS || outer.maxM >= BAND_MAX_M) return null;
  const maxM = Math.min(outer.maxM + NEW_BAND_STEP_M, BAND_MAX_M);
  return { ...r, bands: [...bands, { maxM, stories: outer.stories }] };
}

/** null for the last band. */
export function removeBand(r: ZoningRule, i: number): ZoningRule | null {
  const bands = bandsInnermostFirst(r.bands);
  if (bands.length <= 1 || !bands[i]) return null;
  return { ...r, bands: bands.filter((_, k) => k !== i) };
}

/** null when it would turn off the last stop type; stop types kept in STOP_TYPES order. */
export function toggleStop(r: ZoningRule, t: StopType): ZoningRule | null {
  const on = r.stopTypes.includes(t);
  const stopTypes = STOP_TYPES.filter((s) => (s === t ? !on : r.stopTypes.includes(s)));
  if (stopTypes.length === 0) return null;
  return { ...r, stopTypes, bands: bandsInnermostFirst(r.bands) };
}
