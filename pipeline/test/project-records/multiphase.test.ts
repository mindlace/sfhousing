import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MultiphaseFileSchema,
  MultiphaseFormatError,
  parseMultiphase,
  type MultiphaseEntry,
  type MultiphaseFile,
  type MultiphasePhase
} from '../../enrichment/schema';
import { parseProjectsFile } from '../../../src/lib/timelapse/projects';
import { deriveProjects, type DeriveResult } from '../../project-records/derive';
import { checkV21, checkV24 } from '../../project-records/invariants';
import {
  SCALE_BOUNDS,
  buildPhases,
  checkMultiphaseFile,
  largestRemainder,
  median,
  netMasters,
  type PhaseContext
} from '../../project-records/multiphase';
import type { PipelineRow, ProjectSourceId, RawRow } from '../../project-records/types';
import { ASOF, PARCELS, baseInput, baseMultiphase, baseRaw } from './derive-input';

function d(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

const MINI = fileURLToPath(new URL('../fixtures/mini/enrichment/multiphase.json', import.meta.url));
const LIVE = fileURLToPath(new URL('../../enrichment/multiphase.json', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function mini(): MultiphaseFile {
  return parseMultiphase(readJson(MINI));
}

/** A deep copy of the mini file as plain JSON, for mutation. */
function miniJson(): {
  schema: number;
  projects: Record<string, unknown>[];
} {
  return JSON.parse(readFileSync(MINI, 'utf8'));
}

const FACT = {
  url: 'https://example.invalid/fixture-da.pdf',
  retrieved: '2026-10-01',
  locator: 'Exhibit B'
};

function row(over: Partial<PipelineRow> = {}): PipelineRow {
  return {
    idx: 0,
    blklot: null,
    nameaddr: null,
    status: 'PL Approved',
    statusDay: null,
    approvedDay: null,
    caseNo: null,
    bpaNo: null,
    newUnits: null,
    existingUnits: null,
    proposedUnits: null,
    completedNewUnits: null,
    netUnits: null,
    description: null,
    da: null,
    prx: false,
    ...over
  };
}

function phase(over: Partial<MultiphasePhase> = {}): MultiphasePhase {
  return {
    name: 'Phase',
    units: 100,
    blklots: [],
    plannedPermitFiled: null,
    status: 'remaining',
    facts: { units: FACT, blklots: FACT },
    ...over
  };
}

function entry(phases: MultiphasePhase[], caseNo = '2007.0001PRX'): MultiphaseEntry {
  return {
    caseNo,
    label: 'Test DA',
    schedule: {
      label: 'Test schedule',
      url: 'https://example.invalid/s.pdf',
      retrieved: '2026-10-01'
    },
    searched: [],
    phases
  };
}

/** Identity resolver: a blklot is its own parcel id. */
function ctx(over: Partial<PhaseContext> = {}): PhaseContext {
  return {
    master: row({ caseNo: '2007.0001PRX', prx: true, newUnits: 300, blklot: '3512014' }),
    entry: null,
    masterEntitled: d('2008-06-12'),
    daParcels: [],
    excluded: new Set(),
    trackingParcels: ['3512014'],
    projectU: null,
    citywideU: null,
    resolve: (blklots) => [...new Set(blklots)].sort(),
    areaM2: () => 100,
    ...over
  };
}

const M9_SOURCE = {
  label: 'Fixture Shipyard DA phasing schedule',
  url: 'https://example.invalid/fixture-da.pdf',
  retrieved: '2026-10-01'
};

describe('MultiphaseFileSchema', () => {
  it('accepts the mini enrichment file', () => {
    const f = mini();
    expect(f.schema).toBe(1);
    expect(f.projects.map((p) => p.caseNo)).toEqual(['2007.0001PRX', '2010.0002PRX']);
    expect(f.projects[0].phases.map((p) => [p.name, p.units, p.blklots, p.status])).toEqual([
      ['Phase A', 120, ['3512014'], 'remaining'],
      ['Phase B', 180, ['3512002'], 'remaining'],
      ['Phase C', 40, ['3512007'], 'built']
    ]);
    expect(f.projects[1].schedule).toBeNull();
    expect(f.projects[1].searched).toHaveLength(1);
  });

  it('accepts the committed live file', () => {
    expect(parseMultiphase(readJson(LIVE)).schema).toBe(1);
  });

  it('rejects a fact without a url', () => {
    const j = miniJson();
    const phases = j.projects[0].phases as { facts: { units: Record<string, unknown> } }[];
    delete phases[0].facts.units.url;
    expect(() => parseMultiphase(j)).toThrow(MultiphaseFormatError);
  });

  it('rejects a fact without a retrieval date', () => {
    const j = miniJson();
    const phases = j.projects[0].phases as { facts: { blklots: Record<string, unknown> } }[];
    delete phases[1].facts.blklots.retrieved;
    expect(() => parseMultiphase(j)).toThrow(MultiphaseFormatError);
  });

  it('rejects schedule null with an empty searched list', () => {
    const j = miniJson();
    j.projects[1].searched = [];
    expect(() => parseMultiphase(j)).toThrow(/searched/);
  });

  it('rejects phases when schedule is null', () => {
    const j = miniJson();
    j.projects[1].phases = (j.projects[0].phases as unknown[]).slice(0, 1);
    expect(() => parseMultiphase(j)).toThrow(MultiphaseFormatError);
  });

  it('requires separateRef exactly when status is separate', () => {
    const j = miniJson();
    const phases = j.projects[0].phases as Record<string, unknown>[];
    phases[2].status = 'separate';
    expect(() => parseMultiphase(j)).toThrow(/separateRef/);
    phases[2].separateRef = { dataset: '6jgi-cpb4', id: '2007.0001PRX', key: 'case_no' };
    expect(parseMultiphase(j).projects[0].phases[2].separateRef).toEqual({
      dataset: '6jgi-cpb4',
      id: '2007.0001PRX',
      key: 'case_no'
    });
    phases[2].status = 'built';
    expect(() => parseMultiphase(j)).toThrow(/separateRef/);
  });

  it('rejects a bad date, a bad url and an unknown schema', () => {
    const bad = miniJson();
    (bad.projects[0].schedule as Record<string, unknown>).retrieved = '2026-1-01';
    expect(() => parseMultiphase(bad)).toThrow(MultiphaseFormatError);
    const url = miniJson();
    (url.projects[0].schedule as Record<string, unknown>).url = 'not a url';
    expect(() => parseMultiphase(url)).toThrow(MultiphaseFormatError);
    const schema = miniJson();
    schema.schema = 2;
    expect(() => parseMultiphase(schema)).toThrow(MultiphaseFormatError);
    expect(MultiphaseFileSchema.safeParse({ schema: 1, projects: [] }).success).toBe(true);
  });
});

describe('checkMultiphaseFile', () => {
  const asOf = d('2026-10-16');
  const prx = [
    row({ idx: 1, caseNo: '2007.0001PRX', prx: true, newUnits: 300 }),
    row({ idx: 2, caseNo: '2010.0002PRX', prx: true, newUnits: 100 })
  ];

  it('passes the mini file against its PRX rows', () => {
    expect(checkMultiphaseFile(mini(), prx, asOf)).toEqual([]);
  });

  it('flags a caseNo absent from the pipeline and a PRX row with units lacking an entry', () => {
    const extra = [...prx, row({ idx: 3, caseNo: '2015.0003PRX', prx: true, newUnits: 5 })];
    const noUnits = row({ idx: 4, caseNo: '2016.0004PRX', prx: true, newUnits: 0 });
    const problems = checkMultiphaseFile(mini(), [extra[1], extra[2], noUnits], asOf);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/2007\.0001PRX/);
    expect(problems.join('\n')).toMatch(/2015\.0003PRX/);
    expect(problems.join('\n')).not.toMatch(/2016\.0004PRX/);
  });

  it('flags retrieval dates later than asOf', () => {
    expect(checkMultiphaseFile(mini(), prx, d('2026-09-30')).length).toBeGreaterThan(0);
    const f = mini();
    f.projects[1].searched[0].retrieved = '2026-10-17';
    expect(checkMultiphaseFile(f, prx, asOf)).toHaveLength(1);
    const g = mini();
    g.projects[0].phases[0].facts.blklots.retrieved = '2026-11-01';
    expect(checkMultiphaseFile(g, prx, asOf)).toHaveLength(1);
  });
});

describe('largestRemainder and median', () => {
  it('splits with ties to the earlier entry', () => {
    expect(largestRemainder([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(largestRemainder([120, 180], 300)).toEqual([120, 180]);
    expect(largestRemainder([120, 120], 300)).toEqual([150, 150]);
    expect(largestRemainder([1, 2], 4)).toEqual([1, 3]);
  });

  it('takes the median, mean of the middles for even n', () => {
    expect(median([])).toBeNull();
    expect(median([40])).toBe(40);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('buildPhases: enriched', () => {
  it('M9: remaining phases in file order, built phase excluded, scale 1', () => {
    const f = mini();
    const out = buildPhases(
      ctx({
        entry: f.projects[0],
        daParcels: ['3512014', '3512002', '3512007'],
        excluded: new Set(['3512007'])
      })
    );
    expect(out.mode).toBe('enriched');
    expect(out.phases).toEqual([
      { units: 120, parcelIds: ['3512014'], plannedPermitFiled: null, source: M9_SOURCE },
      {
        units: 180,
        parcelIds: ['3512002'],
        plannedPermitFiled: d('2027-03-01'),
        source: M9_SOURCE
      }
    ]);
    expect(Object.keys(out.phases![0])).toEqual([
      'units',
      'parcelIds',
      'plannedPermitFiled',
      'source'
    ]);
    expect(out.scale).toBe(1);
    expect(out.merged).toBe(0);
    expect(out.problems).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.parcelIds).toEqual(['3512002', '3512014']);
  });

  it('scales R 300 over 240 by 1.25 without a problem', () => {
    const out = buildPhases(
      ctx({
        entry: entry([phase({ units: 120, blklots: ['a'] }), phase({ units: 120, blklots: ['b'] })])
      })
    );
    expect(SCALE_BOUNDS).toEqual([0.8, 1.25]);
    expect(out.scale).toBe(1.25);
    expect(out.phases!.map((p) => p.units)).toEqual([150, 150]);
    expect(out.problems).toEqual([]);
  });

  it('returns a scale factor outside the bounds without a problem (checkV24 reports it)', () => {
    const low = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 79 }),
        entry: entry([phase({ units: 100, blklots: ['a'] })])
      })
    );
    expect(low.scale).toBeCloseTo(0.79);
    expect(low.phases!.map((p) => p.units)).toEqual([79]);
    expect(low.problems).toEqual([]);
    const high = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 126 }),
        entry: entry([phase({ units: 100, blklots: ['a'] })])
      })
    );
    expect(high.scale).toBeCloseTo(1.26);
    expect(high.problems).toEqual([]);
  });

  it('merges a phase with no parcels left into the earlier phase', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([
          phase({ units: 100, blklots: ['a'], plannedPermitFiled: '2028-01-01' }),
          phase({ units: 150, blklots: ['b'] }),
          phase({ units: 50, blklots: ['a', 'x'], plannedPermitFiled: '2027-06-01' })
        ]),
        excluded: new Set(['x'])
      })
    );
    expect(out.merged).toBe(1);
    expect(out.phases!.map((p) => [p.units, p.parcelIds, p.plannedPermitFiled])).toEqual([
      [100, ['a'], d('2028-01-01')],
      [200, ['b'], d('2027-06-01')]
    ]);
    // 'x' is excluded and non-empty-but-not-all-excluded; no problem for that phase.
    expect(out.problems).toEqual([]);
  });

  it('merges a parcel-less first phase into the next phase', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 200 }),
        entry: entry([phase({ units: 80, blklots: [] }), phase({ units: 120, blklots: ['b'] })])
      })
    );
    expect(out.merged).toBe(1);
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([[200, ['b']]]);
  });

  it('merges a phase whose units scale to 0, handing its parcels to the target', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 2 }),
        entry: entry([
          phase({ units: 1, blklots: ['a'] }),
          phase({ units: 1, blklots: ['b'] }),
          phase({ units: 1, blklots: ['c'] })
        ])
      })
    );
    expect(out.merged).toBe(1);
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([
      [1, ['a']],
      [1, ['b', 'c']]
    ]);
  });

  it('merges parcel-less phases before scaling over the merged phases', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 6 }),
        entry: entry([
          phase({ units: 1, blklots: ['a'] }),
          phase({ units: 1, blklots: [] }),
          phase({ units: 1, blklots: ['c'] }),
          phase({ units: 1, blklots: ['d'] })
        ])
      })
    );
    expect(out.merged).toBe(1);
    expect(out.scale).toBe(1.5);
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([
      [3, ['a']],
      [2, ['c']],
      [1, ['d']]
    ]);
  });

  it('warns about phase blklots that resolve to no parcel', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 200 }),
        entry: entry([
          phase({ name: 'One', units: 100, blklots: ['a', 'gone'] }),
          phase({ name: 'Two', units: 100, blklots: ['b'] })
        ]),
        resolve: (blklots) => [...new Set(blklots)].filter((b) => b !== 'gone').sort()
      })
    );
    expect(out.warnings).toEqual(['X phase One: blklot gone resolves to no parcel']);
    expect(out.problems).toEqual([]);
  });

  it('falls back to a single phase on the tracking parcel when every phase is empty', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([phase({ units: 150, blklots: ['y'] }), phase({ units: 150 })]),
        excluded: new Set(['y'])
      })
    );
    expect(out.mode).toBe('enriched');
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([[300, ['3512014']]]);
    expect(out.merged).toBe(1);
    // the first phase's parcels were all claimed by another project
    expect(out.problems.join('\n')).toMatch(/excluded|another/);
  });

  it('enriched with all phases parcel-less keeps a phase on a free tracking parcel', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([phase({ units: 300 })]),
        trackingParcels: ['3512014', 't2'],
        excluded: new Set(['t2'])
      })
    );
    expect(out.mode).toBe('enriched');
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([[300, ['3512014']]]);
  });

  it('enriched with all phases and the tracking parcel excluded is last resort', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 3000 }),
        entry: entry([
          phase({ units: 150, blklots: ['y'], plannedPermitFiled: '2008-06-12' }),
          phase({ units: 150 })
        ]),
        trackingParcels: ['3512014'],
        excluded: new Set(['y', '3512014'])
      })
    );
    expect(out.mode).toBe('lastResort');
    expect(out.phases).toBeNull();
    expect(out.warnings).toContain(
      'X: every phase and the tracking parcel belong to other projects; phasing dropped'
    );
    // the 4.10.3 curation problem stays; the moot plannedPermitFiled problem is dropped
    expect(out.problems).toEqual([
      "X: remaining phase 'Phase' resolves only to parcels of another in-flight or completed " +
        'project (excluded); mark it built or separate'
    ]);
  });

  it('flags a planned permit-filed date not after entitlement', () => {
    const out = buildPhases(
      ctx({
        entry: entry([phase({ units: 300, blklots: ['a'], plannedPermitFiled: '2008-06-12' })])
      })
    );
    expect(out.problems.join('\n')).toMatch(/plannedPermitFiled/);
  });

  it('keeps phase parcels disjoint from excluded and from each other, summing to R', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 250 }),
        entry: entry([
          phase({ units: 100, blklots: ['a', 'b', 'e'] }),
          phase({ units: 100, blklots: ['b', 'c'] }),
          phase({ units: 50, blklots: ['c', 'd'] })
        ]),
        daParcels: ['a', 'b', 'c', 'd', 'e', 'f'],
        excluded: new Set(['e', 'f'])
      })
    );
    const all = out.phases!.flatMap((p) => p.parcelIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((p) => p === 'e' || p === 'f')).toBe(false);
    expect(out.phases!.reduce((s, p) => s + p.units, 0)).toBe(250);
    expect(out.parcelIds).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('buildPhases: fallback and last resort', () => {
  it('M14: project median u 40, P 1 gives one phase of 100 on the lone parcel', () => {
    const f = mini();
    const out = buildPhases(
      ctx({
        master: row({ caseNo: '2010.0002PRX', prx: true, newUnits: 100, blklot: '3512009' }),
        entry: f.projects[1],
        daParcels: ['3512009', '3512007'],
        excluded: new Set(['3512007']),
        trackingParcels: ['3512009'],
        projectU: { u: 40, n: 1 },
        citywideU: { u: 120, n: 30 }
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases).toEqual([
      { units: 100, parcelIds: ['3512009'], plannedPermitFiled: null, source: null }
    ]);
    expect(out.scale).toBeNull();
    expect(out.merged).toBe(0);
    expect(out.warnings).toEqual([]);
    expect(out.parcelIds).toEqual(['3512009']);
    expect(out.u).toEqual({ u: 40, n: 1 });
  });

  it('returns the u it used: citywide without a project median, null when not fallback', () => {
    const fallback = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 100, blklot: 'a' }),
        daParcels: ['a'],
        trackingParcels: ['a'],
        projectU: null,
        citywideU: { u: 120, n: 30 }
      })
    );
    expect(fallback.mode).toBe('fallback');
    expect(fallback.u).toEqual({ u: 120, n: 30 });
    const f = mini();
    const enriched = buildPhases(
      ctx({
        master: row({ caseNo: '2007.0001PRX', prx: true, newUnits: 300, blklot: '3512014' }),
        entry: f.projects[0],
        daParcels: ['3512014', '3512002'],
        trackingParcels: ['3512014'],
        projectU: { u: 40, n: 1 }
      })
    );
    expect(enriched.mode).toBe('enriched');
    expect(enriched.u).toBeNull();
  });

  it('R 100, u 40, P 5 gives 3 phases 34/33/33 on the three largest parcels', () => {
    const area: Record<string, number> = { p1: 10, p2: 50, p3: 30, p4: 50, p5: 5 };
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 100 }),
        daParcels: ['p1', 'p2', 'p3', 'p4', 'p5'],
        projectU: { u: 40, n: 1 },
        areaM2: (id) => area[id]
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([
      [34, ['p2']],
      [33, ['p4']],
      [33, ['p3']]
    ]);
  });

  it('uses the citywide median when the project has none', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        daParcels: ['a', 'b', 'c', 'd'],
        citywideU: { u: 100, n: 12 }
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases!.map((p) => p.units)).toEqual([100, 100, 100]);
  });

  it('is a last resort with no u, or with no DA parcels left', () => {
    const none = buildPhases(ctx({ daParcels: ['a'] }));
    expect(none.mode).toBe('lastResort');
    expect(none.phases).toBeNull();
    expect(none.parcelIds).toEqual(['a']);
    expect(none.scoreOnly).toBe(false);
    const noParcels = buildPhases(
      ctx({ daParcels: ['a'], excluded: new Set(['a']), projectU: { u: 40, n: 1 } })
    );
    expect(noParcels.mode).toBe('lastResort');
    expect(noParcels.phases).toBeNull();
    // DQ-3: never the held tracking parcel; with no free DA parcel the master is score-only.
    expect(noParcels.parcelIds).toEqual([]);
    expect(noParcels.scoreOnly).toBe(true);
  });

  it('DQ-3: a last resort draws on exactly the free DA parcels, never a held one', () => {
    const out = buildPhases(
      ctx({
        daParcels: ['3512014', 'a', 'b', 'c'],
        excluded: new Set(['3512014', 'b'])
      })
    );
    expect(out.mode).toBe('lastResort');
    expect(out.parcelIds).toEqual(['a', 'c']);
    expect(out.scoreOnly).toBe(false);
  });

  it('DQ-3 under L2: free DA parcels are drawn on; with none the master is score-only', () => {
    const l2 = (daParcels: string[]) =>
      buildPhases(
        ctx({
          master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
          entry: entry([phase({ units: 300, blklots: ['y'] })]),
          daParcels,
          trackingParcels: ['3512014'],
          excluded: new Set(['y', '3512014'])
        })
      );
    const drawing = l2(['3512014', 'y', 'f']);
    expect(drawing.mode).toBe('lastResort');
    expect(drawing.parcelIds).toEqual(['f']);
    expect(drawing.scoreOnly).toBe(false);
    const scoreOnly = l2(['3512014', 'y']);
    expect(scoreOnly.mode).toBe('lastResort');
    expect(scoreOnly.parcelIds).toEqual([]);
    expect(scoreOnly.scoreOnly).toBe(true);
  });

  it('phases the netted R and checks the scale on R before netting', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        units: 200,
        entry: entry([phase({ units: 150, blklots: ['a'] }), phase({ units: 150, blklots: ['b'] })])
      })
    );
    expect(out.mode).toBe('enriched');
    expect(out.scale).toBe(1);
    expect(out.phases!.map((p) => p.units)).toEqual([100, 100]);
    const fallback = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        units: 100,
        daParcels: ['a', 'b', 'c', 'd'],
        citywideU: { u: 100, n: 12 }
      })
    );
    expect(fallback.phases!.map((p) => p.units)).toEqual([100]);
  });

  it('falls back when the entry has a schedule but no remaining phase', () => {
    const out = buildPhases(
      ctx({
        entry: entry([phase({ status: 'built', blklots: ['z'] })]),
        daParcels: ['3512014'],
        projectU: { u: 300, n: 2 }
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases!.map((p) => [p.units, p.parcelIds])).toEqual([[300, ['3512014']]]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/no remaining phase/);
    expect(out.problems).toEqual([]);
  });
});

describe('netMasters', () => {
  const m = (id: string, units: number, daParcels: string[]) => ({ id, units, daParcels });
  const c = (id: string, units: number, parcelIds: string[]) => ({ id, units, parcelIds });

  it('reduces R by the units of the projects on a DA parcel, and no other', () => {
    expect(
      netMasters(
        [m('CASE:A', 100, ['p1', 'p2'])],
        [c('BP:1', 30, ['p2', 'q']), c('BP:2', 5, ['q']), c('BP:3', 7, ['p1'])]
      )
    ).toEqual([{ id: 'CASE:A', before: 100, after: 63, by: ['BP:1', 'BP:3'] }]);
  });

  it('lets one project net only the first master in the given (id) order', () => {
    expect(
      netMasters([m('CASE:A', 100, ['p1']), m('CASE:B', 50, ['p1'])], [c('BP:1', 30, ['p1'])])
    ).toEqual([
      { id: 'CASE:A', before: 100, after: 70, by: ['BP:1'] },
      { id: 'CASE:B', before: 50, after: 50, by: [] }
    ]);
  });

  it('floors R at 0', () => {
    expect(netMasters([m('CASE:A', 10, ['p1'])], [c('BP:1', 30, ['p1'])])).toEqual([
      { id: 'CASE:A', before: 10, after: 0, by: ['BP:1'] }
    ]);
  });
});

const ts = (iso: string) => `${iso}T00:00:00.000`;
const D = 'CASE:2010.0002PRX';
const H = 'CASE:2007.0001PRX';
const NET = 'pr.multiphase.da-netting';
const SCORE = 'pr.multiphase.score-only';

/** A type 2 permit filed 2026-08-01 (after the cutoff minus a quarter), with no pipeline row. */
function addPermit(raw: Record<ProjectSourceId, RawRow[]>, lot: string, units: number): void {
  raw['datasf-permits-newcon'].push({
    permit_number: '202608010011',
    permit_type: '2',
    block: '3512',
    lot,
    status: 'filed',
    status_date: ts('2026-08-01'),
    filed_date: ts('2026-08-01'),
    proposed_units: String(units),
    site_permit: 'Y',
    primary_address_flag: 'Y'
  });
}

/** An earlier master H (lot 008, 300 units, D's da) and a da row on lot 009 (both DAs hold it). */
function addEarlierMaster(raw: Record<ProjectSourceId, RawRow[]>): MultiphaseFile {
  raw['datasf-dev-pipeline'].push(
    {
      blklot: '3512008',
      current_status: 'PL Approved',
      current_status_date: ts('2008-06-12'),
      case_no: '2007.0001PRX',
      new_pipeline_units: '300',
      da: 'Fixture Village'
    },
    {
      blklot: '3512009',
      current_status: 'BP Filed',
      current_status_date: ts('2026-01-01'),
      bpa_no: '209901018888',
      new_pipeline_units: '3',
      da: 'Fixture Village'
    }
  );
  const mp = baseMultiphase();
  mp.projects.unshift({
    caseNo: '2007.0001PRX',
    label: 'Fixture Shipyard',
    schedule: null,
    searched: [{ url: 'https://example.invalid/search', retrieved: '2026-10-01' }],
    phases: []
  });
  return mp;
}

function t3(r: DeriveResult, id: string) {
  return r.file.projects.find((p) => p.id === id);
}

describe('deriveProjects: DA netting (pr.multiphase.da-netting) and DQ-3 score-only', () => {
  it('nets a non-pipeline in-flight project on a DA parcel; no free DA parcel is score-only', () => {
    const raw = baseRaw();
    addPermit(raw, '006', 30); // on D's tracking lot; lot 001 is A's
    const r = deriveProjects(baseInput(raw));
    expect(t3(r, 'BP:202608010011')).toMatchObject({ units: 30, parcelIds: ['3512006'] });
    expect(t3(r, D)).toMatchObject({
      units: 70,
      parcelIds: [],
      existingUnits: 0,
      multiPhase: true,
      phases: null,
      quality: [NET, SCORE]
    });
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(30);
    expect(r.counts['multiphase.nettedOut']).toBe(0);
    expect(r.counts['multiphase.lastResort']).toBe(1);
    expect(r.counts['multiphase.scoreOnly']).toBe(1);
    expect(r.counts['multiphase.fallback']).toBe(0);
    expect(r.warnings).toContain('2010.0002PRX: no free DA parcel; score-only');
    expect(r.counts).toMatchObject({
      [`quality.${NET}.fired`]: 1,
      [`quality.${NET}.of`]: 1,
      [`quality.${NET}.units`]: 30,
      [`quality.${NET}.unitsOf`]: 100,
      [`quality.${SCORE}.fired`]: 1,
      [`quality.${SCORE}.of`]: 1,
      [`quality.${SCORE}.units`]: 70,
      [`quality.${SCORE}.unitsOf`]: 70
    });
    expect(r.file.qualityRules.map((q) => q.id)).toEqual(expect.arrayContaining([NET, SCORE]));
    expect(r.checks.multiphase.lastResort).toEqual([D]);
    expect(() => parseProjectsFile(r.file, { asOf: ASOF, parcelIds: PARCELS })).not.toThrow();
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
    // V21: the master counts its R before netting.
    expect(r.checks.coverage).toEqual({ matchedUnits: 131, rowUnits: 131, rows: 4 });
  });

  it('does not net with a project that matches a pipeline row', () => {
    const raw = baseRaw();
    addPermit(raw, '006', 30);
    raw['datasf-dev-pipeline'].push({
      blklot: '3512006',
      current_status: 'BP Filed',
      current_status_date: ts('2026-08-01'),
      bpa_no: '202608010011',
      new_pipeline_units: '30'
    });
    const r = deriveProjects(baseInput(raw));
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(0);
    expect(t3(r, D)).toMatchObject({ units: 100, parcelIds: [], quality: [SCORE] });
    expect(r.counts[`quality.${NET}.fired`]).toBe(0);
    expect(r.counts[`quality.${NET}.of`]).toBe(1);
  });

  it('reports 0 netted for a master no project nets, and no rule id', () => {
    const r = deriveProjects(baseInput());
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(0);
    expect(r.counts['multiphase.nettedOut']).toBe(0);
    expect(r.counts['multiphase.scoreOnly']).toBe(0);
    expect(t3(r, D)!.quality).toEqual([]);
    expect(r.counts).toMatchObject({
      [`quality.${NET}.fired`]: 0,
      [`quality.${NET}.of`]: 1,
      [`quality.${NET}.units`]: 0,
      [`quality.${NET}.unitsOf`]: 100,
      [`quality.${SCORE}.fired`]: 0,
      [`quality.${SCORE}.of`]: 1,
      [`quality.${SCORE}.unitsOf`]: 100
    });
  });

  it('floors R at 0: a netted-out master is not in flight but still covers its rows (V21)', () => {
    const raw = baseRaw();
    addPermit(raw, '006', 150);
    const r = deriveProjects(baseInput(raw));
    expect(t3(r, D)).toBeUndefined();
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(100);
    expect(r.counts['multiphase.nettedOut']).toBe(1);
    expect(r.counts['multiphase.lastResort']).toBe(0);
    expect(r.counts['multiphase.scoreOnly']).toBe(0);
    expect(r.warnings).toContain('2010.0002PRX: netted to 0 by BP:202608010011; not in flight');
    expect(r.counts['projects.inFlight']).toBe(r.file.projects.length);
    expect(r.counts['projects.status.inFlight']).toBe(r.file.projects.length);
    expect(r.counts).toMatchObject({
      [`quality.${NET}.fired`]: 1,
      [`quality.${NET}.of`]: 1,
      [`quality.${NET}.units`]: 100,
      [`quality.${NET}.unitsOf`]: 100,
      [`quality.${SCORE}.of`]: 0,
      [`quality.${SCORE}.unitsOf`]: 0
    });
    expect(r.checks.coverage).toEqual({ matchedUnits: 131, rowUnits: 131, rows: 4 });
    expect(checkV21(r.checks, 0.9)).toMatchObject({ id: 'V21', ok: true });
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('lets one project net only the first master in id order', () => {
    const raw = baseRaw();
    const mp = addEarlierMaster(raw);
    addPermit(raw, '009', 30); // lot 009 is a DA parcel of both H and D
    const r = deriveProjects(baseInput(raw, mp));
    expect(r.counts['multiphase.netted.2007.0001PRX']).toBe(30);
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(0);
    expect(t3(r, H)).toMatchObject({ units: 270, quality: [NET] });
    expect(t3(r, D)).toMatchObject({ units: 100, quality: [] });
    // The scale key, where one exists, uses R before netting; neither is enriched here.
    expect(r.checks.multiphase.scales).toEqual({});
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it("frees a netted-out master's parcels for later masters", () => {
    const raw = baseRaw();
    const mp = addEarlierMaster(raw);
    addPermit(raw, '008', 400); // nets H (lot 008) to 0
    const r = deriveProjects(baseInput(raw, mp));
    expect(t3(r, H)).toBeUndefined();
    // With H in flight, D keeps only lot 006 (H takes lot 009); with H out, D splits 009 and 006.
    expect(t3(r, D)!.phases).toEqual([
      { units: 50, parcelIds: ['3512009'], plannedPermitFiled: null, source: null },
      { units: 50, parcelIds: ['3512006'], plannedPermitFiled: null, source: null }
    ]);
    expect(t3(r, D)!.parcelIds).toEqual(['3512006', '3512009']);
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });
});
