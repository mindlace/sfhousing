import type { HistoryEntry } from '$lib/sim-log';

export interface LabelledEntry extends HistoryEntry {
  label: string;
}

export interface HistoryTarget {
  position: number;
  /** For undo: the change undone. For redo: the change redone. */
  label: string;
}

/**
 * The walk of the log core's `undoRedo`, kept incrementally so a push is O(1), with each stack
 * entry carrying the label of the commit that put it there.
 */
export class History {
  #undo: HistoryTarget[] = [];
  #redo: HistoryTarget[] = [];
  #cur = 0;

  /** Takes one commit, in seq order. */
  push(e: LabelledEntry): void {
    if (e.kind === 'system') {
      this.#undo = [];
      this.#redo = [];
    } else {
      const r = e.kind === 'restore' ? e.restores : null;
      const i = r?.as === 'undo' ? lastIndexOf(this.#undo, r.position) : -1;
      const j = r?.as === 'redo' ? lastIndexOf(this.#redo, r.position) : -1;
      const target = { position: this.#cur, label: e.label };
      if (i >= 0) {
        this.#undo.length = i;
        this.#redo.push(target);
      } else if (j >= 0) {
        this.#redo.length = j;
        this.#undo.push(target);
      } else {
        // An edit, a jump, or a restore whose target is not on its stack.
        this.#undo.push(target);
        this.#redo = [];
      }
    }
    this.#cur = e.seq;
  }

  clone(): History {
    const c = new History();
    c.#undo = this.#undo.slice();
    c.#redo = this.#redo.slice();
    c.#cur = this.#cur;
    return c;
  }

  get undo(): HistoryTarget | null {
    return this.#undo.at(-1) ?? null;
  }

  get redo(): HistoryTarget | null {
    return this.#redo.at(-1) ?? null;
  }

  /** The current position: the last pushed seq, 0 before any. */
  get position(): number {
    return this.#cur;
  }
}

function lastIndexOf(stack: readonly HistoryTarget[], position: number): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].position === position) return i;
  return -1;
}
