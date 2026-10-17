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
import {
  SCALE_BOUNDS,
  buildPhases,
  checkMultiphaseFile,
  largestRemainder,
  median,
  type PhaseContext
} from '../../project-records/multiphase';
import type { PipelineRow } from '../../project-records/types';

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

  it('accepts the live placeholder', () => {
    expect(parseMultiphase(readJson(LIVE))).toEqual({ schema: 1, projects: [] });
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

  it('flags a scale factor outside the bounds', () => {
    const low = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 79 }),
        entry: entry([phase({ units: 100, blklots: ['a'] })])
      })
    );
    expect(low.scale).toBeCloseTo(0.79);
    expect(low.phases!.map((p) => p.units)).toEqual([79]);
    expect(low.problems.join('\n')).toMatch(/scale/);
    const high = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 126 }),
        entry: entry([phase({ units: 100, blklots: ['a'] })])
      })
    );
    expect(high.scale).toBeCloseTo(1.26);
    expect(high.problems.join('\n')).toMatch(/scale/);
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

  it('merges a phase whose units scale to 0', () => {
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
      [1, ['b']]
    ]);
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
    expect(out.parcelIds).toEqual(['3512009']);
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
    const noParcels = buildPhases(
      ctx({ daParcels: ['a'], excluded: new Set(['a']), projectU: { u: 40, n: 1 } })
    );
    expect(noParcels.mode).toBe('lastResort');
    expect(noParcels.phases).toBeNull();
    expect(noParcels.parcelIds).toEqual(['3512014']);
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
  });
});
