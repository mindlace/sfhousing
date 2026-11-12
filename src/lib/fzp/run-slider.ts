import { medianRank } from '$lib/sim/scenario/band';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The seed to request for a tick: null (the representative, clean URL) at the median. */
export function requestSeed(ranks: readonly number[], position: number): number | null {
  return position === medianRank(ranks.length) ? null : ranks[position];
}

/** The tick of the run on screen, or null when it is not one of the ranked runs. */
export function positionOfShown(
  ranks: readonly number[],
  seed: number | null,
  representative: boolean
): number | null {
  if (representative) return medianRank(ranks.length);
  const at = ranks.indexOf(seed as number);
  return at < 0 ? null : at;
}

const STEPS: Record<string, number> = {
  ArrowUp: -1,
  ArrowRight: -1,
  ArrowDown: 1,
  ArrowLeft: 1,
  PageUp: -10,
  PageDown: 10
};

/** The position a key moves to, or null when the key is not a slider key. */
export function stepPosition(key: string, position: number | null, n: number): number | null {
  const from = position ?? medianRank(n);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  const step = STEPS[key];
  return step === undefined ? null : clamp(from + step, 0, n - 1);
}

/** The tick under a pointer at `y` on a track spanning `top` to `top + height`. */
export function positionAt(y: number, top: number, height: number, n: number): number {
  return clamp(Math.round(((y - top) / height) * (n - 1)), 0, n - 1);
}

export function runValueText(
  ranks: readonly number[],
  position: number | null,
  shownSeed: number | null
): string {
  if (position === null) return `Run ${shownSeed}, not one of the ${ranks.length} ranked runs`;
  return `Run ${ranks[position]}, rank ${position + 1} of ${ranks.length}`;
}
