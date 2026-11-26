// Parts the LiDAR disputes (spec "Parts the LiDAR disputes"): each counted part's drawn top is
// compared with the LiDAR over the cells the part alone shows (its shape minus every taller part).
// Parts stay unshifted; the mask samples the raster at part + shift. Anything that cannot be
// compared (no registration, a tiered or small part, a lattice, no cells) is trusted.
import { BOXES } from '../../boxes-config.js';
import { area, difference, union } from '../../geom.js';
import { bboxOf, groundOf, subWindow } from './derive.js';
import { partTop, type Part } from './parts.js';
import { cellMask } from './raster.js';
import type { Footprint, Shift } from './register.js';
import type { RasterWindow } from './mosaic.js';

export interface PartVerdict {
  id: string;
  roofShape: string | null;
  areaM2: number;
  topM: number;
  /** Null: not eligible (tiered, or under stepMinAreaM2). */
  seenM2: number | null;
  raisedShare: number | null;
  /** Median raised LiDAR height; null when not compared. */
  lidarM: number | null;
  checked: boolean;
  disputed: boolean;
}

export interface PartsCheck {
  checked: number;
  disputed: number;
  rejected: boolean;
  /** In `counted` order. */
  parts: PartVerdict[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

function median(sorted: number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function checkParts(
  w: RasterWindow | null,
  fp: Footprint,
  shift: Shift | null,
  counted: Part[]
): PartsCheck {
  const tops = counted.map(partTop);
  const parts: PartVerdict[] = counted.map((p, i) => ({
    id: p.id,
    roofShape: p.roofShape,
    areaM2: area(p.shape),
    topM: tops[i],
    seenM2: null,
    raisedShare: null,
    lidarM: null,
    checked: false,
    disputed: false
  }));
  const ground = w && shift && shift.source !== 'none' ? groundOf(w, fp, shift) : null;
  if (!w || !shift || !ground) return { checked: 0, disputed: 0, rejected: false, parts };

  const { dx, dy } = shift;
  counted.forEach((p, i) => {
    const v = parts[i];
    const tiered =
      p.roofShape !== null && (BOXES.partTierShapes as readonly string[]).includes(p.roofShape);
    if (v.areaM2 < BOXES.stepMinAreaM2 || tiered) return;
    const taller = counted.filter((_, j) => tops[j] > tops[i]).map((q) => q.shape);
    const seen = taller.length > 0 ? difference(p.shape, union(taller)) : p.shape;
    v.seenM2 = area(seen);
    if (v.seenM2 < BOXES.stepMinAreaM2) return;

    const b = bboxOf(seen);
    const sub = subWindow(w, {
      x0: b.x0 + dx - 1,
      y0: b.y0 + dy - 1,
      x1: b.x1 + dx + 1,
      y1: b.y1 + dy + 1
    });
    if (!sub) {
      v.raisedShare = 0;
      return;
    }
    const mask = cellMask(sub, seen, dx, dy);
    let n = 0;
    const raised: number[] = [];
    for (let k = 0; k < mask.length; k++) {
      if (!mask[k]) continue;
      n++;
      const hag = sub.hag[k];
      if (Number.isFinite(hag) && !sub.veg[k] && hag >= BOXES.raisedHagM) {
        const h = hag + sub.ground[k] - ground.groundM;
        if (Number.isFinite(h)) raised.push(h);
      }
    }
    v.raisedShare = n > 0 ? raised.length / n : 0;
    if (v.raisedShare < BOXES.coverageMin || raised.length === 0) return;
    raised.sort((a, c) => a - c);
    v.lidarM = round2(median(raised));
    v.checked = true;
    v.disputed = Math.abs(v.topM - v.lidarM) > Math.max(BOXES.partTolM, BOXES.partTolFrac * v.topM);
  });

  const checked = parts.filter((v) => v.checked).length;
  const disputed = parts.filter((v) => v.disputed).length;
  const disputedShapes = counted.filter((_, i) => parts[i].disputed).map((p) => p.shape);
  const rejected =
    disputed > 0 &&
    area(union(disputedShapes)) >= BOXES.partRejectShare * area(union(counted.map((p) => p.shape)));
  return { checked, disputed, rejected, parts };
}
