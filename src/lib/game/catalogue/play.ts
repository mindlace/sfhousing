// Playing the tree in code: purchases and their grants, for the scripts and `closing`.
import type { Calibration } from '$lib/timelapse/types';
import { DEFAULT_POLICY4, type SimPolicy4 } from '$lib/timeline/policy4';
import { applyGrant } from '../grant';
import { limitsOf, runnable } from '../limits';
import { NEW_GAME, type GameState, type NodeId } from '../state';
import { buy, type TreeNode } from '../tree';
import { LADDER_YEARS } from './ladder-years';
import { NODES } from './nodes';

export interface Played {
  state: GameState;
  doc: SimPolicy4;
}

/** `buy`, then the grant applied with the limits after the purchase; null when refused. */
export function buyAndApply(
  p: Played,
  id: NodeId,
  cal: Calibration,
  nodes: readonly TreeNode[] = NODES
): Played | null {
  const r = buy(p.state, id, nodes);
  if (!r.ok) return null;
  const limits = limitsOf(r.state, nodes);
  return { state: r.state, doc: applyGrant(p.doc, r.grant, { cal, limits }) };
}

/** Every level of every node, bought in catalogue order from current law at no cost. */
export function fullTree(cal: Calibration, nodes: readonly TreeNode[] = NODES): Played {
  let p: Played = {
    state: {
      ...NEW_GAME,
      phase: 'runs',
      rung: LADDER_YEARS.length,
      units: { home: Number.MAX_SAFE_INTEGER }
    },
    doc: DEFAULT_POLICY4
  };
  for (const n of nodes) {
    for (let k = 0; k < n.levels.length; k++) {
      const next = buyAndApply(p, n.id, cal, nodes);
      if (next === null) throw new Error(`full tree: ${n.id} level ${k + 1} was refused`);
      p = next;
    }
  }
  return { state: p.state, doc: runnable(p.doc, limitsOf(p.state, nodes)) };
}
