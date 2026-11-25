import type { Branch, NodeView } from '../tree';

export const BRANCH_ORDER: readonly Branch[] = ['permitting', 'zoning', 'money', 'hands'];

export interface TreeRow {
  view: NodeView;
  children: TreeRow[];
}

export interface BranchRows {
  branch: Branch;
  rows: TreeRow[];
}

/** Nest nodes into branch rows: a parent is the first `after` id of the same branch seen earlier. */
export function branchRows(nodes: readonly NodeView[]): BranchRows[] {
  const placed = new Map<string, { row: TreeRow; branch: Branch }>();
  const roots = new Map<Branch, TreeRow[]>();
  for (const view of nodes) {
    const { node } = view;
    const row: TreeRow = { view, children: [] };
    let parent: TreeRow | null = null;
    for (const id of node.after) {
      const at = placed.get(id);
      if (at && at.branch === node.branch) {
        parent = at.row;
        break;
      }
    }
    if (parent) parent.children.push(row);
    else {
      const list = roots.get(node.branch) ?? [];
      list.push(row);
      roots.set(node.branch, list);
    }
    placed.set(node.id, { row, branch: node.branch });
  }
  return BRANCH_ORDER.flatMap((branch) => {
    const rows = roots.get(branch);
    return rows ? [{ branch, rows }] : [];
  });
}
