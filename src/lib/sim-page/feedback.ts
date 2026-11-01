/**
 * Paint feedback on /sim (map overlays plan 2, Task 6): a custom paint stroke, or a zoning rule
 * once its saved revision is in force, briefly shows the generated buildings its lots could
 * hold, then they fade. Pure apart from the injected clock, frame loop and layer factory.
 */
import type { Layer } from '@deck.gl/core';
import type { ParcelId } from '$lib/data/parcel';
import type { PackedCell } from '$lib/map/types';
import type { BrushLotsResult } from '$lib/sim/scenario/types';
import type { LeverStatus } from './lever-status';

/** Tier 4 (engineering): the buildings show at full strength this long. */
export const FEEDBACK_HOLD_MS = 500;
/** Tier 4: then fade linearly to 0 over this long (about 2 s in all; the spec's "my call"). */
export const FEEDBACK_FADE_MS = 1500;

/**
 * The feedback's opacity `t` ms after it was shown; null once it is over (remove the layer).
 * Under reduced motion there is no fade: full strength for the whole time, then gone (as
 * SimMap's rising buildings skip their animation).
 */
export function feedbackOpacity(t: number, reducedMotion: boolean): number | null {
  if (t >= FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS) return null;
  if (t <= FEEDBACK_HOLD_MS || reducedMotion) return 1;
  return 1 - (t - FEEDBACK_HOLD_MS) / FEEDBACK_FADE_MS;
}

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

/** The fading feedback layer: one at a time; a new `show` replaces what is showing. */
export class PaintFeedback {
  #deps: PaintFeedbackDeps;
  #n = 0;
  #pack: PackedCell | null = null;
  #start = 0;
  #opacity: number | null = null;
  #raf: number | null = null;
  #destroyed = false;

  constructor(deps: PaintFeedbackDeps) {
    this.#deps = deps;
  }

  /** Shows `pack` from full strength (replacing what is showing); null clears. */
  show(pack: PackedCell | null): void {
    if (this.#destroyed) return;
    this.#stop();
    if (pack === null) {
      this.#clear();
      return;
    }
    this.#n++;
    this.#pack = pack;
    this.#start = this.#deps.now();
    this.#opacity = null;
    this.#frame();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#stop();
    this.#clear();
    this.#destroyed = true;
  }

  #frame = (): void => {
    this.#raf = null;
    const pack = this.#pack;
    if (!pack || this.#destroyed) return;
    const o = feedbackOpacity(this.#deps.now() - this.#start, this.#deps.reducedMotion());
    if (o === null) {
      this.#clear();
      return;
    }
    // Under reduced motion the opacity holds at 1: no new layer until it ends.
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

  #clear(): void {
    const had = this.#pack !== null;
    this.#pack = null;
    this.#opacity = null;
    if (had) this.#deps.set([]);
  }
}

/**
 * When a saved zoning rule's feedback is due: the page arms it on a save that changed the policy,
 * and it fires on the first `current` above the latest lever revision seen at the save (the
 * revision the save's levers go out as, or a later one that carries them).
 */
export class RuleFeedbackTrigger {
  #lastRev = -Infinity;
  #armed: { ruleId: string; rev: number } | null = null;

  /** A rule was added or edited (BrushForms save) while the latest lever rev seen was `lastRev`. */
  saved(ruleId: string): void {
    this.#armed = { ruleId, rev: this.#lastRev };
  }

  /** Every LeverStatus; returns the rule id to show once a `current` above the save's rev lands. */
  status(s: LeverStatus): string | null {
    if (s.kind === 'off') return null;
    if (s.rev > this.#lastRev) this.#lastRev = s.rev;
    const a = this.#armed;
    if (s.kind !== 'current' || !a || s.rev <= a.rev) return null;
    this.#armed = null;
    return a.ruleId;
  }

  /** Forgets an armed save (a run started, or the session ended). */
  reset(): void {
    this.#armed = null;
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

/**
 * One lot list from several brush results (a rule's queries; a transit rule's bands overlap):
 * each lot once, first occurrence kept, with its label point. Unknown and failed results are
 * skipped.
 */
export function mergeLots(results: readonly (BrushLotsResult | undefined)[]): {
  lots: ParcelId[];
  points: Float64Array;
} {
  const seen = new Set<ParcelId>();
  const lots: ParcelId[] = [];
  const pts: number[] = [];
  for (const r of results) {
    if (!r?.ok) continue;
    r.lots.forEach((id, k) => {
      if (seen.has(id)) return;
      seen.add(id);
      lots.push(id);
      pts.push(r.points[2 * k], r.points[2 * k + 1]);
    });
  }
  return { lots, points: Float64Array.from(pts) };
}
