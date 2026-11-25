// A node's levers in the policy document (game-sim, workshop and switch).
import { applyGrant, GAME_TRANSIT_ID, type GrantCtx } from '$lib/game/grant';
import type { GameState, NodeId } from '$lib/game/state';
import { NODES } from '$lib/game/catalogue/nodes';
import type { Grant, TreeNode } from '$lib/game/tree';
import { STOP_TYPES } from '$lib/sim/levers/brushes';
import type { PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import { setOn, type SpanRef } from '$lib/timeline/spans';

/** The node's policies in the document, first span each. */
export function nodeRefs(doc: SimPolicy4, grant: Grant): SpanRef[] {
  const pick = (kind: PolicyKind, match: (id: string, preset: string | null) => boolean) =>
    doc.kinds[kind]
      .filter((p) => match(p.id, p.preset))
      .map((p): SpanRef => ({ kind, id: p.id, span: 0 }));
  switch (grant.tag) {
    case 'preset':
      return pick('permitting', (_, preset) => preset === grant.preset);
    case 'measure':
      return pick('money', (_, preset) => preset === grant.preset);
    case 'stop':
    case 'bands':
    case 'stories':
    case 'reach':
      return pick('zoning', (id) => id === GAME_TRANSIT_ID);
    case 'hands':
      return [];
  }
}

/** The document with the node's policy added back when it has none; else `doc` itself. */
export function restoreNode(
  doc: SimPolicy4,
  node: TreeNode,
  level: number,
  ctx: GrantCtx
): SimPolicy4 {
  const first = node.levels[0]?.grant;
  if (first === undefined || first.tag === 'hands') return doc;
  if (nodeRefs(doc, first).length > 0) return doc;
  let out = doc;
  if (first.tag !== 'preset' && first.tag !== 'measure') {
    for (const stop of STOP_TYPES) {
      if (ctx.limits.stops.has(stop)) out = applyGrant(out, { tag: 'stop', stop }, ctx);
    }
  }
  for (const l of node.levels.slice(0, level)) out = applyGrant(out, l.grant, ctx);
  return out;
}

/** Tree's `on`: each bought node whose policy is in the document, and whether it is on. */
export function nodeSwitches(
  doc: SimPolicy4,
  s: GameState,
  nodes: readonly TreeNode[] = NODES
): Record<NodeId, boolean> {
  const out: Record<NodeId, boolean> = {};
  for (const node of nodes) {
    if ((s.bought[node.id] ?? 0) < 1) continue;
    const ref = nodeRefs(doc, node.levels[0].grant)[0];
    if (ref === undefined) continue;
    const p = doc.kinds[ref.kind].find((q) => q.id === ref.id);
    if (p !== undefined) out[node.id] = p.on;
  }
  return out;
}

/** The document with every policy of the node switched to `on`; `doc` itself when none changes. */
export function switchNodeDoc(doc: SimPolicy4, node: TreeNode, on: boolean): SimPolicy4 {
  return nodeRefs(doc, node.levels[0].grant).reduce((d, r) => setOn(d, r.kind, r.id, on), doc);
}
