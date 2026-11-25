// G6: side goals, the eleven small goals a run can meet beside its deadline.
import { formatCount } from '$lib/scoreboard/format';
import type { TimelineView } from '$lib/sim/world/score/types';
import { SIDE_TUNING } from './catalogue/tuning';
import type { RunTake } from './run-result';
import type { GameState, Units } from './state';
import { total } from './units';

export interface SideInput {
  view: TimelineView;
  index: number;
  take: RunTake;
}

export interface SideGoal {
  id: string;
  label: string;
  ring: number;
  reward: Units;
  read(i: SideInput): { value: number; target: number } | null;
}

type Read = SideGoal['read'];
type Tuning = Readonly<Record<string, { target: number; reward: Units }>>;

const inView = (v: TimelineView, i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i <= v.filledThrough;

/** The plan less current law, 0 with nothing in force (compare 'preFzp'). */
const effect =
  (field: 'completedNetNew' | 'entitledNew') =>
  (target: number): Read =>
  ({ view, index }) => {
    if (!inView(view, index)) return null;
    const row = view.planEffect[index];
    if (row === undefined) return null;
    return { value: view.compare === 'preFzp' ? 0 : row[field], target };
  };

/** floor(100 × collected / dropped). */
const share =
  (target: number): Read =>
  ({ take }) => {
    const dropped = total(take.dropped);
    if (dropped === 0) return null;
    return { value: Math.floor((100 * total(take.collected)) / dropped), target };
  };

const collected =
  (target: number): Read =>
  ({ take }) => ({ value: total(take.collected), target });

/** Grants paid from pools the player added (ids begin 'u-'), whole millions. */
const newMoney =
  (target: number): Read =>
  ({ view, index }) => {
    if (view.money === null || !inView(view, index)) return null;
    let spent = 0;
    for (const p of view.money.pools) if (p.id.startsWith('u-')) spent += p.spent[index] ?? 0;
    return { value: Math.floor(spent / 1_000_000), target };
  };

const funded =
  (target: number): Read =>
  ({ view, index }) => {
    if (view.money === null || !inView(view, index)) return null;
    const v = view.money.fundedHomes[index];
    return v === undefined ? null : { value: v, target };
  };

const building =
  (target: number): Read =>
  ({ view, index }) => {
    if (!inView(view, index)) return null;
    const row = view.rows[index];
    return row === undefined ? null : { value: row.inProgress.construction, target };
  };

/** Very low, low, moderate and unrecorded: the Activity panel's "Affordable". */
const affordable =
  (target: number): Read =>
  ({ view, index }) => {
    if (view.tiers === null || !inView(view, index)) return null;
    const t = view.tiers[index];
    if (t === undefined) return null;
    return { value: t.veryLow + t.low + t.moderate + t.unrecorded, target };
  };

interface Def {
  id: string;
  ring: number;
  label(n: string): string;
  read(target: number): Read;
}

const homes = (n: string) => `${n} homes from your policy`;
const pct = (n: string) => `Collect ${n}% of the homes in a run`;

const DEFS: readonly Def[] = [
  { id: 'policy-homes-1', ring: 0, label: homes, read: effect('completedNetNew') },
  { id: 'collect-share-1', ring: 0, label: pct, read: share },
  {
    id: 'approved-homes',
    ring: 0,
    label: (n) => `${n} more homes approved`,
    read: effect('entitledNew')
  },
  { id: 'collect-run', ring: 0, label: (n) => `Collect ${n} homes in a run`, read: collected },
  { id: 'policy-homes-2', ring: 1, label: homes, read: effect('completedNetNew') },
  { id: 'new-money', ring: 1, label: (n) => `$${n} million of new money granted`, read: newMoney },
  {
    id: 'funded-homes',
    ring: 1,
    label: (n) => `${n} homes built with public money`,
    read: funded
  },
  { id: 'collect-share-2', ring: 1, label: pct, read: share },
  {
    id: 'building-homes',
    ring: 1,
    label: (n) => `${n} homes being built at once`,
    read: building
  },
  {
    id: 'affordable-homes',
    ring: 2,
    label: (n) => `${n} affordable homes built`,
    read: affordable
  },
  { id: 'policy-homes-3', ring: 2, label: homes, read: effect('completedNetNew') }
];

/** The goals DEFS defines, each with its tuning; a goal with no tuning entry is left out. */
export function sideGoals(tuning: Tuning): SideGoal[] {
  return DEFS.flatMap((d) => {
    const t = tuning[d.id];
    if (t === undefined) return [];
    return [
      Object.freeze({
        id: d.id,
        label: d.label(formatCount(t.target)),
        ring: d.ring,
        reward: Object.freeze({ ...t.reward }),
        read: d.read(t.target)
      })
    ];
  });
}

export const SIDE_GOALS: readonly SideGoal[] = Object.freeze(sideGoals(SIDE_TUNING));

export const SIDE_SHOWN = 3;

export function sideShown(s: GameState, goals: readonly SideGoal[] = SIDE_GOALS): SideGoal[] {
  return goals.filter((g) => g.ring <= s.rung && !Object.hasOwn(s.side, g.id)).slice(0, SIDE_SHOWN);
}
