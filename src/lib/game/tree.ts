// G3: the tree.
import type { PresetId } from '$lib/sim-page/timing';
import type { StopType } from '$lib/sim/levers/brushes';
import { NODES } from './catalogue/nodes';
import type { GameState, NodeId, Units } from './state';
import { affords, shortBy, spend } from './units';

export type Branch = 'permitting' | 'zoning' | 'money' | 'hands';

export type Grant =
  | { tag: 'preset'; preset: PresetId }
  | { tag: 'measure'; preset: string }
  | { tag: 'stop'; stop: StopType }
  | { tag: 'bands'; max: 2 | 3 }
  | { tag: 'stories'; max: number }
  | { tag: 'reach'; maxM: number }
  | { tag: 'hands'; what: 'radius' | 'linger'; value: number }
  | { tag: 'hands'; what: 'auto' };

export interface NodeLevel {
  price: Units;
  grant: Grant;
  step: string;
}

export interface TreeNode {
  id: NodeId;
  branch: Branch;
  label: string;
  line: string;
  after: NodeId[];
  ring: number;
  levels: NodeLevel[];
  source: { text: string; href: string | null } | null;
}

export interface NodeView {
  node: TreeNode;
  level: number;
  state: 'ready' | 'short' | 'done';
  short: Units | null;
}

export type Bought =
  | { ok: true; state: GameState; grant: Grant }
  | { ok: false; reason: 'unknown' | 'hidden' | 'done' | 'short' };

/** The level bought of `node`, 0 for none, never above its last. */
export function levelOf(s: GameState, node: TreeNode): number {
  return Math.min(s.bought[node.id] ?? 0, node.levels.length);
}

/** Its ring is open and it comes after nothing, or after a node that is bought. */
export function isShown(s: GameState, node: TreeNode): boolean {
  if (s.rung < node.ring) return false;
  return node.after.length === 0 || node.after.some((id) => (s.bought[id] ?? 0) >= 1);
}

export function treeView(s: GameState, nodes: readonly TreeNode[] = NODES): NodeView[] {
  return nodes
    .filter((node) => isShown(s, node))
    .map((node): NodeView => {
      const level = levelOf(s, node);
      const next = node.levels[level];
      if (next === undefined) return { node, level, state: 'done', short: null };
      return affords(s.units, next.price)
        ? { node, level, state: 'ready', short: null }
        : { node, level, state: 'short', short: shortBy(s.units, next.price) };
    });
}

export function buy(s: GameState, id: NodeId, nodes: readonly TreeNode[] = NODES): Bought {
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) return { ok: false, reason: 'unknown' };
  if (!isShown(s, node)) return { ok: false, reason: 'hidden' };
  const level = levelOf(s, node);
  const next = node.levels[level];
  if (next === undefined) return { ok: false, reason: 'done' };
  if (!affords(s.units, next.price)) return { ok: false, reason: 'short' };
  return {
    ok: true,
    state: { ...s, units: spend(s.units, next.price), bought: { ...s.bought, [id]: level + 1 } },
    grant: next.grant
  };
}
