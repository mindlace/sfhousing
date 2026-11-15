import type { CommitKind, Restores } from './types';

/** A commit as the derivation reads it; pending commits take provisional seqs after the tip. */
export interface HistoryEntry {
  seq: number;
  kind: CommitKind;
  restores: Restores | null;
}
export interface UndoRedo {
  undo: number | null;
  redo: number | null;
}

/** R12: the positions undo and redo restore to, from the log alone. `log` is seq 1..n in order. */
export function undoRedo(log: readonly HistoryEntry[]): UndoRedo {
  let undo: number[] = [];
  let redo: number[] = [];
  let cur = 0;
  for (const e of log) {
    if (e.kind === 'system') {
      undo = [];
      redo = [];
    } else {
      const r = e.kind === 'restore' ? e.restores : null;
      const i = r?.as === 'undo' ? undo.lastIndexOf(r.position) : -1;
      const j = r?.as === 'redo' ? redo.lastIndexOf(r.position) : -1;
      if (i >= 0) {
        undo.length = i;
        redo.push(cur);
      } else if (j >= 0) {
        redo.length = j;
        undo.push(cur);
      } else {
        // An edit, a jump, or a restore whose target is not on its stack.
        undo.push(cur);
        redo = [];
      }
    }
    cur = e.seq;
  }
  return { undo: undo.at(-1) ?? null, redo: redo.at(-1) ?? null };
}
