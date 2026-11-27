// Record targets and the cost ratio above the top anchor (building-choice spec, Acceptance and
// the parameter table).
import { describe, expect, it } from 'vitest';
import { MONTH_DAYS } from '../../src/lib/timelapse/time';
import type { ProjectHistory } from '../../src/lib/timelapse/types';
import { aboveTopCostRatio, recordTargets, type ParcelsForRecords } from '../lib/building-records';
import type { PermitRow } from '../lib/fzp-cal/types';
import { isoToDay } from '../project-records/multiphase';

const d = isoToDay;
const ASOF = d('2026-09-30');

let seq = 0;
function permit(over: Partial<PermitRow>): PermitRow {
  seq++;
  return {
    permit_number: `P${seq}`,
    project_id: null,
    prj_record_id: null,
    dva_record_id: null,
    prx_case_no: null,
    da: null,
    parcel_ids: [],
    proposed_units: 50,
    site_permit: true,
    status: 'issued',
    live: true,
    superseded: false,
    filed_day: d('2019-01-01'),
    issued_day: d('2020-01-01'),
    construction_day: null,
    complete_day: null,
    status_day: null,
    proposed_stories: 6,
    valuation: null,
    construction_type: 'V',
    ...over
  };
}

/** A completed permit-only history: entries in 2018, construction lasting `days`. */
function hist(
  id: string,
  stories: number,
  base: number,
  days: number,
  planningProposed: ProjectHistory['planningProposed'] = null
): ProjectHistory {
  const issued = d('2018-03-01');
  const fcd = issued + 100;
  const complete = fcd + days;
  return {
    id,
    pathway: 'permitOnly',
    parcelIds: [],
    entered: {
      permitFiled: d('2017-06-01'),
      permitIssued: issued,
      construction: fcd,
      complete
    },
    end: { kind: 'complete', day: complete },
    unitsAt: { permitFiled: 20 },
    existingUnits: 0,
    storiesProposed: stories,
    baseStoriesAtFiling: base,
    sources: [],
    quality: [],
    planningProposed
  };
}

const NO_PARCELS: ParcelsForRecords = {
  index: new Map(),
  lotAreaM2: new Uint32Array(0),
  baseStories: new Uint8Array(0)
};

describe('recordTargets on 40 histories', () => {
  // Base 6 (bucket ≤ 6). 30 build to the limit (10 of them affordable), 10 build half of it.
  // Construction runs 10, 20, ..., 400 days.
  const hs = Array.from({ length: 40 }, (_, i) => {
    const full = i < 30;
    const cohort = i < 10 ? { units: 20, affordable: 20 } : { units: 20, affordable: 0 };
    return hist(`h${String(i).padStart(2, '0')}`, full ? 6 : 3, 6, 10 * (i + 1), cohort);
  });
  const t = recordTargets(hs, [], NO_PARCELS, ASOF);
  const bucket = t.heightRatio.find((b) => b.upTo === 6)!;

  it('takes the latest ten record years, not before 2015', () => {
    expect(t.window).toEqual(['2016-09-30', '2026-09-30']);
  });

  it('gives the mean ratio and the binomial SE of the share at 0.9 of the limit', () => {
    expect(bucket.mean.n).toBe(40);
    expect(bucket.mean.stat).toBeCloseTo(0.875, 9);
    expect(bucket.mean.tol).toBe(0.1);
    expect(bucket.nearLimit.stat).toBe(0.75);
    // √(0.75 × 0.25 ÷ 40)
    expect(bucket.nearLimit.se).toBeCloseTo(0.0684653, 6);
    expect(bucket.nearLimit.tol).toBeCloseTo(2 * 0.0684653, 6);
    expect(bucket.nearLimit.checked).toBe(true);
    expect(t.heightRatio.find((b) => b.upTo === 4)!.mean.n).toBe(0);
  });

  it('gives the median SE 1.25 × IQR ÷ (1.35 √n) of a stage interval', () => {
    const c = t.stageMonths.construction;
    // stories 6 and 3 both sit in the ≤ 7 band
    expect(c.map((b) => [b.upTo, b.n])).toEqual([
      [4, 10],
      [7, 30]
    ]);
    // the ≤ 7 band: 10, 20, ..., 300 days; median 155, quartiles 82.5 and 227.5, IQR 145
    const b7 = c[1];
    expect(b7.stat).toBeCloseTo(155 / MONTH_DAYS, 9);
    const se = (1.25 * 145) / (1.35 * Math.sqrt(30)) / MONTH_DAYS;
    expect(b7.se).toBeCloseTo(se, 9);
    expect(b7.tol).toBeCloseTo(2 * se, 9);
    expect(b7.checked).toBe(true);
    expect(c[0].checked).toBe(false);
    // issued to first construction document: 100 days for all
    expect(t.stageMonths.permitIssued[1].stat).toBeCloseTo(100 / MONTH_DAYS, 9);
    expect(t.stageMonths.permitIssued[1].se).toBe(0);
  });

  it('compares the affordable and private cohorts by the SE of the difference', () => {
    // affordable: 10 at 1; private: 20 at 1 and 10 at 0.5
    expect(t.cohort.affordable).toEqual({ mean: 1, n: 10, se: 0 });
    expect(t.cohort.private.n).toBe(30);
    expect(t.cohort.private.mean).toBeCloseTo(25 / 30, 9);
    // sample SD √(1.6667 ÷ 29) over √30
    expect(t.cohort.private.se).toBeCloseTo(0.0437688, 6);
    expect(t.cohort.diff).toBeCloseTo(1 / 6, 9);
    expect(t.cohort.se).toBeCloseTo(0.0437688, 6);
  });
});

describe('recordTargets on permits', () => {
  it('gives the Type I share at 8 to 12 stories: 128 of 142 is 0.901', () => {
    const ps = Array.from({ length: 142 }, (_, i) =>
      permit({ proposed_stories: 10, construction_type: i < 128 ? 'I' : 'II' })
    );
    const t = recordTargets([], ps, NO_PARCELS, ASOF);
    const s = t.constructionType.typeIShare8to12;
    expect(s.n).toBe(142);
    expect(s.stat).toBeCloseTo(0.901, 3);
    expect(s.se).toBeCloseTo(Math.sqrt(((128 / 142) * (14 / 142)) / 142), 12);
    expect(s.checked).toBe(true);
    const b12 = t.constructionType.byBand.find((b) => b.upTo === 12)!;
    expect(b12).toEqual({ upTo: 12, n: 142, V: 0, III: 0, I: 128, other: 14 });
  });

  it('counts records over the type limits and leaves out superseded and early permits', () => {
    const ps = [
      permit({ proposed_stories: 7, construction_type: 'V' }),
      permit({ proposed_stories: 9, construction_type: 'III' }),
      permit({ proposed_stories: 8, construction_type: 'III' }),
      permit({ proposed_stories: 9, construction_type: 'III', superseded: true }),
      permit({ proposed_stories: 9, construction_type: 'III', issued_day: d('2015-06-01') }),
      permit({ proposed_stories: 9, construction_type: null })
    ];
    const t = recordTargets([], ps, NO_PARCELS, ASOF);
    expect(t.constructionType.recordsOver).toEqual({ V: 1, III: 1 });
    expect(t.constructionType.maxStories).toEqual({ V: 6, III: 8 });
  });

  it('gives the median homes of projects of 10 or more by band', () => {
    const ps = [5, 10, 20, 30].map((u) => permit({ proposed_units: u, proposed_stories: 6 }));
    const t = recordTargets([], ps, NO_PARCELS, ASOF);
    expect(t.homesPerProject).toHaveLength(1);
    expect(t.homesPerProject[0]).toMatchObject({ upTo: 7, n: 3, stat: 20, checked: false });
  });

  it('gives the large-lot Type I share at 13 or more stories, reported under n 30', () => {
    const parcels: ParcelsForRecords = {
      index: new Map([
        ['big-a', 0],
        ['big-b', 1],
        ['small', 2]
      ]),
      lotAreaM2: Uint32Array.from([900, 900, 1400]),
      baseStories: Uint8Array.from([15, 9, 20])
    };
    const big = ['big-a', 'big-b'];
    const ps = [
      permit({ parcel_ids: big, proposed_stories: 20, construction_type: 'I' }),
      permit({ parcel_ids: big, proposed_stories: 24, construction_type: 'I' }),
      permit({ parcel_ids: big, proposed_stories: 6, construction_type: 'III' }),
      permit({ parcel_ids: ['small'], proposed_stories: 20, construction_type: 'I' })
    ];
    const t = recordTargets([], ps, parcels, ASOF);
    expect(t.largeLotTypeI.n).toBe(3);
    expect(t.largeLotTypeI.stat).toBeCloseTo(2 / 3, 12);
    expect(t.largeLotTypeI.checked).toBe(false);
  });
});

/**
 * Cut from the raw DBI pull (i98e-djp9, types 1 and 2, 10 or more homes, 13 or more stories,
 * issued 2013 on), one row per permit number as permits.parquet has it (the pull repeats a permit
 * once per address): [permit, stories, homes, valuation, issued]. Valuation is `revised_cost`, else
 * `estimated_cost`.
 */
const TALL: [string, number, number, number, string][] = [
  ['200509193271', 42, 348, 139200000, '2013-11-08'],
  ['200605161774', 42, 452, 114050000, '2013-06-14'],
  ['200810315586', 13, 121, 25000000, '2013-07-22'],
  ['201207054130', 16, 273, 92000000, '2013-02-19'],
  ['201207124717', 39, 285, 110545000, '2013-05-29'],
  ['201207124724', 34, 245, 98015300, '2013-05-29'],
  ['201209069080', 19, 550, 133333000, '2013-10-31'],
  ['201212216752', 15, 190, 65000000, '2013-05-22'],
  ['201212246822', 16, 263, 106000000, '2013-10-02'],
  ['201304023626', 32, 479, 131088316, '2013-08-28'],
  ['201305015894', 54, 74, 136313594, '2013-12-26'],
  ['201307051190', 13, 162, 45000000, '2014-04-07'],
  ['201404304554', 35, 403, 106869000, '2015-07-02'],
  ['201406128212', 14, 303, 86400000, '2017-11-29'],
  ['201406138394', 14, 431, 108000000, '2016-05-23'],
  ['201406259481', 40, 390, 195723000, '2016-12-30'],
  ['201408133775', 16, 198, 86000000, '2015-08-04'],
  ['201412234418', 56, 546, 207680000, '2015-12-10'],
  ['201503110506', 42, 545, 189838000, '2016-02-18'],
  ['201510301302', 55, 156, 270000000, '2017-02-01'],
  ['201510301303', 60, 109, 520000000, '2017-07-05'],
  ['201511203265', 18, 501, 177300000, '2016-10-24'],
  ['201601278125', 14, 180, 65000000, '2018-05-04'],
  ['201602089004', 13, 470, 143982500, '2017-12-14'],
  ['201602099171', 14, 89, 23500000, '2019-08-12'],
  ['201604013681', 21, 120, 146916000, '2017-10-25'],
  ['201605046495', 26, 118, 43500000, '2017-03-21'],
  ['201606200387', 39, 550, 400000000, '2017-10-03'],
  ['201607142409', 13, 215, 88300000, '2020-01-02'],
  ['201609208248', 17, 174, 81000000, '2020-01-14'],
  ['201611283577', 27, 404, 133900000, '2019-01-22'],
  ['201611303826', 21, 299, 81500000, '2019-10-17'],
  ['201612165221', 13, 220, 87840048, '2019-04-04'],
  ['201612275918', 37, 80, 166000000, '2018-11-28'],
  ['201612285985', 13, 126, 38700000, '2018-09-07'],
  ['201706219947', 13, 52, 20000000, '2018-12-04'],
  ['201707172085', 13, 186, 60000000, '2018-12-07'],
  ['201712196900', 13, 168, 55000000, '2018-12-03'],
  ['201808066535', 21, 302, 84450000, '2019-08-02'],
  ['201810294361', 13, 176, 65000000, '2020-05-13'],
  ['201909050778', 14, 299, 90000000, '2022-12-22'],
  ['201912169619', 22, 250, 130240000, '2021-11-03'],
  ['201912230270', 18, 203, 70000000, '2021-05-24'],
  ['202102124635', 16, 501, 200000000, '2022-11-22'],
  ['202211045959', 15, 187, 86686000, '2023-10-13'],
  ['202211186863', 17, 184, 74471078, '2023-11-17'],
  ['202411215452', 22, 201, 89106417, '2025-10-16'],
  ['202411215486', 22, 102, 44553208, '2025-06-26'],
  ['202412035997', 17, 94, 70205789, '2025-11-07'],
  ['202512151804', 15, 175, 105000000, '2026-06-17'],
  ['202512161871', 16, 165, 57776592, '2026-06-26'],
  ['202512172072', 23, 233, 67250000, '2026-09-09']
];

describe('aboveTopCostRatio', () => {
  const rows = TALL.map(([n, stories, homes, valuation, issued]) =>
    permit({
      permit_number: n,
      proposed_stories: stories,
      proposed_units: homes,
      valuation,
      issued_day: d(issued),
      construction_type: 'I'
    })
  );

  it('divides the median valuation per home above 24 stories by that at 13 to 24', () => {
    const r = aboveTopCostRatio(rows);
    // issued 2015 on, one row per permit: 10 above 24 stories, 30 at 13 to 24
    expect(r.n).toEqual([10, 30]);
    expect(r.ratio).toBeCloseTo(1.208, 3);
    expect(r.provenance.tier).toBe(2);
    expect(r.provenance.label).toContain('weak');
    expect(r.provenance.n).toBe(40);
  });

  it('counts each permit once, however many rows carry its number', () => {
    // the raw pull has one row per address: repeat every permit, with a different valuation
    const repeats = rows.map((p) => ({ ...p, valuation: (p.valuation ?? 0) * 3 }));
    const r = aboveTopCostRatio([...rows, ...repeats]);
    expect(r).toEqual(aboveTopCostRatio(rows));
  });

  it('is 1 when either side has fewer than 10 permits, and says so', () => {
    const r = aboveTopCostRatio(rows.filter((p) => (p.proposed_stories ?? 0) <= 24).slice(0, 12));
    expect(r.ratio).toBe(1);
    expect(r.n[0]).toBe(0);
    expect(r.provenance.tier).toBe(4);
    expect(r.provenance.label).toContain('invented');
  });
});
