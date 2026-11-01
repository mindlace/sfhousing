/**
 * BrushController's editor and client on /sim: a committed stroke becomes one PolicyStore change
 * (a custom paint or erase stroke in the recipe) instead of a plan op sent to a worker. The
 * client has no `preview`, so the controller sends no previews and gates nothing. Undo and redo
 * go to the store and return null, so the controller announces nothing; the adapter announces
 * the store's label instead, as it does for each committed stroke.
 */
import type { BrushControllerDeps } from '$lib/brush/BrushController.svelte';
import { newOpId } from '$lib/brush/ids';
import type { PlanOp } from '$lib/plan';
import type { CustomBrush, SimPolicy, Stroke } from './policy';
import type { PolicyStore } from './policy-store.svelte';

/** The undo label of a Paint stroke ("Allowed 8 stories"). */
export function strokeLabel(stories: number): string {
  return `Allowed ${stories} ${stories === 1 ? 'story' : 'stories'}`;
}

/** The undo label of an Erase stroke. */
export const ERASE_LABEL = 'Erased custom zoning';

/**
 * A Paint stroke joins the last custom brush when it paints the same stories, an Erase stroke
 * the last brush when it erases; otherwise the stroke starts a new brush.
 */
function appendStroke(p: SimPolicy, stroke: Stroke, op: PlanOp, stories: number): SimPolicy {
  const last = p.custom.at(-1);
  const head = p.custom.slice(0, -1);
  const joins =
    op.kind === 'paint'
      ? last?.kind === 'paint' && last.stories === stories
      : last?.kind === 'erase';
  let custom: CustomBrush[];
  if (joins && last) custom = [...head, { ...last, strokes: [...last.strokes, stroke] }];
  else if (op.kind === 'paint')
    custom = [...p.custom, { id: newOpId(), kind: 'paint', strokes: [stroke], stories }];
  else custom = [...p.custom, { id: newOpId(), kind: 'erase', strokes: [stroke] }];
  return { ...p, custom };
}

export function createStrokeAdapter(deps: {
  store: PolicyStore;
  stories(): number;
  announce(msg: string): void;
  /** A Paint stroke landed in the store (never called for Erase): the paint feedback. */
  onpaint?(stroke: Stroke, stories: number): void;
}): { editor: BrushControllerDeps['editor']; client: BrushControllerDeps['client'] } {
  const { store, announce } = deps;
  let rev = 0;
  return {
    editor: {
      // During a run the store is locked: the controller refuses strokes, undo and redo, so
      // nothing is announced that did not happen.
      get readOnly() {
        return store.locked;
      },
      commit(op) {
        const stroke: Stroke = { path: op.path.map((q) => [q[0], q[1]]), radiusM: op.radiusM };
        const stories = deps.stories();
        const label = op.kind === 'paint' ? strokeLabel(stories) : ERASE_LABEL;
        store.apply((p) => appendStroke(p, stroke, op, stories), label);
        // The stroke's result in words (WCAG 4.1.3); the lot count follows in "Custom zoning".
        announce(label);
        if (op.kind === 'paint') deps.onpaint?.(stroke, stories);
        return { ok: true };
      },
      undo() {
        const label = store.undo();
        if (label !== null) announce(`Undid: ${label}`);
        return null;
      },
      redo() {
        const label = store.redo();
        if (label !== null) announce(`Redid: ${label}`);
        return null;
      }
    },
    client: {
      datasetVersion: null,
      commit: () => ++rev,
      undo: () => ++rev,
      prefetch: () => {}
    }
  };
}
