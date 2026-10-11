import { FillRule, intersectD, type PathD, type PathsD } from 'clipper2-ts';
import { domainArea, fitSimpleRegions } from './domain';
import {
  ADU_EDGE_GAP_M,
  ADU_GROSS_M2,
  ADU_INSET_M,
  ADU_MAX_WIDTH_M,
  FTF_M,
  MIDRISE_STEPBACK_ABOVE,
  rulesFor,
  TOWER_COVERAGE,
  TOWER_INSET_M,
  TOWER_PLATE_MAX_M2,
  TOWER_PODIUM_STORIES
} from './constants';
import {
  canonicalRing,
  clipSlab,
  isRectangle,
  intersect,
  inset,
  keepPieces,
  largest,
  orientedRect,
  project,
  signedArea,
  totalArea
} from './poly';
import type { Site } from './site';
import type { ReplacementTypology, TypologyId } from './types';
import type { VarietyDraws } from './variety';

export interface MassPart {
  ring: PathD;
  baseM: number;
  /** Pre-parapet, unrounded. */
  topM: number;
  floors: number;
  /** True when the part reaches the top floor (it gets the parapet). */
  reachesTop: boolean;
}

export interface Massing {
  typology: TypologyId;
  stories: number;
  parts: MassPart[];
  /** Σ area × floors in local m², unrounded. */
  floorAreaM2: number;
}

/** 0.1 mm grid: keeps the final slab cut within T + 0.01 m² (coverage property). */
const SLAB_CUT_PRECISION = 4;

/** Top of floor k: g + (k − 1)·FTF_M. */
export function floorTop(typology: TypologyId, k: number): number {
  return rulesFor(typology).groundFtfM + (k - 1) * FTF_M;
}

/**
 * §4.6: F = Q if area(Q) ≤ target, else Q ∩ slab(h) with h found by bisection on
 * [0, half-extent of P along u] (Sutherland–Hodgman inside the loop). Keeps the largest h
 * whose area ≤ target; stops after 30 iterations or once target − area ≤ 0.01 m².
 * The final clip uses Clipper so concave sites split into clean pieces.
 */
export function baseFootprint(site: Site, target: number): PathsD {
  const { Q, P, c, u, v } = site;
  if (domainArea(Q) <= target)
    return Q.some((r) => signedArea(r) < 0) ? fitSimpleRegions(Q, site) : Q;
  if (Q.length === 1 && isRectangle(P) && isRectangle(Q[0])) {
    const pv = project(Q, c, v);
    return [canonicalRing(clipSlab(Q[0], c, u, target / (2 * (pv.max - pv.min))))];
  }
  const pu = project([P], c, u);
  const H = Math.max(-pu.min, pu.max);
  const slabArea = (h: number) => {
    let s = 0;
    for (const q of Q) s += signedArea(clipSlab(q, c, u, h));
    return s;
  };
  let lo = 0;
  let hi = H;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const a = slabArea(mid);
    if (a <= target) {
      lo = mid;
      if (target - a <= 0.01) break;
    } else {
      hi = mid;
    }
  }
  const pv = project([P], c, v);
  const slab = orientedRect(c, u, v, -lo, lo, pv.min - 1, pv.max + 1);
  return fitSimpleRegions(intersectD(Q, [slab], FillRule.NonZero, SLAB_CUT_PRECISION), site);
}

function part(
  ring: PathD,
  baseM: number,
  topM: number,
  floors: number,
  reachesTop: boolean
): MassPart {
  return { ring, baseM, topM, floors, reachesTop };
}

function finish(typology: TypologyId, stories: number, parts: MassPart[]): Massing {
  let fa = 0;
  for (const p of parts) fa += Math.abs(signedArea(p.ring)) * p.floors;
  return { typology, stories, parts, floorAreaM2: fa };
}

/** §4.7 massing for replacement typologies. Selection (§4.5) is separate: `selectTypology`. */
export function massTypology(
  site: Site,
  typology: ReplacementTypology,
  stories: number,
  draws: VarietyDraws
): Massing | null {
  const F = baseFootprint(site, rulesFor(typology).coverage * site.A);
  if (F.length === 0) return null;
  if (typology === 'midrise') return massMidrise(site, F, stories, draws);
  if (typology === 'tower') return massTower(site, F, stories, draws);
  const top = floorTop(typology, stories);
  return finish(
    typology,
    stories,
    F.map((r) => part(r, 0, top, stories, true))
  );
}

/** §4.7 midrise: floors 1–6 on F; 7–S on U = F inset by the stepback (or F if U < 0.4·F). */
function massMidrise(_site: Site, F: PathsD, stories: number, draws: VarietyDraws): Massing {
  const below = MIDRISE_STEPBACK_ABOVE;
  const topLow = floorTop('midrise', below);
  let U = keepPieces(inset(F, draws.stepbackM));
  if (totalArea(U) < 0.4 * totalArea(F)) U = F;
  const top = floorTop('midrise', stories);
  return finish('midrise', stories, [
    ...F.map((r) => part(r, 0, topLow, below, false)),
    ...U.map((r) => part(r, topLow, top, stories - below, true))
  ]);
}

/**
 * §4.7 tower: podium floors 1–5 on F; tower plate (rectangle on u/v, area At) slid along u,
 * clipped to F inset 1 m. Retry centred; else largest piece ≥ 0.5·At; else midrise at 12.
 */
function massTower(site: Site, F: PathsD, stories: number, draws: VarietyDraws): Massing | null {
  const { c, u, v } = site;
  const At = Math.min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE * site.A);
  const depth = Math.sqrt(At * draws.towerAspect);
  const width = Math.sqrt(At / draws.towerAspect);
  const fu = project(F, c, u);
  const s = Math.max(0, (fu.max - fu.min - depth) / 2 - TOWER_INSET_M);
  const Fin = inset(F, TOWER_INSET_M);
  const plate = (slide: number) => {
    const t = slide * s;
    const rect = orientedRect(c, u, v, t - depth / 2, t + depth / 2, -width / 2, width / 2);
    return keepPieces(intersect([rect], Fin));
  };
  let R = plate(draws.towerSlide);
  if (totalArea(R) < 0.9 * At) {
    R = plate(0);
    if (totalArea(R) < 0.9 * At) {
      const big = largest(R);
      if (big && Math.abs(signedArea(big)) >= 0.5 * At) R = [big];
      else return massTypology(site, 'midrise', 12, draws);
    }
  }
  const podium = TOWER_PODIUM_STORIES;
  const topPodium = floorTop('tower', podium);
  const top = floorTop('tower', stories);
  return finish('tower', stories, [
    ...F.map((r) => part(r, 0, topPodium, podium, false)),
    ...R.map((r) => part(r, topPodium, top, stories - podium, true))
  ]);
}

/** §4.8 ADU geometry (the open-area check lives in generate.ts: it needs the parcel). */
export function massAdu(site: Site, stories: number, draws: VarietyDraws): Massing | null {
  const { P, Q, c, u, v } = site;
  const Ap = ADU_GROSS_M2 / stories;
  const qv = project(Q, c, v);
  const width = Math.min(ADU_MAX_WIDTH_M, qv.max - qv.min - 2);
  if (!(width > 0)) return null;
  const depth = Ap / width;
  const pu = project([P], c, u);
  const [u0, u1] =
    draws.aduEnd === 1
      ? [pu.max - ADU_EDGE_GAP_M - depth, pu.max - ADU_EDGE_GAP_M]
      : [pu.min + ADU_EDGE_GAP_M, pu.min + ADU_EDGE_GAP_M + depth];
  const rect = orientedRect(c, u, v, u0, u1, -width / 2, width / 2);
  const fit = largest(fitSimpleRegions(intersect([rect], inset(site.domain, ADU_INSET_M)), site));
  if (!fit || Math.abs(signedArea(fit)) < 0.9 * Ap) return null;
  // §4.8: an ADU's floor area is its declared gross area G; the drawn footprint may be clipped to ≥ 90% of the plate.
  return {
    ...finish('adu', stories, [part(fit, 0, stories * FTF_M, stories, true)]),
    floorAreaM2: ADU_GROSS_M2
  };
}
