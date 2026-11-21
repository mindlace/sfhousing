/**
 * What Activity, the detail column's rest face on /sim, shows: the totals so far at the playhead's
 * month (from today, under the headline's rule), cost while a Public money policy is in force, and
 * at today the starter policies. Pure TS.
 */
import { formatShortMonthYear } from '$lib/fzp/format';
import { moneyFigureAt } from '$lib/fzp/money-view';
import { STAGE_KEY } from '$lib/map/key/rows';
import { formatCount } from '$lib/scoreboard/format';
import type { ActivityEvent, ActivityKind } from './activity';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Calibration } from '$lib/timelapse/types';
import { addChoices, type AddChoice } from './add';
import type { SimPolicy4 } from './policy4';
import type { PlayheadAt } from './results';

export interface ActivityTotals {
  /** rows[i].entitledNew. */
  approved: number;
  /** rows[i].completedNet. */
  completed: number;
  /** rows[i].exitedUnits. */
  stopped: number;
  /** view.tiers[i]: veryLow + low + moderate + unrecorded (from today); null without tiers. */
  affordable: number | null;
  /** planEffect[i].completedNetNew while a policy is in force, else null. */
  effect: number | null;
  /** money.publicSpent[i] and the per added home figure; only while money is in force. */
  cost: { spent: number; perAddedHome: number | null } | null;
}

/**
 * The totals at the playhead's month. Null at today (nothing has happened from today yet), while
 * provisional, or when the month is not filled: `headlineAt`'s rule, so they agree with the header.
 * Reads one row of each series.
 */
export function activityTotals(
  view: TimelineView | null,
  at: PlayheadAt,
  opts: { provisional: boolean; inForce: boolean; moneyInForce: boolean }
): ActivityTotals | null {
  if (!view || opts.provisional || at.atToday) return null;
  const i = at.index;
  if (i < 0 || view.filledThrough < i) return null;
  const row = view.rows[i];
  const t = view.tiers?.[i];
  const money = view.money;
  return {
    approved: row.entitledNew,
    completed: row.completedNet,
    stopped: row.exitedUnits,
    affordable: t ? t.veryLow + t.low + t.moderate + t.unrecorded : null,
    effect: opts.inForce ? view.planEffect[i].completedNetNew : null,
    cost:
      opts.moneyInForce && money
        ? { spent: money.publicSpent[i], perAddedHome: moneyFigureAt(money, i).perAddedHome.all }
        : null
  };
}

/** A Public money policy is on with a span in the document. */
export function moneyInForce(doc: SimPolicy4): boolean {
  return doc.kinds.money.some((p) => p.on && p.spans.length > 0);
}

export interface Starter {
  choice: AddChoice;
  /** The button's words. */
  text: string;
  /** The add menu's label: what "Added: …" names. */
  label: string;
}

/** One per kind, in the timeline's order (open question 2). */
const STARTERS: { choice: AddChoice; text: string }[] = [
  { choice: { kind: 'zoning', what: 'transit' }, text: 'Taller near transit' },
  {
    choice: { kind: 'permitting', what: 'preset', preset: 'sb423Clock' },
    text: 'SB 423 approval clock'
  },
  { choice: { kind: 'money', what: 'preset', preset: 'housing-bond' }, text: 'A housing bond' }
];

const sameChoice = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Taller near transit (the default transit rule, label 'Transit rule'), SB 423 approval clock
 * (the permitting preset) and A housing bond (the funding preset), each only when
 * `addChoices(kind, cal, doc)` offers it, labelled as the add menu labels it.
 */
export function startersFor(cal: Calibration, doc: SimPolicy4): Starter[] {
  const out: Starter[] = [];
  for (const s of STARTERS) {
    const offer = addChoices(s.choice.kind, cal, doc).find((o) => sameChoice(o.choice, s.choice));
    if (offer) out.push({ choice: s.choice, text: s.text, label: offer.label });
  }
  return out;
}

export const ACTIVITY_COPY = {
  heading: 'Activity',
  details: 'Details',
  tryOne: 'Try one:',
  play: 'Press Play to see what gets built.',
  approved: 'Approved in new projects',
  completed: 'Completed',
  stopped: 'Stopped',
  affordable: 'Affordable',
  effect: 'From your policy',
  spent: 'All public money spent',
  perHome: 'Per funded home',
  noneAdded: 'no funded homes yet',
  latest: 'Latest',
  noEvents: 'No stage changes yet.',
  policyMark: '◆',
  underPolicy: 'Under your policy'
} as const;

/** One line of Activity's list, as SimActivity draws it. */
export interface ActivityItem {
  /** `row:kind`: the item's identity in the list. */
  key: string;
  stage: string;
  homes: string;
  /** The neighbourhood; null when unknown (no separator then). */
  place: string | null;
  when: string;
  policy: boolean;
}

/** The map key's words for each stage, so the list and the key cannot drift. */
const STAGE_WORD: Record<ActivityKind, string> = (() => {
  const label = (id: string) => STAGE_KEY.find((r) => r.id === id)!.label;
  return { approved: label('approved'), started: label('building'), completed: label('completed') };
})();

/**
 * One item of Activity's list, one line: the stage word as the map key names it ("Approved",
 * "Building", "Completed"), "120 homes", the neighbourhood (null when unknown) and the month.
 */
export function eventText(
  e: ActivityEvent,
  place: string | null
): { stage: string; homes: string; place: string | null; when: string } {
  return {
    stage: STAGE_WORD[e.kind],
    homes: `${formatCount(e.homes)} ${e.homes === 1 ? 'home' : 'homes'}`,
    place,
    when: formatShortMonthYear(e.day)
  };
}
