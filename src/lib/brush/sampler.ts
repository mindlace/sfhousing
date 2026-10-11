import { PATH_MAX_POINTS, SF_BBOX, project, quantize } from '$lib/plan';

export type BrushTool = 'move' | 'paint' | 'erase';

export interface StrokeSampler {
  /** Returns true iff path() changed. Out-of-SF_BBOX points are ignored (false). */
  push(lng: number, lat: number): boolean;
  path(): [number, number][];
  /** kept.length === PATH_MAX_POINTS: commit path() now and start a new sampler at its last point. */
  full(): boolean;
}

/** Radial-filter spacing (spec §4.4): clamp(radiusM / 2, 2, 50) metres. */
export function spacingM(radiusM: number): number {
  return Math.min(50, Math.max(2, radiusM / 2));
}

const samePoint = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/**
 * Streaming radial filter (spec §4.4). The kept prefix only grows, so every path() is a prefix of
 * the final path() plus at most one live tail point. Douglas–Peucker is deliberately not used.
 */
export function createSampler(radiusM: number): StrokeSampler {
  const s2 = spacingM(radiusM) ** 2;
  const kept: [number, number][] = [];
  let lastXY: [number, number] = [0, 0];
  let latest: [number, number] | null = null;

  const tailLength = () => (latest && !samePoint(latest, kept[kept.length - 1]) ? 1 : 0);

  return {
    push(lng, lat) {
      const q: [number, number] = [quantize(lng), quantize(lat)];
      if (q[0] < SF_BBOX[0] || q[1] < SF_BBOX[1] || q[0] > SF_BBOX[2] || q[1] > SF_BBOX[3]) {
        return false;
      }
      if (kept.length === 0) {
        kept.push(q);
        lastXY = project(q[0], q[1]);
        latest = q;
        return true;
      }
      if (kept.length >= PATH_MAX_POINTS) return false;

      const prevLatest = latest;
      const prevTail = tailLength();
      const xy = project(q[0], q[1]);
      const dx = xy[0] - lastXY[0];
      const dy = xy[1] - lastXY[1];
      if (dx * dx + dy * dy >= s2) {
        kept.push(q);
        lastXY = xy;
        latest = q;
        return true;
      }
      latest = q;
      const tail = tailLength();
      if (tail !== prevTail) return true;
      return tail === 1 && !samePoint(q, prevLatest!);
    },
    path() {
      const out = kept.slice();
      if (tailLength()) out.push(latest!);
      return out;
    },
    full() {
      return kept.length >= PATH_MAX_POINTS;
    }
  };
}
