import type { PathD, PathsD } from 'clipper2-ts';
import {
  ADU_EDGE_GAP_M,
  ADU_GROSS_M2,
  ADU_INSET_M,
  ADU_MAX_WIDTH_M,
  FTF_M,
  rulesFor
} from './constants';
import {
  clipSlab,
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

/** Top of floor k: g + (k − 1)·FTF_M. */
export function floorTop(typology: TypologyId, k: number): number {
  return rulesFor(typology).groundFtfM + (k - 1) * FTF_M;
}

/**
 * §4.6: F = Q if area(Q) ≤ target, else Q ∩ slab(h) with h found by bisection on
 * [0, half-extent of P along u] (Sutherland–Hodgman inside the loop). Keeps the largest h
 * whose area ≤ target; stops after 30 iterations or once target − area ≤ 0.25 m².
 * The final clip uses Clipper so concave sites split into clean pieces.
 */
export function baseFootprint(site: Site, target: number): PathsD {
  const { Q, P, c, u, v } = site;
  if (totalArea(Q) <= target) return Q;
  const pu = project([P], c, u);
  const H = Math.max(-pu.min, pu.max);
  const slabArea = (h: number) => {
    let s = 0;
    for (const q of Q) s += Math.abs(signedArea(clipSlab(q, c, u, h)));
    return s;
  };
  let lo = 0;
  let hi = H;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const a = slabArea(mid);
    if (a <= target) {
      lo = mid;
      if (target - a <= 0.25) break;
    } else {
      hi = mid;
    }
  }
  const pv = project([P], c, v);
  const slab = orientedRect(c, u, v, -lo, lo, pv.min - 1, pv.max + 1);
  return keepPieces(intersect(Q, [slab]));
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

// Task 6 replaces these two stubs.
function massMidrise(_site: Site, F: PathsD, stories: number, _draws: VarietyDraws): Massing {
  const top = floorTop('midrise', stories);
  return finish(
    'midrise',
    stories,
    F.map((r) => part(r, 0, top, stories, true))
  );
}
function massTower(_site: Site, F: PathsD, stories: number, _draws: VarietyDraws): Massing {
  const top = floorTop('tower', stories);
  return finish(
    'tower',
    stories,
    F.map((r) => part(r, 0, top, stories, true))
  );
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
  const fit = largest(intersect([rect], inset([P], ADU_INSET_M)));
  if (!fit || Math.abs(signedArea(fit)) < 0.9 * Ap) return null;
  return finish('adu', stories, [part(fit, 0, stories * FTF_M, stories, true)]);
}
