/**
 * The live preview's layer on /sim (sim-ux plan 3, Task 4): while a Paint stroke is drawn, the
 * buildings its lots could hold show at full strength; on release they fade out (Set Policy's map
 * shows the present). Pure apart from the injected clock, frame loop and layer factory.
 */
import type { Layer } from '@deck.gl/core';
import type { ParcelId } from '$lib/data/parcel';
import type { PackedCell } from '$lib/map/types';

/** Tier 4 (engineering): on release the buildings fade linearly to 0 over this long. */
export const FEEDBACK_FADE_MS = 1500;

export interface PaintFeedbackDeps {
  /** The feedback overlay slot's layers ([] clears). */
  set(layers: Layer[]): void;
  /** The layer for `pack` at `opacity`, with layer id `id` (`sim-feedback-<n>`). */
  layer(pack: PackedCell, opacity: number, id: string): Layer;
  now(): number;
  raf(cb: () => void): number;
  cancelRaf(h: number): void;
  reducedMotion(): boolean;
}

/** The preview layer: one at a time; `live` replaces what is showing. */
export class PaintFeedback {
  #deps: PaintFeedbackDeps;
  #n = 0;
  #pack: PackedCell | null = null;
  #fading = false;
  #start = 0;
  #opacity = 1;
  #raf: number | null = null;
  #destroyed = false;

  constructor(deps: PaintFeedbackDeps) {
    this.#deps = deps;
  }

  get state(): 'none' | 'live' | 'fading' {
    if (this.#pack === null) return 'none';
    return this.#fading ? 'fading' : 'live';
  }

  /** Shows `pack` at full strength until released (replacing what is showing); null clears. */
  live(pack: PackedCell | null): void {
    if (this.#destroyed) return;
    if (pack === null) {
      this.clear();
      return;
    }
    this.#stop();
    this.#fading = false;
    this.#n++;
    this.#pack = pack;
    this.#opacity = 1;
    this.#deps.set([this.#deps.layer(pack, 1, `sim-feedback-${this.#n}`)]);
  }

  /**
   * Fades what is live linearly to nothing over FEEDBACK_FADE_MS; under reduced motion it clears
   * at once. A fade already under way carries on.
   */
  release(): void {
    if (this.#destroyed || this.state !== 'live') return;
    if (this.#deps.reducedMotion()) {
      this.clear();
      return;
    }
    this.#fading = true;
    this.#start = this.#deps.now();
    this.#raf = this.#deps.raf(this.#frame);
  }

  /** Removes what is showing at once. */
  clear(): void {
    this.#stop();
    this.#fading = false;
    const had = this.#pack !== null;
    this.#pack = null;
    this.#opacity = 1;
    if (had) this.#deps.set([]);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.clear();
    this.#destroyed = true;
  }

  #frame = (): void => {
    this.#raf = null;
    const pack = this.#pack;
    if (!pack || !this.#fading || this.#destroyed) return;
    const t = this.#deps.now() - this.#start;
    if (t >= FEEDBACK_FADE_MS) {
      this.clear();
      return;
    }
    const o = 1 - t / FEEDBACK_FADE_MS;
    if (o !== this.#opacity) {
      this.#opacity = o;
      this.#deps.set([this.#deps.layer(pack, o, `sim-feedback-${this.#n}`)]);
    }
    this.#raf = this.#deps.raf(this.#frame);
  };

  #stop(): void {
    if (this.#raf !== null) this.#deps.cancelRaf(this.#raf);
    this.#raf = null;
  }
}

/**
 * Lots whose label point is in `bounds`, nearest `centre` first, at most `max`. `points` holds
 * each lot's label point (lng, lat) in `lots` order. Distance is planar, longitude scaled by the
 * centre's latitude; ties keep `lots` order.
 */
export function lotsInView(
  lots: readonly ParcelId[],
  points: Float64Array,
  bounds: [w: number, s: number, e: number, n: number],
  centre: [number, number],
  max: number
): ParcelId[] {
  const [w, s, e, n] = bounds;
  const kx = Math.cos((centre[1] * Math.PI) / 180);
  const inView: { id: ParcelId; d: number }[] = [];
  for (let k = 0; k < lots.length; k++) {
    const x = points[2 * k];
    const y = points[2 * k + 1];
    if (!(x >= w && x <= e && y >= s && y <= n)) continue;
    const dx = (x - centre[0]) * kx;
    const dy = y - centre[1];
    inView.push({ id: lots[k], d: dx * dx + dy * dy });
  }
  inView.sort((a, b) => a.d - b.d);
  return inView.slice(0, Math.max(0, max)).map((x) => x.id);
}
