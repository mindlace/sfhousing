// Height-band stage time (building-choice spec, construction time by height band; ruling F8):
// bands, the thin-band merge, multipliers against the pooled median and the provenance.
import { describe, expect, it } from 'vitest';
import { MONTH_DAYS } from '../../src/lib/timelapse/time';
import type { Day, Stage } from '../../src/lib/timelapse/types';
import { LIVE_CAL } from '../lib/fzp-cal/config';
import { fitHeightTime } from '../lib/fzp-cal/height-time';
import type { CalStage, NormHistory, Spell } from '../lib/fzp-cal/types';
import { isoToDay } from '../project-records/multiphase';

const d = isoToDay;
const ASOF = d('2026-09-30');
const WINDOW: [Day, Day] = [d('2015-01-01'), ASOF];
const CAL = { ...LIVE_CAL, sizeMinN: 3 };

/** Every timed stage's start and end recorded, unless `missing` names one. */
function hist(id: string, stories: number | null, missing?: Stage): NormHistory {
  const end = { kind: 'open', lastObserved: ASOF } as const;
  const entered: Partial<Record<Stage, Day>> = {
    permitFiled: d('2019-01-01'),
    permitIssued: d('2020-01-01'),
    construction: d('2020-06-01'),
    complete: d('2023-01-01')
  };
  if (missing) delete entered[missing];
  return {
    id,
    pathway: 'permitOnly',
    parcelIds: [],
    eff: {},
    end,
    purgeCensored: false,
    src: {
      id,
      pathway: 'permitOnly',
      parcelIds: [],
      entered,
      end,
      unitsAt: {},
      existingUnits: 0,
      storiesProposed: stories,
      baseStoriesAtFiling: null,
      sources: [],
      quality: []
    }
  };
}

function spell(projectId: string, stage: CalStage, x: number, over: Partial<Spell> = {}): Spell {
  return {
    pathway: 'permitOnly',
    stage,
    a: 0,
    e: d('2020-03-01'),
    x,
    outcome: 'advance',
    projectId,
    ...over
  };
}

/** `n` histories at `stories`, each with a filed, issued and construction spell. */
function band(prefix: string, n: number, stories: number, days: [number, number, number]) {
  const hs = Array.from({ length: n }, (_, i) => hist(`${prefix}${i}`, stories));
  const ss = hs.flatMap((h) => [
    spell(h.id, 'permitFiled', days[0]),
    spell(h.id, 'permitIssued', days[1]),
    spell(h.id, 'construction', days[2])
  ]);
  return { hs, ss };
}

describe('fitHeightTime', () => {
  // ≤ 4: 4 histories; 5 to 7: 4; 8 to 12: 1 (thin); 13 to 20: none; 21 and above: 4.
  const a = band('a', 4, 3, [300, 90, 300]);
  const b = band('b', 4, 6, [400, 180, 600]);
  const c = band('c', 1, 10, [400, 180, 900]);
  const e = band('e', 4, 30, [500, 270, 1200]);
  const noise = [
    // outside the window, censored, an exit and a history with no stories: none counts
    spell('a0', 'construction', 5000, { e: d('2014-06-01') }),
    spell('a1', 'construction', 5000, { outcome: 'censored' }),
    spell('a2', 'construction', 5000, { outcome: 'withdrawn' }),
    spell('z0', 'construction', 5000)
  ];
  const hs = [...a.hs, ...b.hs, ...c.hs, ...e.hs, hist('z0', null)];
  const ss = [...a.ss, ...b.ss, ...c.ss, ...e.ss, ...noise];
  const fit = fitHeightTime(ss, hs, CAL, WINDOW, ASOF);

  it('merges a band with fewer than sizeMinN spells into the band below', () => {
    expect(fit.model.upTo).toEqual([4, 20, 999]);
  });

  it('gives each band its median completed spell over the pooled median, per stage', () => {
    const [step] = fit.model.steps;
    // construction pooled: 300 x4, 600 x4, 900, 1200 x4 -> median 600
    expect(step.value.construction).toEqual([0.5, 1, 2]);
    // permitIssued pooled: 90 x4, 180 x5, 270 x4 -> median 180
    expect(step.value.permitIssued).toEqual([0.5, 1, 1.5]);
    const months = [300, 600, 1200].map((x) => x / MONTH_DAYS);
    step.value.constructionMonths.forEach((m, i) => expect(m).toBeCloseTo(months[i], 2));
  });

  it('ships one step from asOf and tier-0 provenance', () => {
    expect(fit.model.steps).toHaveLength(1);
    expect(fit.model.steps[0].from).toBe(ASOF);
    const p = fit.model.provenance;
    expect(p.tier).toBe(0);
    // 13 histories, one permitIssued and one construction spell each
    expect(p.n).toBe(26);
    expect(p.window).toEqual(['2015-01-01', '2026-09-30']);
    expect(p.sources.every((s) => s.url.startsWith('https:'))).toBe(true);
  });

  it('reports the filed-to-issued medians by band, in months', () => {
    expect(fit.filedToIssued.map((r) => [r.upTo, r.n])).toEqual([
      [4, 4],
      [20, 5],
      [999, 4]
    ]);
    expect(fit.filedToIssued[0].median).toBeCloseTo(300 / MONTH_DAYS, 2);
    expect(fit.filedToIssued[1].median).toBeCloseTo(400 / MONTH_DAYS, 2);
  });

  it('merges on the thinner of the two stages', () => {
    // band 5 to 7 has 4 construction spells but only 2 permitIssued spells
    const thin = band('t', 4, 6, [400, 180, 600]);
    const ss2 = [
      ...a.ss,
      ...thin.ss.filter((s) => !(s.stage === 'permitIssued' && s.projectId >= 't2')),
      ...e.ss
    ];
    const f = fitHeightTime(ss2, [...a.hs, ...thin.hs, ...e.hs], CAL, WINDOW, ASOF);
    expect(f.model.upTo).toEqual([20, 999]);
  });

  it('leaves out a spell whose start or end the records do not hold', () => {
    // a3's construction entry was imputed: its permitIssued and construction spells are untimed,
    // so ≤ 4 keeps 3 histories (4 would keep it a band) and merges into the band above
    const hs2 = [...a.hs.slice(0, 3), hist('a3', 3, 'construction'), ...b.hs, ...e.hs];
    const f = fitHeightTime(
      [...a.ss, ...b.ss, ...e.ss],
      hs2,
      { ...CAL, sizeMinN: 4 },
      WINDOW,
      ASOF
    );
    expect(f.model.upTo).toEqual([20, 999]);
    const all = fitHeightTime(
      [...a.ss, ...b.ss, ...e.ss],
      [...a.hs, ...b.hs, ...e.hs],
      { ...CAL, sizeMinN: 4 },
      WINDOW,
      ASOF
    );
    expect(all.model.upTo).toEqual([4, 20, 999]);
  });

  it('falls back to one band at multiplier 1 with no records, flagged invented', () => {
    const f = fitHeightTime([], [], CAL, WINDOW, ASOF);
    expect(f.model.upTo).toEqual([999]);
    expect(f.model.steps[0].value).toEqual({
      permitIssued: [1],
      construction: [1],
      constructionMonths: [0]
    });
    expect(f.model.provenance.tier).toBe(4);
    expect(f.model.provenance.label).toContain('invented');
    expect(f.filedToIssued).toEqual([]);
  });
});
