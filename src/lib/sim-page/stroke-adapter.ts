/**
 * BrushController's editor and client on /sim: a committed stroke becomes one PolicyStore change
 * (a freehand, erase or protection stroke in the recipe) instead of a plan op sent to a worker.
 * The client has no `preview`, so the controller sends no previews and gates nothing. Undo and redo
 * go to the store and return null, so the controller announces nothing; the adapter announces
 * the store's label instead.
 */
import type { BrushControllerDeps } from '$lib/brush/BrushController.svelte';
import { newOpId } from '$lib/brush/ids';
import type { PlanOp } from '$lib/plan';
import type { Effect, SimPolicy, Stroke, ZoningBrush } from './policy';
import type { PolicyStore } from './policy-store.svelte';

export type StrokeTarget = 'zoning' | 'protect';

const VERB = { raise: 'Raised', lower: 'Lowered', set: 'Set' } as const;

/** The undo label of a freehand stroke ("Raised lots to 8 stories"). */
export function strokeLabel(e: Effect): string {
  return `${VERB[e.mode]} lots to ${e.stories} ${e.stories === 1 ? 'story' : 'stories'}`;
}

const sameEffect = (a: Effect, b: Effect) =>
  a.mode === b.mode && a.stories === b.stories && a.densityLimits === b.densityLimits;

function appendZoning(p: SimPolicy, stroke: Stroke, op: PlanOp, effect: Effect): SimPolicy {
  const last = p.brushes.at(-1);
  const head = p.brushes.slice(0, -1);
  let brushes: ZoningBrush[];
  if (op.kind === 'paint') {
    brushes =
      last?.kind === 'freehand' && sameEffect(last.effect, effect)
        ? [...head, { ...last, strokes: [...last.strokes, stroke] }]
        : [...p.brushes, { id: newOpId(), kind: 'freehand', strokes: [stroke], effect }];
  } else {
    brushes =
      last?.kind === 'erase'
        ? [...head, { ...last, strokes: [...last.strokes, stroke] }]
        : [...p.brushes, { id: newOpId(), kind: 'erase', strokes: [stroke] }];
  }
  return { ...p, brushes };
}

export function createStrokeAdapter(deps: {
  store: PolicyStore;
  target(): StrokeTarget;
  effect(): Effect;
  announce(msg: string): void;
}): { editor: BrushControllerDeps['editor']; client: BrushControllerDeps['client'] } {
  const { store, announce } = deps;
  let rev = 0;
  return {
    editor: {
      readOnly: false,
      commit(op) {
        const stroke: Stroke = { path: op.path.map((q) => [q[0], q[1]]), radiusM: op.radiusM };
        if (deps.target() === 'protect') {
          const kind = op.kind === 'paint' ? 'protect' : 'unprotect';
          store.apply(
            (p) => ({
              ...p,
              protect: { ...p.protect, strokes: [...p.protect.strokes, { ...stroke, kind }] }
            }),
            kind === 'protect' ? 'Protected lots' : 'Unprotected lots'
          );
        } else {
          const effect = { ...deps.effect() };
          store.apply(
            (p) => appendZoning(p, stroke, op, effect),
            op.kind === 'paint' ? strokeLabel(effect) : 'Erased brushed zoning'
          );
        }
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
