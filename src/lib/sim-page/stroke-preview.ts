/**
 * The live preview while painting on /sim (sim-ux plan 3, Task 4): BrushController's `preview`
 * and `cancelPreview`. A Paint preview finds the stroke's lots in the worker, keeps those nearest
 * the brush ring and shows the buildings they could hold at the stroke's stories. One rev counter
 * runs through previews and barriers (a commit, an undo, a cancel), so revs keep increasing as
 * SimClient's do; an answer to a preview a barrier followed is dropped. Every preview's rev is
 * answered (`answered`), whatever became of it, so the controller never waits on one.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { PackedCell } from '$lib/map/types';
import type { PlanOp } from '$lib/plan';
import type { BrushQuery } from '$lib/sim/levers/brushes';
import type { BrushLotsResult, PreviewResult } from '$lib/sim/scenario/types';
import { customQuery, type Stroke } from './policy';

export interface StrokePreviewDeps {
  resolve(q: BrushQuery): Promise<BrushLotsResult>;
  buildings(lots: ParcelId[], stories: number): Promise<PreviewResult>;
  /** The stroke's lots nearest `at` (the brush ring) inside the view, at most PREVIEW_MAX_LOTS. */
  nearest(lots: readonly ParcelId[], points: Float64Array, at: [number, number]): ParcelId[];
  /** PaintFeedback.live */
  live(pack: PackedCell | null): void;
  /** PaintFeedback.release (the fade) */
  release(): void;
  /** PaintFeedback.clear */
  clear(): void;
  /** controller.previewDone */
  answered(rev: number): void;
}

export class StrokePreview {
  #d: StrokePreviewDeps;
  #rev = 0;
  /** The latest barrier's rev: a preview below it is superseded. */
  #barrier = 0;

  constructor(deps: StrokePreviewDeps) {
    this.#d = deps;
  }

  /** The controller's client.preview: asks for `op`'s buildings; returns its rev. */
  preview(op: PlanOp): number {
    const rev = ++this.#rev;
    void this.#run(rev, op);
    return rev;
  }

  /** client.cancelPreview: a barrier; the live buildings clear at once. */
  cancel(): number {
    return this.barrier(false);
  }

  /** client.commit / client.undo: a barrier; the live buildings fade (`fade`) or clear. */
  barrier(fade: boolean): number {
    const rev = ++this.#rev;
    this.#barrier = rev;
    if (fade) this.#d.release();
    else this.#d.clear();
    return rev;
  }

  /** A run started or the page is going: drop everything, clear. */
  reset(): void {
    this.barrier(false);
  }

  #stale(rev: number): boolean {
    return rev < this.#barrier;
  }

  async #run(rev: number, op: PlanOp): Promise<void> {
    try {
      // A microtask first: an Erase is answered here with nothing shown (erasing removes paint;
      // the dashed outlines show its reach), and a pointer-up's last preview, which the commit
      // right behind it supersedes, asks the worker for nothing.
      await Promise.resolve();
      if (op.kind !== 'paint' || this.#stale(rev)) return;
      const stroke: Stroke = { path: op.path.map((q) => [q[0], q[1]]), radiusM: op.radiusM };
      const q = customQuery({
        id: 'preview',
        kind: 'paint',
        strokes: [stroke],
        stories: op.stories
      });
      const r = await this.#d.resolve(q);
      if (this.#stale(rev) || !r.ok) return;
      const at = op.path[op.path.length - 1];
      const lots = this.#d.nearest(r.lots, r.points, [at[0], at[1]]);
      if (lots.length === 0) {
        this.#d.live(null);
        return;
      }
      const p = await this.#d.buildings(lots, op.stories);
      if (this.#stale(rev) || !p.ok) return;
      this.#d.live(p.pack);
    } catch {
      // A failed request shows nothing; the rev is still answered below.
    } finally {
      this.#d.answered(rev);
    }
  }
}
