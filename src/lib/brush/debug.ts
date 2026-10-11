// e2e debug hook (spec §6), mirroring src/lib/map/debug.ts. Compiled in only when
// VITE_E2E === '1'; otherwise the body is a constant-false branch that Vite dead-code-eliminates.
import type { Plan } from '$lib/plan';
import type { OpStats } from '$lib/sim/protocol';
import type { Editor } from './editor.svelte';

/** What BrushEditor reports to the hook. */
export interface SfhBrushDebugState {
  readonly ops: number;
  readonly lastStats: OpStats | null;
  readonly ready: boolean;
  readonly chunks: { pending: number; failed: string[] };
}

export interface SfhBrushDebug extends SfhBrushDebugState {
  /** Loads `plan` (editable) through the editor a parent obtained via `oneditor`. */
  load(plan: Plan): void;
}

declare global {
  interface Window {
    __sfhBrush?: SfhBrushDebug;
  }
}

let parentEditor: Pick<Editor, 'load'> | null = null;

/**
 * E2E only: records the editor a parent route obtained through BrushEditor's `oneditor`, so
 * `__sfhBrush.load` exercises the same path plan-sharing uses. Returns a disposer for the
 * parent's teardown; it clears the record only if it still holds this editor. A no-op outside
 * VITE_E2E.
 */
export function exposeEditorForDebug(editor: Pick<Editor, 'load'>): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  parentEditor = editor;
  return () => {
    if (parentEditor === editor) parentEditor = null;
  };
}

export function installBrushDebug(get: () => SfhBrushDebugState): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhBrushDebug = {
    get ops() {
      return get().ops;
    },
    get lastStats() {
      return get().lastStats;
    },
    get ready() {
      return get().ready;
    },
    get chunks() {
      return get().chunks;
    },
    load(plan) {
      if (!parentEditor) throw new Error('__sfhBrush.load: no parent passed oneditor');
      parentEditor.load(plan);
    }
  };
  window.__sfhBrush = hook;
  return () => {
    if (window.__sfhBrush === hook) delete window.__sfhBrush;
  };
}
