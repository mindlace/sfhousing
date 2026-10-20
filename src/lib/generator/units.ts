import type { ParcelRecord } from '../data/parcel';
import { assembleSite } from './assemble';
import { occupiedArea, retainsCapacityAcrossHeights, unitsFor } from './bands';
import { compositionOptions, referenceComposition } from './compositions';
import type { CompositionDraws, OccupiedComposition } from './composition-types';
import { drawComposition } from './composition-variety';
import { MAX_STORIES, PLEX_MAX_UNITS } from './constants';
import type { MassOpts } from './massing';
import { roofAccents } from './roof';
import { selectTypology } from './select';
import { serializeComposition } from './serialize';
import { normaliseSite, type Site } from './site';
import type { GeneratedBuilding, ReplacementTypology, TypologyId } from './types';
import { drawVariety, type VarietyDraws } from './variety';

/**
 * Allowed unit-count drift (10%, at least 1) before a massing counts as approximate. Tier 4:
 * made up, and labelled as such. A display threshold that never changes a counted number
 * (spec §4.4 "unitsTolerance").
 */
export function unitsTolerance(units: number): number {
  return Math.max(1, Math.round(0.1 * units));
}

/** The unit count the building's own massing supports; a district sums over its lots. */
export function massedUnits(b: GeneratedBuilding): number {
  if (b.lots) return b.lots.reduce((s, l) => s + unitsFor(l.typology, l.floorAreaM2), 0);
  return unitsFor(b.typology, b.floorAreaM2);
}

/** True when the massing cannot carry the building's recorded unit count within tolerance. */
export function massingApproximate(b: GeneratedBuilding): boolean {
  return Math.abs(massedUnits(b) - b.units) > unitsTolerance(b.units);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** I10 order, the tie-break between candidates of equal stories. */
const TYPOLOGY_ORDER: readonly TypologyId[] = [
  'adu',
  'plex',
  'walkup',
  'podium',
  'midrise',
  'tower'
];

type Typ = { typology: ReplacementTypology; stories: number };

export interface MassingCandidate {
  ref: OccupiedComposition;
  /** Units the reference holds: `unitsFor(typology, round1(occupiedArea(bands)))`. */
  cap: number;
  /** The `referenceComposition` inputs that built `ref`; footprint scaling reuses its `opts`. */
  build: Typ & { opts?: MassOpts };
}

/** §4.3: a plex cannot hold more than PLEX_MAX_UNITS, so larger projects use a walkup. */
function promote(t: { typology: TypologyId; stories: number }, U: number): Typ {
  // Every caller passes selectTypology(…, existingUnits = 0), which returns 'plex' where it
  // would otherwise return 'adu' (select.ts:25), so 'adu' never arrives; the guard only narrows.
  const typology = t.typology === 'adu' ? 'plex' : t.typology;
  if (typology === 'plex' && U > PLEX_MAX_UNITS) return { typology: 'walkup', stories: t.stories };
  return { typology, stories: t.stories };
}

/** §4.3: the typology for a stated story count when the lot-area cap chain would cut it. */
function uncappedTypology(S: number, A: number): ReplacementTypology {
  if (S >= 13) return A >= 1500 ? 'tower' : 'midrise';
  if (S >= 8) return 'midrise';
  return 'podium';
}

const capOf = (ref: OccupiedComposition) => unitsFor(ref.typology, round1(occupiedArea(ref.bands)));

/**
 * §4.3 candidate references for `U` units. `bound.stories` is a valid stated story count (one
 * candidate at most); `bound.maxStories` is the already-capped `Smax` searched over `1..Smax`.
 * Ordered by ascending stories, then I10 order. Internal: a test seam, not exported from index.
 */
export function massingCandidates(
  site: Site,
  U: number,
  draws: VarietyDraws,
  bound: { stories: number } | { maxStories: number }
): MassingCandidate[] {
  if ('stories' in bound) {
    const S = bound.stories;
    const t = selectTypology(S, site.A, 0);
    const typology = t.stories === S ? promote(t, U).typology : uncappedTypology(S, site.A);
    const opts = { fallbackStories: S };
    let build: MassingCandidate['build'] = { typology, stories: S, opts };
    let ref = referenceComposition(site, typology, S, draws, opts);
    if (!ref && typology !== 'walkup') {
      build = { typology: 'walkup', stories: S, opts };
      ref = referenceComposition(site, 'walkup', S, draws, opts);
    }
    return ref ? [{ ref, cap: capOf(ref), build }] : [];
  }
  const out: MassingCandidate[] = [];
  const tried = new Set<string>();
  const seen = new Set<string>();
  for (let S = 1; S <= bound.maxStories; S++) {
    const t = promote(selectTypology(S, site.A, 0), U);
    // identical inputs give identical references, so each distinct input is built once
    const input = `${t.typology}:${t.stories}`;
    if (tried.has(input)) continue;
    tried.add(input);
    const ref = referenceComposition(site, t.typology, t.stories, draws);
    if (!ref) continue;
    const key = `${ref.typology}:${ref.stories}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, cap: capOf(ref), build: t });
  }
  return out.sort(
    (a, b) =>
      a.ref.stories - b.ref.stories ||
      TYPOLOGY_ORDER.indexOf(a.ref.typology) - TYPOLOGY_ORDER.indexOf(b.ref.typology)
  );
}

/** §4.4 cases 1-3 over candidates already in (stories, I10) order; first wins every tie. */
function chooseCandidate(
  candidates: readonly MassingCandidate[],
  U: number
): { candidate: MassingCandidate; undershoot: boolean } | null {
  if (!candidates.length) return null;
  const tol = unitsTolerance(U);
  let best: MassingCandidate | null = null;
  for (const c of candidates)
    if (Math.abs(c.cap - U) <= tol && (!best || Math.abs(c.cap - U) < Math.abs(best.cap - U)))
      best = c;
  if (best) return { candidate: best, undershoot: false };
  const over = candidates.find((c) => c.cap > U);
  if (over) return { candidate: over, undershoot: false };
  for (const c of candidates) if (!best || c.cap > best.cap) best = c;
  return { candidate: best!, undershoot: true };
}

/**
 * §4.4 acceptance in the k = 1 composition walk: massed units within `unitsTolerance(U)` of `U`.
 * Ledger ruling: a massing holding no unit (massed < 1) never qualifies, as in `generate`.
 * Internal: a test seam, not exported from index.
 */
export function withinTolerance(massed: number, U: number): boolean {
  return massed >= 1 && Math.abs(massed - U) <= unitsTolerance(U);
}

/** Internal numerical setting: bisection steps for the footprint scale `k`. */
const SCALE_ITERATIONS = 20;

/**
 * §4.4 footprint scaling (k < 1): bisects the coverage scale `k` over (0, 1), rebuilding the
 * candidate's reference as its own typology and stories, toward the smallest `k` that still
 * masses `U`. A scaled reference that is null or changes typology is too small. Returns the
 * evaluated reference with the smallest |massed - U|, ties to the smaller `k`; it is always
 * 'simple'.
 */
function scaleFootprint(
  site: Site,
  c: MassingCandidate,
  U: number,
  draws: VarietyDraws
): OccupiedComposition | null {
  // "The reference is rebuilt": a tower that fell back to midrise is rebuilt as that midrise.
  // Rebuilt from the tower inputs, a smaller plate fits again at k < 1, and every scaled
  // reference would be a tower, i.e. a typology change that counts as too small.
  const typology = c.ref.typology as ReplacementTypology; // candidates are never 'adu'
  const { stories } = c.ref;
  const { opts } = c.build;
  let lo = 0;
  let hi = 1;
  let best: { k: number; massed: number; ref: OccupiedComposition } | null = null;
  for (let i = 0; i < SCALE_ITERATIONS; i++) {
    const k = (lo + hi) / 2;
    const ref = referenceComposition(site, typology, stories, draws, { ...opts, coverageScale: k });
    if (!ref || ref.typology !== c.ref.typology) {
      lo = k;
      continue;
    }
    const massed = capOf(ref);
    const d = Math.abs(massed - U);
    const bestD = best ? Math.abs(best.massed - U) : Infinity;
    // ledger ruling: a massing holding no unit is never the pick, however close to U
    if (massed >= 1 && (d < bestD || (d === bestD && k < best!.k))) best = { k, massed, ref };
    if (massed === U) break;
    if (massed > U) hi = k;
    else lo = k;
  }
  return best ? best.ref : null;
}

/** Same rules as `generateForUnits`, with injected draws (test seam). */
export function generateForUnitsWith(
  parcels: ParcelRecord | ParcelRecord[],
  units: number,
  maxStories: number,
  draws: VarietyDraws,
  compositionDraws: CompositionDraws,
  stories?: number
): GeneratedBuilding | null {
  // §4.2 step 1: units
  if (!Number.isFinite(units)) return null;
  const U = Math.floor(units);
  if (U < 1) return null;

  // §4.2 step 2: an invalid stated story count is treated as absent, never clamped
  let bound: { stories: number } | { maxStories: number };
  const S = Number.isFinite(stories) ? Math.floor(stories!) : NaN;
  if (S >= 1 && S <= MAX_STORIES) bound = { stories: S };
  else {
    if (!Number.isFinite(maxStories) || Math.floor(maxStories) < 1) return null;
    bound = { maxStories: Math.min(Math.floor(maxStories), MAX_STORIES) };
  }

  // §4.2 steps 4-7: parcels, anchor, site polygon, site
  const assembled = assembleSite(Array.isArray(parcels) ? parcels : [parcels]);
  if (!assembled) return null;
  const { anchor, polygon } = assembled;
  const site = normaliseSite(polygon, draws.edgeInsetM);
  if (!site) return null;

  // §4.3-4.4: candidates and choice
  const choice = chooseCandidate(massingCandidates(site, U, draws, bound), U);
  if (!choice) return null;
  const ref = choice.candidate.ref;

  // §4.4 composition (k = 1): the generateDetailed loop without the I8 gains logic
  const record: ParcelRecord = { ...anchor, polygon };
  const serialise = (candidate: OccupiedComposition, reference: OccupiedComposition) => {
    const output = serializeComposition(
      record,
      site,
      candidate,
      roofAccents(site, candidate, compositionDraws, draws.parapetM),
      compositionDraws.tone,
      reference
    );
    if (!output || !output.parts.length) return null;
    return { candidate, output, massed: unitsFor(candidate.typology, round1(output.area)) };
  };
  type Option = NonNullable<ReturnType<typeof serialise>>;
  const options: Option[] = [];
  let accepted: Option | null = null;
  for (const candidate of compositionOptions(site, ref, compositionDraws)) {
    const option = serialise(candidate, ref);
    if (!option) continue;
    if (
      candidate.family !== 'simple' &&
      !retainsCapacityAcrossHeights(candidate, ref, option.output.area, option.output.growth)
    )
      continue;
    if (withinTolerance(option.massed, U)) {
      accepted = option;
      break;
    }
    options.push(option);
  }
  if (!accepted) {
    // The option with the smallest |massed - U|, ties to family order (ledger rulings). On an
    // undershoot this is §4.4's "most massed units" whenever no family exceeds U; a family
    // massing far above U is not taken over one closer to it. Otherwise it is the k = 1
    // fallback, which footprint scaling must beat.
    // Options massing no unit are skipped while any option holds one, so U = 1 never draws a
    // 0-unit volume that `massingApproximate` would call matched.
    const holdsUnit = options.some((o) => o.massed >= 1);
    for (const o of options) {
      if (holdsUnit && o.massed < 1) continue;
      if (!accepted || Math.abs(o.massed - U) < Math.abs(accepted.massed - U)) accepted = o;
    }
    // §4.4 "if none qualifies … go to scaling": also when no k = 1 option serialised at all.
    // A scaled massing holding no unit never replaces the fallback (ledger ruling).
    if (!choice.undershoot) {
      const scaledRef = scaleFootprint(site, choice.candidate, U, draws);
      const scaled = scaledRef && serialise(scaledRef, scaledRef);
      if (
        scaled &&
        scaled.massed >= 1 &&
        (!accepted || Math.abs(scaled.massed - U) < Math.abs(accepted.massed - U))
      )
        accepted = scaled;
    }
  }
  if (!accepted) return null;

  const { candidate, output } = accepted;
  return {
    parcelId: anchor.id,
    source: 'pipeline',
    typology: candidate.typology,
    composition: candidate.family,
    parts: output.parts,
    stories: candidate.stories,
    units: U,
    floorAreaM2: round1(output.area),
    replacesExisting: true
  };
}

/**
 * T10: masses a real pipeline project from its recorded `units` (and `stories`, when known) on
 * the union of its parcels. The result's `units` is always `Math.floor(units)`, the record's
 * number (tier 0); the drawn volume only approximates it, and `massingApproximate` reports when
 * it falls outside `unitsTolerance` (±10%, at least 1 unit: a tier-4 display threshold, made
 * up and labelled as such). Ignores the I8 null rule and the parcels' existing development.
 *
 * Heights: floor-to-floor is 3.1 m over a 4.5 m ground floor, so a 65-story massing tops out
 * near 666 ft against a 650 ft height limit (+2.4%, plus a parapet of up to 1.2 m). That
 * overshoot is accepted: it is a visual effect of the tier-3 rule `stories = floor(ft / 10)`.
 *
 * Callers pass `seed = fnv1a32(projectId)`; it is normalised with `>>> 0`.
 */
export function generateForUnits(
  parcel: ParcelRecord | ParcelRecord[],
  units: number,
  maxStories: number,
  seed: number,
  stories?: number
): GeneratedBuilding | null {
  const s = seed >>> 0;
  return generateForUnitsWith(
    parcel,
    units,
    maxStories,
    drawVariety(s),
    drawComposition(s),
    stories
  );
}
