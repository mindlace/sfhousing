// Network snapshots, per-day SB 79 and regime views (lesscars Task 7), on the mini fixture build
// and the mini plan.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { NULL_CAP, SB79_STATUSES, type PolicyParcels } from '../../src/lib/data/policy-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { scenarioYield } from '../../src/lib/data/scenario-yield';
import { mostPermissive } from '../../src/lib/data/stock-layers';
import type { TransitNetwork } from '../../src/lib/data/transit';
import { networkAt } from '../../src/lib/data/lesscars/network';
import {
  LESSCARS_HORIZON,
  schedulePlan,
  type PlanSchedule
} from '../../src/lib/data/lesscars/schedule';
import type { LessCarsPlan } from '../../src/lib/data/lesscars/plan';
import type { Day } from '../../src/lib/timelapse/time';
import { SQL_VARS } from '../config';
import type { Duck } from '../lib/duck';
import {
  afterSwitchRow,
  buildRegimes,
  lotSb79Row,
  parcelGrossAt,
  regimeDays,
  tierChanges,
  type RegimeSet
} from '../lib/lesscars/regimes';
import { freedFzpRow, readFreedSites, type FreedSite } from '../lib/lesscars/sites';
import { stopTiers } from '../lib/sb79';
import { LC } from '../lesscars-config';
import { MUNI_TIER2_STOP_IDS } from '../sb79-config';
import { lesscarsMini, miniLessCarsPlan } from './lesscars-helpers';

const dayOf = (iso: string): Day => Date.parse(iso) / 86400000;
const SW = dayOf(LC.switchDay);

let db: Duck;
let parcels: ScenarioParcels;
let policy: PolicyParcels;
let transit: TransitNetwork;
let capDay: Day;
let plan: LessCarsPlan;
let schedule: PlanSchedule;
let sites: FreedSite[];
let regimes: RegimeSet;
let records: Map<string, ParcelRecord>;

beforeAll(async () => {
  const m = await lesscarsMini();
  ({ db, parcels, policy, transit, capDay } = m);
  plan = miniLessCarsPlan();
  schedule = schedulePlan(plan);
  sites = await readFreedSites(db, capDay);
  records = new Map(m.records.map((r) => [r.rec.id, r.rec]));
  regimes = await buildRegimes({
    db,
    parcels,
    policy,
    records,
    sites,
    base: transit,
    plan,
    schedule,
    switchDay: SW,
    asOf: capDay,
    horizon: LESSCARS_HORIZON,
    capDay
  });
});

const F = () => parcels.fillLevels.length;
const rowOf = (p: ScenarioParcels, i: number) => ({
  stories: p.envelopeStories[i],
  yield: Array.from(p.yield.subarray(i * F(), (i + 1) * F())),
  hostable: p.hostable[i]
});
const sameRow = (a: ScenarioParcels, b: ScenarioParcels, i: number) =>
  JSON.stringify(rowOf(a, i)) === JSON.stringify(rowOf(b, i));

describe('stopTiers', () => {
  it('stopTiers default is unchanged; a tier-2 set argument tiers a bus stop', () => {
    expect(stopTiers(transit)).toEqual(stopTiers(transit, MUNI_TIER2_STOP_IDS));
    const m1 = transit.stops.findIndex((s) => s.id === 'muni:m1');
    expect([stopTiers(transit).get(m1), stopTiers(transit, new Set(['muni:m1'])).get(m1)]).toEqual([
      undefined,
      2
    ]);
  });
});

describe('regimeDays', () => {
  const asOf = SW - 2000;
  const hz = SW + 5000;
  it('regimeDays merges equal days', () => {
    expect(regimeDays(SW, [SW, SW + 400, SW + 400], asOf, hz)).toEqual([SW, SW + 400]);
  });
  it('pre-switch openings fold into the switch regime', () => {
    expect(regimeDays(SW, [SW - 900, SW - 10], asOf, hz)).toEqual([SW]);
  });
  it('drops openings after the horizon, and has no regime when the switch is past it', () => {
    expect(regimeDays(SW, [SW + 10, hz + 1], asOf, hz)).toEqual([SW, SW + 10]);
    expect(regimeDays(SW, [SW + 10], asOf, SW - 1)).toEqual([]);
  });
});

describe('afterSwitchRow', () => {
  const fzp = { stories: 4, cap: 10, yield: [2, 4, 6, 8, 10], hostable: true };
  const sb = {
    stories: 8,
    cap: 40,
    yield: [10, 20, 30, 40, 40],
    hostable: true,
    status: 'applies' as const
  };
  it('takes SB 79 where it applies and allows more', () => {
    expect(afterSwitchRow(fzp, sb, false)).toEqual({
      stories: 8,
      cap: 40,
      yield: [10, 20, 30, 40, 40],
      hostable: true,
      fromSb79: true
    });
  });
  it('afterSwitchRow: exemptPermanent keeps FZP; a tie keeps FZP; min-units keeps FZP', () => {
    const keep = { ...fzp, fromSb79: false };
    expect(afterSwitchRow(fzp, sb, true)).toEqual(keep);
    expect(afterSwitchRow(fzp, { ...sb, yield: [1, 2, 3, 4, 10] }, false)).toEqual(keep);
    expect(afterSwitchRow(fzp, { ...sb, status: 'min-units' }, false)).toEqual(keep);
  });
});

describe('buildRegimes on the mini plan', () => {
  it('baseline after-switch equals the retired rule on every fixture row', () => {
    expect(regimes.baseline.map((g) => g.day)).toEqual([SW]);
    const view = regimes.baseline[0].parcels;
    const applies = SB79_STATUSES.indexOf('applies');
    const f = F();
    let tookSb79 = 0;
    for (let i = 0; i < parcels.count; i++) {
      const sbTop = {
        yieldTop: policy.sb79Yield[i * f + f - 1],
        hostable: !!policy.hostableSb79[i]
      };
      const fzpTop = { yieldTop: parcels.yield[i * f + f - 1], hostable: !!parcels.hostable[i] };
      const useSb79 =
        policy.sb79Status[i] === applies &&
        policy.exemptPermanent[i] === 0 &&
        mostPermissive(fzpTop, sbTop) === 'b';
      if (useSb79) tookSb79++;
      const want = useSb79
        ? {
            stories: policy.sb79Stories[i],
            yield: Array.from(policy.sb79Yield.subarray(i * f, (i + 1) * f)),
            hostable: policy.hostableSb79[i]
          }
        : rowOf(parcels, i);
      expect(rowOf(view, i), parcels.id[i]).toEqual(want);
    }
    // The rule bites on the fixture: some lot switches to SB 79.
    expect(tookSb79).toBeGreaterThan(0);
    expect(view.localProgram).toBe(parcels.localProgram);
    expect(view.id).toBe(parcels.id);
  });

  it('the recompute path reproduces policy.bin SB 79 at its own best standard on every row', () => {
    const f = F();
    let reached = 0;
    for (let i = 0; i < parcels.count; i++) {
      const best =
        policy.todTier[i] === 0
          ? null
          : { tier: policy.todTier[i] as 1 | 2, band: policy.todBand[i] as 1 | 2 | 3 };
      if (best) reached++;
      const r = lotSb79Row(
        parcels,
        policy,
        i,
        best,
        parcelGrossAt(parcels, i, records.get(parcels.id[i])!)
      );
      expect(
        {
          status: r.status,
          stories: r.stories,
          cap: r.cap === null ? NULL_CAP : r.cap,
          yield: r.yield,
          hostable: r.hostable ? 1 : 0
        },
        parcels.id[i]
      ).toEqual({
        status: SB79_STATUSES[policy.sb79Status[i]],
        stories: policy.sb79Stories[i],
        cap: policy.sb79Cap[i],
        yield: Array.from(policy.sb79Yield.subarray(i * f, (i + 1) * f)),
        hostable: policy.hostableSb79[i]
      });
    }
    // Every fixture lot is in reach, so the comparison covers the statute envelope, not 'outside'.
    expect(reached).toBe(parcels.count);
    expect(new Set(Array.from(policy.sb79Status)).size).toBeGreaterThan(2);
  });

  it('the mini subway unlocks lots near its stops after it opens, and only those', async () => {
    const subway = plan.projects.find((p) => p.id === 'subway');
    if (subway?.kind !== 'transit-line') throw new Error('no subway');
    const open = schedule.times.get('subway')!.openDay;
    expect(open).toBeGreaterThan(SW);
    expect(regimes.plan.map((g) => g.day)).toEqual([SW, open]);
    // Lots within ½ mile of a subway stop (as pol_tod measures, from geom_orig).
    const pts = subway.stops.flatMap((st) => (st.lngLat ? [st.lngLat] : []));
    const near = new Set(
      (
        await db.all<{ id: string }>(
          `SELECT DISTINCT p.id FROM parcels p,
                (SELECT unnest([${pts.map((q) => q[0]).join(', ')}]) AS lng,
                        unnest([${pts.map((q) => q[1]).join(', ')}]) AS lat) s
           WHERE ST_Distance(p.geom_orig, ST_Transform(ST_Point(s.lng, s.lat), 'EPSG:4326',
                             'EPSG:7131', always_xy := true)) <= ${SQL_VARS.tod_half_m}`
        )
      ).map((r) => r.id)
    );
    const [before, after] = regimes.plan.map((g) => g.parcels);
    const changed: string[] = [];
    for (let i = 0; i < parcels.count; i++)
      if (!sameRow(before, after, i)) changed.push(parcels.id[i]);
    expect(changed.length).toBeGreaterThan(0);
    for (const id of changed) expect(near, id).toContain(id);
    // Every lot the subway changed is transit-unlocked, and every unlocked lot differs from the
    // baseline after-switch row in the last plan regime.
    const unlocked = new Set(parcels.id.filter((_, i) => regimes.unlocked[i] === 1));
    for (const id of changed) expect(unlocked, id).toContain(id);
    const base = regimes.baseline[0].parcels;
    for (let i = 0; i < parcels.count; i++)
      expect(regimes.unlocked[i] === 1, parcels.id[i]).toBe(!sameRow(base, after, i));
    // parcelRowAt follows the plan arm: FZP before the switch, then the regime in force.
    const i = parcels.id.indexOf(changed[0]);
    const at = (d: Day) => {
      const r = regimes.parcelRowAt(i, d);
      return { stories: r.stories, yield: r.yield, hostable: r.hostable ? 1 : 0 };
    };
    expect(at(SW - 1)).toEqual(rowOf(parcels, i));
    expect(at(open - 1)).toEqual(rowOf(before, i));
    expect(at(open)).toEqual(rowOf(after, i));
  });

  it('tierChanges throws when a plan would worsen a stop tier', () => {
    expect(tierChanges(transit, plan, schedule).length).toBeGreaterThan(0);
    // A snapshot that drops the network's heavy rail worsens every tier-1 stop.
    const worse = (_b: TransitNetwork, _p: LessCarsPlan, _s: PlanSchedule, _d: Day) => ({
      net: { ...transit, patterns: transit.patterns.filter((p) => p.mode !== 'heavy-rail') },
      tier2Ids: new Set<string>()
    });
    expect(() => tierChanges(transit, plan, schedule, worse)).toThrow(/worsen/);
    expect(() => tierChanges(transit, plan, schedule, networkAt)).not.toThrow();
  });

  it('siteRowAt is FZP before the switch and at least FZP after', () => {
    const hwy = sites.filter((s) => s.projectId === 'hwy');
    expect(hwy.length).toBeGreaterThan(0);
    const top = (r: { yield: number[] }) => r.yield[r.yield.length - 1];
    let raised = 0;
    for (const s of hwy) {
      const fzp = freedFzpRow(s, capDay, (st) => scenarioYield(s.rec, st, null));
      expect(regimes.siteRowAt(s.siteId, SW - 1), s.siteId).toEqual(fzp);
      for (const d of [SW, LESSCARS_HORIZON]) {
        const r = regimes.siteRowAt(s.siteId, d);
        expect(top(r), s.siteId).toBeGreaterThanOrEqual(top(fzp));
        if (top(r) > top(fzp)) raised++;
      }
    }
    // SB 79 bites on the fixture: a capped RM-1 piece beside BART takes the statute envelope.
    expect(raised).toBeGreaterThan(0);
    expect(() => regimes.siteRowAt('lc:nope:0', SW)).toThrow(/nope/);
  });
});
