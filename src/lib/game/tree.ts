// G3 (contracts stub): the tree. tree-catalogue makes it real.
import type { PresetId } from '$lib/sim-page/timing';
import type { StopType } from '$lib/sim/levers/brushes';
import type { GameState, NodeId, Units } from './state';

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

export function treeView(_s: GameState, _nodes?: readonly TreeNode[]): NodeView[] {
  throw new Error('not implemented');
}

export function buy(_s: GameState, _id: NodeId, _nodes?: readonly TreeNode[]): Bought {
  throw new Error('not implemented');
}
