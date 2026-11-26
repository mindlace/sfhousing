// The reveal rules (pure, browser-safe): how far the playhead has been, and where an edit first
// changed what the person saw. Compared on the main thread, month by month as the new view fills,
// only once a refill has answered the edit, and never past the furthest month reached.
import type { MoneyView, TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { indexOfDay } from './playhead';
import { currentLawHomes } from './results';

/** A view and whether a policy was in force in the document it came from. */
export interface Side {
  view: TimelineView;
  inForce: boolean;
}

export interface Reveal {
  /** The furthest day the playhead has reached under the current rules; asOf on opening. */
  reached: Day;
  /**
   * Where the seen range starts: asOf on opening, the day of the last reset, lowered as the
   * playhead goes back. Months a reset jumped over lie before it and are not seen.
   */
  from: Day;
  /**
   * An edit's first changed month is being looked for: the view the person saw when the first
   * unsettled edit was made, and the next month to compare. Null otherwise.
   */
  finding: { before: Side; next: number } | null;
  /** The month index "Play from" offers; null: none. */
  playFrom: number | null;
}

/** { reached: asOf, from: asOf, finding: null, playFrom: null }: everything ahead is unseen. */
export function revealOpen(asOf: Day): Reveal {
  return { reached: asOf, from: asOf, finding: null, playFrom: null };
}

/** A policy change reset the playhead to `day`: the seen range restarts there (P16). */
export function resetReveal(_r: Reveal, day: Day): Reveal {
  return { reached: day, from: day, finding: null, playFrom: null };
}

/**
 * The playhead is at `day`: reached = max(reached, day), from = min(from, day); an offered
 * playFrom goes. Returns `r` itself when nothing changes.
 */
export function moved(r: Reveal, day: Day): Reveal {
  const reached = Math.max(r.reached, day);
  const from = Math.min(r.from, day);
  if (reached === r.reached && from === r.from && r.playFrom === null) return r;
  return { ...r, reached, from, playFrom: null };
}

/**
 * A store change. With a search under way its `before` is kept; else `before` (the view on show;
 * null: nothing to compare, no search). next = 0, playFrom = null.
 */
export function editedReveal(r: Reveal, before: Side | null): Reveal {
  const kept = r.finding?.before ?? before;
  return { ...r, finding: kept === null ? null : { before: kept, next: 0 }, playFrom: null };
}

/**
 * The newest view, once a refill has answered the edit (the caller passes only then). Compares
 * months next..limit, limit = min(now.view.filledThrough, before.view.filledThrough, m), where m
 * is the month of `reached` (-1 at today: reached on or before `at.asOf`, the dataset date). The
 * first k with monthChanged(before, now, k) ends the search:
 * reached = max(day, now.view.months[k]); playFrom = playing ? null : k. No change through m
 * ends it with nothing pulled back (reached stays at least `at.day`). Otherwise
 * next = limit + 1 (the fill is behind). Months past
 * before.view.filledThrough cannot be compared: once the new view has filled past it with no
 * change found, the first of them counts as the first changed month, since what cannot be shown
 * unchanged is unseen; so a search always ends. Returns `r` itself when there is no search or
 * nothing new was compared.
 */
export function scanned(
  r: Reveal,
  now: Side | null,
  at: { day: Day; playing: boolean; asOf: Day }
): Reveal {
  const f = r.finding;
  if (f === null || now === null) return r;
  const months = now.view.months;
  const m = r.reached <= at.asOf ? -1 : indexOfDay(months, r.reached);
  const beforeThrough = f.before.view.filledThrough;
  const limit = Math.min(now.view.filledThrough, beforeThrough, m);
  const found = (k: number): Reveal => ({
    reached: Math.max(at.day, months[k]),
    from: r.from,
    finding: null,
    playFrom: at.playing ? null : k
  });
  for (let k = f.next; k <= limit; k++) {
    if (monthChanged(f.before, now, k)) return found(k);
  }
  if (limit >= m) return { ...r, reached: Math.max(r.reached, at.day), finding: null };
  if (limit === beforeThrough && now.view.filledThrough > beforeThrough) {
    return found(beforeThrough + 1);
  }
  if (limit + 1 <= f.next) return r;
  return { ...r, finding: { before: f.before, next: limit + 1 } };
}

const POOL_FIELDS = [
  'received',
  'committed',
  'out',
  'spent',
  'repaid',
  'lost',
  'lostCredit'
] as const;

/** The per-month money series, each read at month i (a missing entry reads as zero). */
function poolAt(m: MoneyView, id: string, i: number): number[] {
  const p = m.pools.find((x) => x.id === id);
  return POOL_FIELDS.map((f) => p?.[f][i] ?? 0);
}

function moneyChanged(a: MoneyView | null, b: MoneyView | null, i: number): boolean {
  if (a === null || b === null) return a !== b;
  const flat = (m: MoneyView): unknown[] => [
    m.fundedHomes[i],
    m.displacedHomes[i],
    m.displacedHomesCompleted[i],
    m.publicSpent[i],
    m.perAddedHomeByMonth.all[i],
    m.perAddedHomeByMonth.city[i],
    m.displacedShareByMonth[i]
  ];
  const x = flat(a);
  const y = flat(b);
  if (x.some((v, k) => v !== y[k])) return true;
  const ids = new Set([...a.pools.map((p) => p.id), ...b.pools.map((p) => p.id)]);
  for (const id of ids) {
    const p = poolAt(a, id, i);
    const q = poolAt(b, id, i);
    if (p.some((v, k) => v !== q[k])) return true;
  }
  return false;
}

/** The current-law homes and approvals month i draws: rows less the effect while in force. */
function currentLaw(s: Side, i: number): [number, number] {
  const row = s.view.rows[i];
  if (!s.inForce) return [row.completedNet, row.entitledNew];
  return [currentLawHomes(s.view, i), row.entitledNew - s.view.planEffect[i].entitledNew];
}

/**
 * Whether month i shows a different number in b than in a: every field of rows[i] (inProgress
 * included), the current-law homes and approvals (rows minus planEffect while in force, rows alone
 * otherwise), tiers[i], and money at i (fundedHomes, displacedHomes, displacedHomesCompleted,
 * publicSpent, perAddedHomeByMonth, displacedShareByMonth, and each pool's per-month series matched
 * by id, a missing pool reading as zeros).
 */
export function monthChanged(a: Side, b: Side, i: number): boolean {
  const p = a.view.rows[i];
  const q = b.view.rows[i];
  if (
    p.completedNet !== q.completedNet ||
    p.completedNetPipeline !== q.completedNetPipeline ||
    p.completedNetNew !== q.completedNetNew ||
    p.entitledNew !== q.entitledNew ||
    p.exitedUnits !== q.exitedUnits
  ) {
    return true;
  }
  const s = p.inProgress;
  const t = q.inProgress;
  for (const k of Object.keys({ ...s, ...t }) as (keyof typeof s)[]) {
    if (s[k] !== t[k]) return true;
  }
  const x = currentLaw(a, i);
  const y = currentLaw(b, i);
  if (x[0] !== y[0] || x[1] !== y[1]) return true;
  const ta = a.view.tiers?.[i] ?? null;
  const tb = b.view.tiers?.[i] ?? null;
  if (ta !== tb) {
    if (ta === null || tb === null) return true;
    for (const k of Object.keys({ ...ta, ...tb }) as (keyof typeof ta)[]) {
      if (ta[k] !== tb[k]) return true;
    }
  }
  return moneyChanged(a.view.money, b.view.money, i);
}
