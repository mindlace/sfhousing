// Plays the purchase tree against the engine to check pacing (spec: sec-design-balance).
// The pure pieces (shares, orders, next-buy selection, pacing checks, side report), then a play
// against the engine and current law at each deadline.
import { NODES } from '../src/lib/game/catalogue/nodes';
import { buyAndApply, type Played } from '../src/lib/game/catalogue/play';
import { SIDE_TUNING } from '../src/lib/game/catalogue/tuning';
import { finished, goalAt, RUNGS, takeNext } from '../src/lib/game/ladder';
import { limitsOf, runnable } from '../src/lib/game/limits';
import { deadlineIndex, readRun, resultOf, settle, type RunTake } from '../src/lib/game/run-result';
import type { SideGoal } from '../src/lib/game/side-goals';
import { NEW_GAME, type GameState, type NodeId } from '../src/lib/game/state';
import { treeView, type NodeView, type TreeNode } from '../src/lib/game/tree';
import { total } from '../src/lib/game/units';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import { canonicalJson } from '../src/lib/sim-page/policy';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import type { Engine } from './reach-measure';

export const SHARE = { base: 0.25, perRadius: 0.1, perLinger: 0.05 } as const;

/** The share of dropped units a player collects: an assumption, not a measurement. */
export function shareOf(s: GameState, mode: 'hand' | 'collect-for-me'): number {
  if (mode === 'collect-for-me' || (s.bought['hands-auto'] ?? 0) >= 1) return 1;
  const r = s.bought['hands-radius'] ?? 0;
  const l = s.bought['hands-linger'] ?? 0;
  return Math.min(1, SHARE.base + SHARE.perRadius * r + SHARE.perLinger * l);
}

/** Seconds a player spends, assumed: Paint, a run, a tally, a purchase. */
export const CLOCK = { openingS: 60, runS: 20, tallyS: 8, buyS: 4 } as const;

export const TARGETS = {
  firstPurchaseS: 120,
  earlyPurchases: 5,
  earlyRunsPerPurchase: 1,
  runsPerPurchase: 3,
  mapGapS: 300,
  purchasesPerDeadline: 3
} as const;

export interface PlayReport {
  order: string;
  mode: 'hand' | 'collect-for-me';
  runs: {
    n: number;
    rung: number;
    homes: number;
    reachedOn: Day | null;
    dropped: number;
    collected: number;
    balance: number;
    bought: { id: NodeId; level: number; price: number }[];
    lump: number;
    sideRewards: number;
    sideMet: string[];
  }[];
  end: 'finished' | 'stuck' | 'too-long';
  clockS: number;
  checks: { id: CheckId; value: number; target: number; pass: boolean }[];
}

export type CheckId =
  | 'first-purchase'
  | 'early-runs-per-purchase'
  | 'runs-per-purchase'
  | 'map-gap'
  | 'purchases-per-deadline';

export interface SideReport {
  id: string;
  rung: number;
  value: number | null;
  target: number;
  flags: ('at-or-below-current-law' | 'never-met')[];
  raiseTo: number | null;
}

export const ORDERS = [
  'catalogue',
  'permitting-first',
  'zoning-first',
  'money-first',
  'hands-first',
  'cheapest'
] as const;
export type OrderName = (typeof ORDERS)[number];

/** Each node id once per level: the named branch's nodes first, then the rest, each in catalogue order. */
export function sequenceOf(
  order: Exclude<OrderName, 'cheapest'>,
  nodes: readonly TreeNode[] = NODES
): NodeId[] {
  const each = (n: TreeNode): NodeId[] => n.levels.map(() => n.id);
  if (order === 'catalogue') return nodes.flatMap(each);
  const branch = order.slice(0, -'-first'.length);
  return [
    ...nodes.filter((n) => n.branch === branch).flatMap(each),
    ...nodes.filter((n) => n.branch !== branch).flatMap(each)
  ];
}

/** The tree's view of every shown node by id. */
function viewsOf(s: GameState, nodes: readonly TreeNode[]): Map<NodeId, NodeView> {
  return new Map(treeView(s, nodes).map((v) => [v.node.id, v]));
}

/** Done as far as a sequence is concerned: every level bought, or no such node. */
function isDone(s: GameState, id: NodeId, nodes: readonly TreeNode[]): boolean {
  const node = nodes.find((n) => n.id === id);
  return node === undefined || (s.bought[id] ?? 0) >= node.levels.length;
}

/**
 * The next purchase by an order. A sequence order drops entries whose node is done, skips entries
 * whose node is not shown (they wait in place), and takes the first shown entry only when it is
 * ready. `cheapest` ignores `pending` and takes the cheapest ready level, ties in catalogue order.
 */
export function nextBuy(
  order: OrderName,
  s: GameState,
  pending: readonly NodeId[],
  nodes: readonly TreeNode[] = NODES
): { id: NodeId; pending: NodeId[] } | null {
  const views = viewsOf(s, nodes);
  if (order === 'cheapest') {
    let best: { id: NodeId; price: number } | null = null;
    for (const node of nodes) {
      const v = views.get(node.id);
      if (v === undefined || v.state !== 'ready') continue;
      const price = total(node.levels[v.level]?.price ?? {});
      if (best === null || price < best.price) best = { id: node.id, price };
    }
    return best === null ? null : { id: best.id, pending: [] };
  }
  const rest = pending.filter((id) => !isDone(s, id, nodes));
  const at = rest.findIndex((id) => views.has(id));
  if (at < 0) return null;
  const id = rest[at]!;
  if (views.get(id)?.state !== 'ready') return null;
  return { id, pending: rest.filter((_, i) => i !== at) };
}

/** Some entry (for `cheapest`, some node) is shown and not done. */
export function leftToBuy(
  order: OrderName,
  s: GameState,
  pending: readonly NodeId[],
  nodes: readonly TreeNode[] = NODES
): boolean {
  const views = viewsOf(s, nodes);
  const ids = order === 'cheapest' ? nodes.map((n) => n.id) : pending;
  return ids.some((id) => views.has(id) && !isDone(s, id, nodes));
}

export type PlayEvent = { type: 'run' } | { type: 'buy'; mapChange: boolean } | { type: 'met' };

const SECONDS = {
  run: CLOCK.runS + CLOCK.tallyS,
  buy: CLOCK.buyS,
  met: 0
} as const;

/** The clock at the end of the events, each event's own seconds included. */
export function clockOf(events: readonly PlayEvent[]): number {
  return events.reduce<number>((t, e) => t + SECONDS[e.type], CLOCK.openingS);
}

export function checksOf(events: readonly PlayEvent[]): PlayReport['checks'] {
  let clock: number = CLOCK.openingS;
  let runsSince = 0;
  let buys = 0;
  let firstBuyClock: number | null = null;
  let earlyMax = 0;
  let runsMax = 0;
  let lastMapClock: number | null = null;
  let gapMax = 0;
  let buysSinceMet: number | null = null;
  let deadlineMin: number | null = null;
  for (const e of events) {
    clock += SECONDS[e.type];
    if (e.type === 'run') runsSince += 1;
    else if (e.type === 'buy') {
      buys += 1;
      firstBuyClock ??= clock;
      if (buys <= TARGETS.earlyPurchases) earlyMax = Math.max(earlyMax, runsSince);
      runsMax = Math.max(runsMax, runsSince);
      runsSince = 0;
      if (e.mapChange) {
        if (lastMapClock !== null) gapMax = Math.max(gapMax, clock - lastMapClock);
        lastMapClock = clock;
      }
      if (buysSinceMet !== null) buysSinceMet += 1;
    } else {
      if (buysSinceMet !== null) deadlineMin = Math.min(deadlineMin ?? Infinity, buysSinceMet);
      buysSinceMet = 0;
    }
  }
  const first = firstBuyClock ?? clock;
  const deadline = deadlineMin ?? 0;
  return [
    {
      id: 'first-purchase',
      value: first,
      target: TARGETS.firstPurchaseS,
      pass: firstBuyClock !== null && first <= TARGETS.firstPurchaseS
    },
    {
      id: 'early-runs-per-purchase',
      value: earlyMax,
      target: TARGETS.earlyRunsPerPurchase,
      pass: earlyMax <= TARGETS.earlyRunsPerPurchase
    },
    {
      id: 'runs-per-purchase',
      value: runsMax,
      target: TARGETS.runsPerPurchase,
      pass: runsMax <= TARGETS.runsPerPurchase
    },
    { id: 'map-gap', value: gapMax, target: TARGETS.mapGapS, pass: gapMax <= TARGETS.mapGapS },
    {
      id: 'purchases-per-deadline',
      value: deadline,
      target: TARGETS.purchasesPerDeadline,
      pass: deadlineMin === null || deadline >= TARGETS.purchasesPerDeadline
    }
  ];
}

/** 1.25 times current law rounded up to the next 1,000, and always above it. */
export function raiseTo(currentLaw: number): number {
  const raised = 1000 * Math.ceil((1.25 * currentLaw) / 1000);
  return raised > currentLaw ? raised : (Math.floor(currentLaw / 1000) + 1) * 1000;
}

export function sideReport(
  goals: readonly SideGoal[],
  atLaw: (rung: number) => ((g: SideGoal) => number | null) | null,
  metInHand: ReadonlySet<string>
): SideReport[] {
  return goals.map((g) => {
    const value = atLaw(g.ring)?.(g) ?? null;
    const target = SIDE_TUNING[g.id]?.target ?? 0;
    const flags: SideReport['flags'] = [];
    const atOrBelow = value !== null && target <= value;
    if (atOrBelow) flags.push('at-or-below-current-law');
    if (!metInHand.has(g.id)) flags.push('never-met');
    return {
      id: g.id,
      rung: g.ring,
      value,
      target,
      flags,
      raiseTo: atOrBelow ? raiseTo(value) : null
    };
  });
}

export type PlayEngine = Pick<Engine, 'datasetVersion' | 'asOf' | 'cal' | 'view'>;

export const MAX_RUNS = 300;
/** Runs in a row with nothing left to buy and the rung not met before a play is stuck. */
export const STUCK_RUNS = 3;

const DAY_MS = 86_400_000;

/** A day as the ISO timestamp the game state keeps (`firstWinAt`, a run's `at`). */
const isoOf = (day: Day): string => new Date(day * DAY_MS).toISOString();

/** The month of `deadline` in `view`, the dropped units there and the take at `share`. */
function takeAt(view: TimelineView, deadline: Day, share: number) {
  const index = deadlineIndex(deadline, view);
  const dropped = Math.max(0, view.rows[index]?.completedNet ?? 0);
  const take: RunTake = {
    dropped: { home: dropped },
    collected: { home: Math.floor(share * dropped) }
  };
  return { index, dropped, take };
}

type PlayOpts = { amount?: number; nodes?: readonly TreeNode[] };

/** One play, first run to finished, stuck or too-long. nodes defaults to NODES. */
export async function play(
  engine: PlayEngine,
  order: OrderName,
  mode: 'hand' | 'collect-for-me',
  opts: PlayOpts = {}
): Promise<PlayReport> {
  return (await playWithEvents(engine, order, mode, opts)).report;
}

/**
 * A play and its events: each run, `met` after the run that first meets its rung, then that
 * run's purchases in order, a purchase changing the map when its grant is not `hands` and the
 * document differs after it. The report's checks and clock come from these events.
 */
export async function playWithEvents(
  engine: PlayEngine,
  order: OrderName,
  mode: 'hand' | 'collect-for-me',
  opts: PlayOpts = {}
): Promise<{ report: PlayReport; events: PlayEvent[] }> {
  const nodes = opts.nodes ?? NODES;
  const events: PlayEvent[] = [];
  const at = isoOf(engine.asOf);
  let p: Played = {
    state: { ...NEW_GAME, phase: 'runs', firstWinAt: at },
    doc: DEFAULT_POLICY4
  };
  let pending: NodeId[] = order === 'cheapest' ? [] : sequenceOf(order, nodes);
  const runs: PlayReport['runs'] = [];
  let end: PlayReport['end'] = 'too-long';
  let idleMisses = 0;
  while (runs.length < MAX_RUNS) {
    const before = p.state;
    const idle = !leftToBuy(order, before, pending, nodes);
    const view = await engine.view(runnable(p.doc, limitsOf(before, nodes)));
    const goal = goalAt(engine.asOf, before.rung, opts.amount);
    const reading = readRun(view, goal);
    if (reading === null) throw new Error('the window is not filled');
    const { index, dropped, take } = takeAt(view, goal.deadline, shareOf(before, mode));
    const result = resultOf(
      before,
      reading,
      take,
      { view, index, take },
      {
        amount: goal.amount,
        datasetVersion: engine.datasetVersion,
        at
      }
    );
    const settled = settle(before, result);
    const run: PlayReport['runs'][number] = {
      n: runs.length + 1,
      rung: before.rung,
      homes: reading.homes,
      reachedOn: reading.reachedOn,
      dropped,
      collected: total(take.collected),
      balance: total(settled.units),
      bought: [],
      lump: result.lump === null ? 0 : total(result.lump),
      sideRewards: result.side.reduce((n, e) => n + total(e.reward), 0),
      sideMet: result.side.map((e) => e.id)
    };
    runs.push(run);
    events.push({ type: 'run' });
    if (settled.met.length > before.met.length) events.push({ type: 'met' });
    if (finished(settled)) {
      end = 'finished';
      break;
    }
    p = { state: takeNext(settled), doc: p.doc };
    let next = nextBuy(order, p.state, pending, nodes);
    while (next !== null) {
      const { id } = next;
      const level = (p.state.bought[id] ?? 0) + 1;
      const node = nodes.find((n) => n.id === id);
      if (node === undefined) throw new Error(`no node ${id}`);
      const after = buyAndApply(p, id, engine.cal, nodes);
      if (after === null) throw new Error(`the purchase of ${id} was refused`);
      const { price, grant } = node.levels[level - 1]!;
      run.bought.push({ id, level, price: total(price) });
      events.push({
        type: 'buy',
        mapChange: grant.tag !== 'hands' && canonicalJson(after.doc) !== canonicalJson(p.doc)
      });
      p = after;
      pending = next.pending;
      next = nextBuy(order, p.state, pending, nodes);
    }
    idleMisses = reading.reachedOn === null && idle ? idleMisses + 1 : 0;
    if (idleMisses >= STUCK_RUNS) {
      end = 'stuck';
      break;
    }
  }
  const report = { order, mode, runs, end, clockS: clockOf(events), checks: checksOf(events) };
  return { report, events };
}

/** Current law (the empty document's view) at each rung's deadline, as sideReport's atLaw. */
export async function currentLaw(
  engine: PlayEngine,
  amount?: number
): Promise<(rung: number) => ((g: SideGoal) => number | null) | null> {
  const view = await engine.view(DEFAULT_POLICY4);
  const readers: ((g: SideGoal) => number | null)[] = [];
  for (let rung = 0; rung < RUNGS; rung++) {
    const goal = goalAt(engine.asOf, rung, amount);
    const { index, take } = takeAt(view, goal.deadline, SHARE.base);
    readers.push((g) => g.read({ view, index, take })?.value ?? null);
  }
  return (rung) => readers[rung] ?? null;
}
