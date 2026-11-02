// /lesscars dated law (spec "Law", "Freed land"): SB 79 recomputed against the transit network as
// the plan has built it each year, and the regime views (parcel envelopes) the engine runs on for
// the plan and baseline arms. From the switch day each lot gets the larger of FZP and SB 79: the
// SB 79 row where its status is `applies`, the lot is not permanently exempt and SB 79 is more
// permissive (`mostPermissive`, a tie keeps FZP); otherwise FZP. This is the retired
// CURRENT_LAW_SWITCH rule (docs/dev/sim-levers.md at 53e8d5f, `currentLawAfterTable`).
//
// Builder's calls:
// - The Local Program stays in force after the switch, as DEFAULT_LEVERS keeps it: a regime view
//   is `parcelsView(parcels, table, parcels.localProgram)`.
// - Network snapshots are not stored: transit.json plus plan.json rebuild any day's network
//   through networkAt (src/lib/data/lesscars/network.ts).
// - "Transit-unlocked" is any change of a lot's engine row (stories, yields, hostable) between the
//   last plan regime and the baseline after-switch view, a closer stop of the same tier included,
//   since that is what changes its homes. A cap change alone does not change the engine row.
// - A plan regime is dropped when its table (stories, cap, yields, hostable) equals the previous
//   plan regime's row for row; the first plan regime (the switch) is always kept, like the
//   baseline's single regime, so the arms switch on the same day.
// - The switch must fall after `asOf` (the plan window starts in 2028, after any dataset's asOf);
//   buildRegimes throws otherwise. With the switch past the horizon there are no regimes.
// - A stop the plan improves twice (none → 2 → 1) is two TierChanges. A lot's reach counts a
//   changed stop under each tier it has reached by the day; counting a tier-1 stop also under
//   tier 2 changes nothing, since a tier-1 standard is at least the tier-2 one in every band.
// - lc_stops carries a `parcels` flag: parcels reach only changed stops (pol_tod holds today's),
//   freed sites reach every stop tiered on any day (they have no pol_tod row).
import {
  NULL_CAP,
  SB79_STATUSES,
  type PolicyParcels,
  type Sb79Status
} from '../../../src/lib/data/policy-codec';
import type { ParcelId, ParcelRecord } from '../../../src/lib/data/parcel';
import { scenarioRecordOf, type ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../../src/lib/data/scenario-yield';
import { mostPermissive } from '../../../src/lib/data/stock-layers';
import type { TransitNetwork } from '../../../src/lib/data/transit';
import type { EnvelopeRow } from '../../../src/lib/data/envelope-row';
import { networkAt, transitOpenDays } from '../../../src/lib/data/lesscars/network';
import type { LessCarsPlan } from '../../../src/lib/data/lesscars/plan';
import type { PlanSchedule } from '../../../src/lib/data/lesscars/schedule';
import type { EnvelopeTable } from '../../../src/lib/sim/levers/layers';
import { parcelsView } from '../../../src/lib/sim/levers/view';
import type { Day } from '../../../src/lib/timelapse/time';
import type { Duck } from '../duck';
import { bestStandard, sb79Row, stopTiers, zoneClassOf } from '../sb79';
import { MUNI_TIER2_STOP_IDS, type Sb79Tier, type TodBand } from '../../sb79-config';
import { reachLessCars, type ReachStop } from '../../steps/lesscars-sql';
import { freedFzpRow, type FreedSite } from './sites';

export interface TierChange {
  stopId: string;
  lngLat: [number, number];
  from: Day;
  tier: Sb79Tier;
}

/** A network snapshot builder; networkAt in production, a seam for tests. */
export type Snapshot = (
  base: TransitNetwork,
  plan: LessCarsPlan,
  s: PlanSchedule,
  day: Day
) => { net: TransitNetwork; tier2Ids: Set<string> };

/** The SB 79 tier of every tiered stop by id, with its point. */
function tiersById(
  net: TransitNetwork,
  tier2Ids: ReadonlySet<string>
): Map<string, { tier: Sb79Tier; lngLat: [number, number] }> {
  const out = new Map<string, { tier: Sb79Tier; lngLat: [number, number] }>();
  for (const [i, tier] of stopTiers(net, tier2Ids))
    out.set(net.stops[i].id, { tier, lngLat: net.stops[i].lngLat });
  return out;
}

/**
 * Every stop whose tier at some transit open day is better than it was before that day (today's
 * network first), sorted by (from, stopId). Each snapshot's tier-2 list is MUNI_TIER2_STOP_IDS
 * plus the snapshot's own. Throws when a stop's tier worsens (or it loses its tier) on any day.
 */
export function tierChanges(
  base: TransitNetwork,
  plan: LessCarsPlan,
  s: PlanSchedule,
  at: Snapshot = networkAt
): TierChange[] {
  const best = new Map<string, Sb79Tier>();
  for (const [id, t] of tiersById(base, MUNI_TIER2_STOP_IDS)) best.set(id, t.tier);
  const out: TierChange[] = [];
  for (const day of transitOpenDays(plan, s)) {
    const snap = at(base, plan, s, day);
    const tiers = tiersById(snap.net, new Set([...MUNI_TIER2_STOP_IDS, ...snap.tier2Ids]));
    for (const [id, was] of best) {
      const now = tiers.get(id)?.tier;
      if (now === undefined || now > was)
        throw new Error(
          `lesscars: the plan would worsen stop ${id} from tier ${was} to ${now ?? 'none'} on day ${day}`
        );
    }
    for (const [id, t] of tiers) {
      const was = best.get(id);
      if (was !== undefined && t.tier >= was) continue;
      out.push({ stopId: id, lngLat: t.lngLat, from: day, tier: t.tier });
      best.set(id, t.tier);
    }
  }
  return out.sort(
    (a, b) => a.from - b.from || (a.stopId < b.stopId ? -1 : a.stopId > b.stopId ? 1 : 0)
  );
}

/**
 * The regime days: the switch, then each open day after it up to the horizon; unique, ascending,
 * all after `asOf`. Openings on or before the switch fold into the switch regime. [] when the
 * switch is not in (asOf, horizon].
 */
export function regimeDays(
  switchDay: Day,
  openDays: readonly Day[],
  asOf: Day,
  horizon: Day
): Day[] {
  if (!(asOf < switchDay && switchDay <= horizon)) return [];
  const later = openDays.filter((d) => d > switchDay && d <= horizon);
  return [...new Set([switchDay, ...later])].sort((a, b) => a - b);
}

const topOf = (r: EnvelopeRow) => ({ yieldTop: r.yield[r.yield.length - 1], hostable: r.hostable });

/**
 * After the switch: the SB 79 row where its status is `applies`, the lot is not permanently
 * exempt and SB 79 is more permissive than FZP (a tie keeps FZP); otherwise the FZP row.
 */
export function afterSwitchRow(
  fzp: EnvelopeRow,
  sb: EnvelopeRow & { status: Sb79Status },
  exemptPermanent: boolean
): EnvelopeRow & { fromSb79: boolean } {
  const take =
    sb.status === 'applies' && !exemptPermanent && mostPermissive(topOf(fzp), topOf(sb)) === 'b';
  const r = take ? sb : fzp;
  return {
    stories: r.stories,
    cap: r.cap,
    yield: [...r.yield],
    hostable: r.hostable,
    fromSb79: take
  };
}

export interface RegimeSet {
  /** One entry: the switch, today's network (policy.bin SB 79 columns). */
  baseline: { day: Day; parcels: ScenarioParcels }[];
  /** The switch with the network at that day, then each later open day that changes a row. */
  plan: { day: Day; parcels: ScenarioParcels }[];
  /** T11 rows whose last plan row (stories, yields, hostable) differs from the baseline's. */
  unlocked: Uint8Array;
  /** Freed sites: FZP before the switch, after it afterSwitchRow on the site's own reach. */
  siteRowAt(siteId: string, day: Day): EnvelopeRow;
  /** Existing parcels in the plan arm: FZP before the switch, then the plan regime in force. */
  parcelRowAt(row: number, day: Day): EnvelopeRow;
}

type Reach = Partial<Record<Sb79Tier, number>>;

function emptyTable(count: number, F: number): EnvelopeTable {
  return {
    count,
    stories: new Uint8Array(count),
    cap: new Uint16Array(count).fill(NULL_CAP),
    yield: new Uint16Array(count * F),
    hostable: new Uint8Array(count)
  };
}

function copyTable(t: EnvelopeTable): EnvelopeTable {
  return {
    count: t.count,
    stories: t.stories.slice(),
    cap: t.cap.slice(),
    yield: t.yield.slice(),
    hostable: t.hostable.slice()
  };
}

function writeRow(t: EnvelopeTable, i: number, r: EnvelopeRow, F: number, id: string): void {
  if (r.stories > 0xff) throw new Error(`lesscars: parcel ${id} has ${r.stories} stories`);
  if (r.cap !== null && !(r.cap >= 0 && r.cap < NULL_CAP))
    throw new Error(`lesscars: parcel ${id} cap ${r.cap} does not fit u16`);
  t.stories[i] = r.stories;
  t.cap[i] = r.cap === null ? NULL_CAP : r.cap;
  t.hostable[i] = r.hostable ? 1 : 0;
  for (let k = 0; k < F; k++) {
    if (r.yield[k] > 0xffff)
      throw new Error(`lesscars: parcel ${id} yield ${r.yield[k]} too large`);
    t.yield[i * F + k] = r.yield[k];
  }
}

function readRow(t: EnvelopeTable, i: number, F: number): EnvelopeRow {
  return {
    stories: t.stories[i],
    cap: t.cap[i] === NULL_CAP ? null : t.cap[i],
    yield: Array.from(t.yield.subarray(i * F, (i + 1) * F)),
    hostable: t.hostable[i] === 1
  };
}

const sameArrays = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const sameTable = (a: EnvelopeTable, b: EnvelopeTable) =>
  sameArrays(a.stories, b.stories) &&
  sameArrays(a.cap, b.cap) &&
  sameArrays(a.yield, b.yield) &&
  sameArrays(a.hostable, b.hostable);

const keyOf = (b: { tier: Sb79Tier; band: TodBand } | null) => (b ? `${b.tier}:${b.band}` : '-');

/**
 * The plan and baseline regime sets. Needs on `db`: the policy step's pol_tod and carveFreedLand's
 * lc_site (both as `parcels` and `sites` were built); writes lc_stops and lc_reach. `records` are
 * the parcel records writeScenario took (the generator's grossAt, as writePolicy). SB 79 rows are
 * recomputed only for lots whose best standard differs from policy.bin's todTier/todBand; every
 * other lot reuses policy.bin's SB 79 columns. Throws when the switch is not after `asOf`.
 */
export async function buildRegimes(a: {
  db: Duck;
  parcels: ScenarioParcels;
  policy: PolicyParcels;
  records: Map<ParcelId, ParcelRecord>;
  sites: FreedSite[];
  base: TransitNetwork;
  plan: LessCarsPlan;
  schedule: PlanSchedule;
  switchDay: Day;
  asOf: Day;
  horizon: Day;
  capDay: Day;
}): Promise<RegimeSet> {
  const { parcels: s, policy: q, switchDay } = a;
  if (!(switchDay > a.asOf))
    throw new Error(`lesscars: switch day ${switchDay} is not after asOf ${a.asOf}`);
  if (q.count !== s.count) throw new Error('lesscars: policy.bin and parcels.bin differ in count');
  const n = s.count;
  const F = s.fillLevels.length;

  // ---- Stops and reach ----
  const changes = tierChanges(a.base, a.plan, a.schedule);
  const today = tiersById(a.base, MUNI_TIER2_STOP_IDS);
  const changesOf = new Map<string, TierChange[]>();
  for (const c of changes) {
    const l = changesOf.get(c.stopId);
    if (l) l.push(c);
    else changesOf.set(c.stopId, [c]);
  }
  const stops: ReachStop[] = changes.map((c) => ({
    id: c.stopId,
    tier: c.tier,
    lng: c.lngLat[0],
    lat: c.lngLat[1],
    parcels: true
  }));
  if (a.sites.length > 0)
    for (const [id, t] of today)
      stops.push({ id, tier: t.tier, lng: t.lngLat[0], lat: t.lngLat[1], parcels: false });
  await reachLessCars(a.db, stops);
  const reachRows = await a.db.all<{ id: string; stop_id: string; dist_m: number }>(
    'SELECT id, stop_id, dist_m FROM lc_reach ORDER BY id, stop_id'
  );
  const reachOf = new Map<string, { stopId: string; distM: number }[]>();
  for (const r of reachRows) {
    const l = reachOf.get(r.id);
    const e = { stopId: r.stop_id, distM: r.dist_m };
    if (l) l.push(e);
    else reachOf.set(r.id, [e]);
  }
  /** Add the tiers each reached stop holds on `day` to `reach` (per-tier minimum). */
  const addReach = (reach: Reach, id: string, day: Day, withToday: boolean): Reach => {
    for (const { stopId, distM } of reachOf.get(id) ?? []) {
      const tiers: Sb79Tier[] = [];
      const t0 = today.get(stopId);
      if (withToday && t0) tiers.push(t0.tier);
      for (const c of changesOf.get(stopId) ?? []) if (c.from <= day) tiers.push(c.tier);
      for (const t of tiers) if (reach[t] === undefined || distM < reach[t]) reach[t] = distM;
    }
    return reach;
  };
  const tod = await a.db.all<{ id: string; tier: number; dist_m: number }>(
    'SELECT id, tier, dist_m FROM pol_tod ORDER BY id, tier'
  );
  const todOf = new Map<string, Reach>();
  for (const t of tod) {
    const m = todOf.get(t.id) ?? {};
    m[t.tier as Sb79Tier] = t.dist_m;
    todOf.set(t.id, m);
  }

  // ---- Per-lot rows ----
  const grossFor = (rec: ParcelRecord) => {
    const memo = new Map<number, number>();
    return (stories: number) => {
      let g = memo.get(stories);
      if (g === undefined) memo.set(stories, (g = scenarioYield(rec, stories, null)));
      return g;
    };
  };
  const fzpRow = (i: number): EnvelopeRow => ({
    stories: s.envelopeStories[i],
    cap: q.fzpYieldCap[i] === NULL_CAP ? null : q.fzpYieldCap[i],
    yield: Array.from(s.yield.subarray(i * F, (i + 1) * F)),
    hostable: s.hostable[i] === 1
  });
  const policySb = (i: number): EnvelopeRow & { status: Sb79Status } => ({
    status: SB79_STATUSES[q.sb79Status[i]],
    stories: q.sb79Stories[i],
    cap: q.sb79Cap[i] === NULL_CAP ? null : q.sb79Cap[i],
    yield: Array.from(q.sb79Yield.subarray(i * F, (i + 1) * F)),
    hostable: q.hostableSb79[i] === 1
  });
  const baseTable = emptyTable(n, F);
  for (let i = 0; i < n; i++)
    writeRow(
      baseTable,
      i,
      afterSwitchRow(fzpRow(i), policySb(i), q.exemptPermanent[i] === 1),
      F,
      s.id[i]
    );

  const grossOfRow = new Map<number, (stories: number) => number>();
  const rowGross = (i: number) => {
    let g = grossOfRow.get(i);
    if (!g) {
      const rec = a.records.get(s.id[i]);
      if (!rec) throw new Error(`lesscars: parcel ${s.id[i]} has no record`);
      grossOfRow.set(i, (g = grossFor(scenarioRecordOf(s, i, rec))));
    }
    return g;
  };
  const recomputed = new Map<string, EnvelopeRow>();
  /** The plan-arm after-switch row of lot `i` with the network of `day`; null = baseline's. */
  const planRow = (i: number, day: Day): EnvelopeRow | null => {
    const id = s.id[i];
    if (!reachOf.has(id)) return null;
    const best = bestStandard(addReach({ ...(todOf.get(id) ?? {}) }, id, day, false));
    const was =
      q.todTier[i] === 0 ? null : { tier: q.todTier[i] as Sb79Tier, band: q.todBand[i] as TodBand };
    if (keyOf(best) === keyOf(was)) return null;
    const key = `${i}|${keyOf(best)}`;
    let r = recomputed.get(key);
    if (!r) {
      const code = q.useDistricts[q.useDistrict[i]];
      const sb = sb79Row({
        best,
        eligible: s.eligible[i] === 1,
        zone: zoneClassOf(code === '' ? null : code).zoneClass,
        rentControlLikely: s.rentControlLikely[i] === 1,
        lotAreaM2: s.lotAreaM2[i],
        existingUnits: s.existingUnits[i],
        grossAt: rowGross(i)
      });
      const row = afterSwitchRow(
        fzpRow(i),
        {
          status: sb.status,
          stories: sb.stories,
          cap: sb.cap,
          yield: sb.yield,
          hostable: sb.status === 'applies'
        },
        q.exemptPermanent[i] === 1
      );
      r = { stories: row.stories, cap: row.cap, yield: row.yield, hostable: row.hostable };
      recomputed.set(key, r);
    }
    return r;
  };
  const reachedRows: number[] = [];
  for (let i = 0; i < n; i++) if (reachOf.has(s.id[i])) reachedRows.push(i);

  // ---- Regimes ----
  const days = regimeDays(switchDay, transitOpenDays(a.plan, a.schedule), a.asOf, a.horizon);
  const view = (t: EnvelopeTable) => parcelsView(s, t, s.localProgram);
  const planTables: { day: Day; table: EnvelopeTable }[] = [];
  for (const day of days) {
    const t = copyTable(baseTable);
    for (const i of reachedRows) {
      const r = planRow(i, day);
      if (r) writeRow(t, i, r, F, s.id[i]);
    }
    const prev = planTables[planTables.length - 1];
    if (prev && sameTable(prev.table, t)) continue;
    planTables.push({ day, table: t });
  }
  const baseline = days.length === 0 ? [] : [{ day: switchDay, parcels: view(baseTable) }];
  const plan = planTables.map((g) => ({ day: g.day, parcels: view(g.table) }));

  const unlocked = new Uint8Array(n);
  const last = planTables[planTables.length - 1]?.table;
  if (last)
    for (let i = 0; i < n; i++) {
      const same =
        last.stories[i] === baseTable.stories[i] &&
        last.hostable[i] === baseTable.hostable[i] &&
        sameArrays(
          last.yield.subarray(i * F, (i + 1) * F),
          baseTable.yield.subarray(i * F, (i + 1) * F)
        );
      if (!same) unlocked[i] = 1;
    }

  // ---- Freed sites ----
  const siteOf = new Map(a.sites.map((x) => [x.siteId, x]));
  const siteGross = new Map<string, (stories: number) => number>();
  const siteRows = new Map<string, EnvelopeRow>();
  const siteRowAt = (siteId: string, day: Day): EnvelopeRow => {
    const site = siteOf.get(siteId);
    if (!site) throw new Error(`lesscars: no freed site ${siteId}`);
    let grossAt = siteGross.get(siteId);
    if (!grossAt) siteGross.set(siteId, (grossAt = grossFor(site.rec)));
    const fzp = freedFzpRow(site, a.capDay, grossAt);
    if (day < switchDay) return fzp;
    const best = bestStandard(addReach({}, siteId, day, true));
    const key = `${siteId}|${keyOf(best)}`;
    let r = siteRows.get(key);
    if (!r) {
      const sb = sb79Row({
        best,
        eligible: true,
        zone: zoneClassOf(site.zoning.zoningCode).zoneClass,
        rentControlLikely: false,
        lotAreaM2: site.rec.areaM2,
        existingUnits: 0,
        grossAt
      });
      const row = afterSwitchRow(
        fzp,
        {
          status: sb.status,
          stories: sb.stories,
          cap: sb.cap,
          yield: sb.yield,
          hostable: sb.status === 'applies'
        },
        false
      );
      r = { stories: row.stories, cap: row.cap, yield: row.yield, hostable: row.hostable };
      siteRows.set(key, r);
    }
    return { ...r, yield: [...r.yield] };
  };

  const parcelRowAt = (row: number, day: Day): EnvelopeRow => {
    if (!(Number.isInteger(row) && row >= 0 && row < n))
      throw new RangeError(`lesscars: parcel row ${row} out of range`);
    let t: EnvelopeTable | null = null;
    for (const g of planTables) if (g.day <= day) t = g.table;
    return t ? readRow(t, row, F) : fzpRow(row);
  };

  return { baseline, plan, unlocked, siteRowAt, parcelRowAt };
}
