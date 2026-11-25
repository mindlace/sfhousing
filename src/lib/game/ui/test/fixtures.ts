import type { RunResult } from '../../run-result';
import type { SideGoal } from '../../side-goals';
import type { NodeId } from '../../state';
import type { Grant, NodeLevel, NodeView, TreeNode } from '../../tree';

export function nodeLevel(
  price: number,
  step: string,
  grant: Grant = { tag: 'stories', max: 8 }
): NodeLevel {
  return { price: { home: price }, grant, step };
}

export function treeNode(over: Partial<TreeNode> & { id: NodeId }): TreeNode {
  return {
    branch: 'permitting',
    label: `Node ${over.id}`,
    line: 'Does one thing.',
    after: [],
    ring: 0,
    levels: [nodeLevel(100, 'Step 1')],
    source: null,
    ...over
  };
}

export function nodeView(node: TreeNode, over: Partial<Omit<NodeView, 'node'>> = {}): NodeView {
  return { node, level: 0, state: 'ready', short: null, ...over };
}

export function runResult(over: Partial<RunResult> = {}): RunResult {
  return {
    homes: 40_000,
    amount: 80_000,
    reachedOn: null,
    stages: {
      preApplication: 0,
      filed: 0,
      entitled: 0,
      permitFiled: 0,
      permitIssued: 0,
      construction: 0
    },
    waitingMoney: null,
    dropped: { home: 9100 },
    collected: { home: 7300 },
    rung: 0,
    datasetVersion: 'test',
    at: '2026-11-25T00:00:00.000Z',
    lump: null,
    side: [],
    ...over
  };
}

export function sideGoal(id: string, label: string, reward: number, ring = 0): SideGoal {
  return { id, label, ring, reward: { home: reward }, read: () => null };
}

export function sideEntry(
  goal: SideGoal,
  value: number,
  target: number,
  met = value >= target
): { goal: SideGoal; value: number; target: number; met: boolean } {
  return { goal, value, target, met };
}
