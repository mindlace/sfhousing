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
import { baseCaseIds } from '../../project-records/assemble';
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
    expect(f.projects.map((p) => p.caseNo)).toEqual([
      '2007.0001PRX',
      '2010.0002PRX',
      '2012-000020PRX',
      '2024-000016PRX',
      '2025-000017PRX'
    ]);
    // M20, M16 and M17: no schedule, one searched URL each.
    for (const e of f.projects.slice(2)) {
      expect(e.schedule, e.caseNo).toBeNull();
      expect(e.phases, e.caseNo).toEqual([]);
      expect(e.searched, e.caseNo).toHaveLength(1);
    }
    expect(f.projects[0].phases.map((p) => [p.name, p.units, p.blklots, p.status])).toEqual([
      ['Phase A', 120, ['3512014'], 'remaining'],
      ['Phase B', 180, ['3512002'], 'remaining'],
      ['Phase C', 40, ['3512007'], 'built']
    ]);
    expect(f.projects[1].schedule).toBeNull();
    expect(f.projects[1].searched).toHaveLength(1);
    // Fixture Shipyard carries DA heights and Phase B a curated height and maximum.
    expect(f.projects[0].heights).toMatchObject({
      stories: 8,
      maxStories: 12,
      openSpaceShare: 0.2
    });
    expect(f.projects[0].phases.map((p) => p.stories)).toEqual([undefined, 6, undefined]);
    expect(f.projects[0].phases.map((p) => p.maxStories)).toEqual([undefined, 10, undefined]);
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

describe('MultiphaseFileSchema: heights', () => {
  type Json = Record<string, unknown>;
  const heights = (over: Json = {}): Json => ({
    stories: 8,
    maxStories: 24,
    openSpaceShare: 0.3,
    facts: { stories: FACT, maxStories: FACT, openSpaceShare: FACT },
    ...over
  });

  it('accepts heights with facts, on a scheduled entry and on one with schedule null', () => {
    const j = miniJson();
    j.projects[0].heights = heights();
    j.projects[1].heights = { stories: 5, facts: { stories: FACT } };
    const phases = j.projects[0].phases as Json[];
    phases[0].stories = 6;
    (phases[0].facts as Json).stories = FACT;
    const f = parseMultiphase(j);
    expect(f.projects[0].heights).toEqual(heights());
    expect(f.projects[1].heights).toEqual({ stories: 5, facts: { stories: FACT } });
    expect(f.projects[0].phases[0].stories).toBe(6);
    expect(f.projects[0].phases[0].facts.stories).toEqual(FACT);
    j.projects[0].heights = heights({ openSpaceShare: 0, stories: 1, maxStories: 80 });
    expect(() => parseMultiphase(j)).not.toThrow();
    j.projects[0].heights = heights({ openSpaceShare: 0.9 });
    expect(() => parseMultiphase(j)).not.toThrow();
  });

  it('rejects heights without a fact, stories 0 or 81, and openSpaceShare 0.95', () => {
    const bad = (h: Json): void => {
      const j = miniJson();
      j.projects[0].heights = h;
      expect(() => parseMultiphase(j), JSON.stringify(h)).toThrow(MultiphaseFormatError);
    };
    bad(heights({ facts: { maxStories: FACT, openSpaceShare: FACT } }));
    bad(heights({ facts: { stories: FACT, maxStories: FACT } }));
    bad({ maxStories: 24, facts: {} });
    bad({ stories: 8 });
    bad(heights({ stories: 0 }));
    bad(heights({ stories: 81 }));
    bad(heights({ maxStories: 81 }));
    bad(heights({ stories: 5.5 }));
    bad(heights({ openSpaceShare: 0.95 }));
    bad(heights({ openSpaceShare: -0.1 }));
    bad(heights({ extra: 1 }));
  });

  it('rejects phase stories without a fact, or out of 1..80', () => {
    for (const [stories, withFact] of [
      [6, false],
      [0, true],
      [81, true]
    ] as const) {
      const j = miniJson();
      const ph = (j.projects[0].phases as Json[])[0];
      ph.stories = stories;
      if (withFact) (ph.facts as Json).stories = FACT;
      expect(() => parseMultiphase(j), `${stories}`).toThrow(MultiphaseFormatError);
    }
  });
  it('accepts phase maxStories with a fact; rejects it without one, or out of 1..80', () => {
    const j = miniJson();
    const ph = (j.projects[0].phases as Json[])[0];
    ph.maxStories = 37;
    (ph.facts as Json).maxStories = FACT;
    const f = parseMultiphase(j);
    expect(f.projects[0].phases[0].maxStories).toBe(37);
    expect(f.projects[0].phases[0].facts.maxStories).toEqual(FACT);
    for (const [maxStories, withFact] of [
      [8, false],
      [0, true],
      [81, true],
      [5.5, true]
    ] as const) {
      const k = miniJson();
      const kp = (k.projects[0].phases as Json[])[0];
      kp.maxStories = maxStories;
      if (withFact) (kp.facts as Json).maxStories = FACT;
      expect(() => parseMultiphase(k), `${maxStories}`).toThrow(MultiphaseFormatError);
    }
  });
});

describe('checkMultiphaseFile', () => {
  const asOf = d('2026-10-16');
  const prx = [
    row({ idx: 1, caseNo: '2007.0001PRX', prx: true, newUnits: 300 }),
    row({ idx: 2, caseNo: '2010.0002PRX', prx: true, newUnits: 100 }),
    // M20, and M16's and M17's no-date rows (their entries are unused but still name a PRX row).
    row({ idx: 5, caseNo: '2012-000020PRX', prx: true, newUnits: 10 }),
    row({ idx: 6, caseNo: '2024-000016PRX', prx: true, newUnits: 220 }),
    row({ idx: 7, caseNo: '2025-000017PRX', prx: true, newUnits: 900 })
  ];

  it('passes the mini file against its PRX rows', () => {
    expect(checkMultiphaseFile(mini(), prx, asOf)).toEqual([]);
  });

  it('flags a caseNo absent from the pipeline and a PRX row with units lacking an entry', () => {
    const extra = [...prx, row({ idx: 3, caseNo: '2015.0003PRX', prx: true, newUnits: 5 })];
    const noUnits = row({ idx: 4, caseNo: '2016.0004PRX', prx: true, newUnits: 0 });
    const problems = checkMultiphaseFile(mini(), [...extra.slice(1), noUnits], asOf);
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
    const h = mini();
    h.projects[0].heights!.facts.maxStories = { ...FACT, retrieved: '2026-11-01' };
    expect(checkMultiphaseFile(h, prx, asOf)).toEqual([
      'multiphase.json projects[0] (2007.0001PRX).heights.facts.maxStories: retrieved ' +
        '2026-11-01 is after asOf'
    ]);
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
      {
        units: 120,
        parcelIds: ['3512014'],
        plannedPermitFiled: null,
        source: M9_SOURCE,
        stories: null,
        storiesTier: null,
        maxStories: null
      },
      {
        units: 180,
        parcelIds: ['3512002'],
        plannedPermitFiled: d('2027-03-01'),
        source: M9_SOURCE,
        stories: 6,
        storiesTier: 1,
        maxStories: 10
      }
    ]);
    expect(Object.keys(out.phases![0])).toEqual([
      'units',
      'parcelIds',
      'plannedPermitFiled',
      'source',
      'stories',
      'storiesTier',
      'maxStories'
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

describe('buildPhases: phase stories', () => {
  const st = (stories: number | undefined, units: number, blklots: string[]): MultiphasePhase =>
    phase({
      units,
      blklots,
      ...(stories === undefined
        ? {}
        : { stories, facts: { units: FACT, blklots: FACT, stories: FACT } })
    });

  it('enriched phases carry curated stories with tier 1, and null without', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([st(8, 100, ['a']), st(undefined, 200, ['b'])])
      })
    );
    expect(out.mode).toBe('enriched');
    expect(out.phases!.map((p) => [p.units, p.stories, p.storiesTier])).toEqual([
      [100, 8, 1],
      [200, null, null]
    ]);
  });

  it('merged phases with differing stories carry null; agreeing ones keep them', () => {
    const differ = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([st(8, 100, ['a']), st(12, 150, ['b']), st(6, 50, ['x'])]),
        excluded: new Set(['x'])
      })
    );
    expect(differ.merged).toBe(1);
    expect(differ.phases!.map((p) => [p.units, p.stories, p.storiesTier])).toEqual([
      [100, 8, 1],
      [200, null, null]
    ]);
    const agree = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([st(8, 100, ['a']), st(12, 150, ['b']), st(12, 50, ['x'])]),
        excluded: new Set(['x'])
      })
    );
    expect(agree.phases!.map((p) => [p.units, p.stories, p.storiesTier])).toEqual([
      [100, 8, 1],
      [200, 12, 1]
    ]);
    const unknown = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([st(8, 100, ['a']), st(12, 150, ['b']), st(undefined, 50, ['x'])]),
        excluded: new Set(['x'])
      })
    );
    expect(unknown.phases![1].stories).toBeNull();
  });

  it('the single tracking-parcel phase keeps stories only when every phase agrees', () => {
    const one = (a: number | undefined, b: number | undefined) =>
      buildPhases(
        ctx({
          master: row({ caseNo: 'X', prx: true, newUnits: 300, blklot: 't' }),
          entry: entry([st(a, 100, ['x']), st(b, 200, ['y'])]),
          excluded: new Set(['x', 'y']),
          trackingParcels: ['t']
        })
      ).phases!;
    expect(one(9, 9).map((p) => [p.stories, p.storiesTier])).toEqual([[9, 1]]);
    expect(one(9, 10).map((p) => [p.stories, p.storiesTier])).toEqual([[null, null]]);
  });

  it('fallback phases carry null', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 100 }),
        entry: null,
        daParcels: ['a', 'b'],
        projectU: { u: 50, n: 1 }
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases!.length).toBeGreaterThan(0);
    for (const p of out.phases!) {
      expect(p.stories).toBeNull();
      expect(p.storiesTier).toBeNull();
    }
  });
});

describe('buildPhases: phase maxStories', () => {
  const mx = (maxStories: number | undefined, units: number, blklots: string[]): MultiphasePhase =>
    phase({
      units,
      blklots,
      ...(maxStories === undefined
        ? {}
        : { maxStories, facts: { units: FACT, blklots: FACT, maxStories: FACT } })
    });

  it('enriched phases carry curated maxStories, and null without', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
        entry: entry([mx(37, 100, ['a']), mx(undefined, 200, ['b'])])
      })
    );
    expect(out.phases!.map((p) => [p.units, p.maxStories])).toEqual([
      [100, 37],
      [200, null]
    ]);
  });

  it('merged phases keep maxStories only when they agree', () => {
    const merged = (c: number | undefined) =>
      buildPhases(
        ctx({
          master: row({ caseNo: 'X', prx: true, newUnits: 300 }),
          entry: entry([mx(8, 100, ['a']), mx(12, 150, ['b']), mx(c, 50, ['x'])]),
          excluded: new Set(['x'])
        })
      ).phases!.map((p) => p.maxStories);
    expect(merged(12)).toEqual([8, 12]);
    expect(merged(9)).toEqual([8, null]);
    expect(merged(undefined)).toEqual([8, null]);
  });

  it('the single tracking-parcel phase keeps maxStories only when every phase agrees', () => {
    const one = (a: number | undefined, b: number | undefined) =>
      buildPhases(
        ctx({
          master: row({ caseNo: 'X', prx: true, newUnits: 300, blklot: 't' }),
          entry: entry([mx(a, 100, ['x']), mx(b, 200, ['y'])]),
          excluded: new Set(['x', 'y']),
          trackingParcels: ['t']
        })
      ).phases!.map((p) => p.maxStories);
    expect(one(9, 9)).toEqual([9]);
    expect(one(9, 10)).toEqual([null]);
  });

  it('fallback phases carry null', () => {
    const out = buildPhases(
      ctx({
        master: row({ caseNo: 'X', prx: true, newUnits: 100 }),
        entry: null,
        daParcels: ['a', 'b'],
        projectU: { u: 50, n: 1 }
      })
    );
    expect(out.mode).toBe('fallback');
    expect(out.phases!.map((p) => p.maxStories)).toEqual(out.phases!.map(() => null));
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
      {
        units: 100,
        parcelIds: ['3512009'],
        plannedPermitFiled: null,
        source: null,
        stories: null,
        storiesTier: null,
        maxStories: null
      }
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
      {
        units: 50,
        parcelIds: ['3512009'],
        plannedPermitFiled: null,
        source: null,
        stories: null,
        storiesTier: null,
        maxStories: null
      },
      {
        units: 50,
        parcelIds: ['3512006'],
        plannedPermitFiled: null,
        source: null,
        stories: null,
        storiesTier: null,
        maxStories: null
      }
    ]);
    expect(t3(r, D)!.parcelIds).toEqual(['3512006', '3512009']);
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });
});

/** baseInput with `descendants` overridden for the listed block-lots (others keep the default). */
function withDescendants(
  raw: Record<ProjectSourceId, RawRow[]>,
  map: Record<string, string[]>,
  mp: MultiphaseFile = baseMultiphase()
) {
  const input = baseInput(raw, mp);
  return { ...input, descendants: (b: string) => map[b] ?? input.descendants(b) };
}

/** An enriched master H `2007.0001PRX` (lot 008, 300 units, own da) with one phase on lot 008. */
function addEnrichedMaster(raw: Record<ProjectSourceId, RawRow[]>): MultiphaseFile {
  raw['datasf-dev-pipeline'].push({
    blklot: '3512008',
    current_status: 'PL Approved',
    current_status_date: ts('2008-06-12'),
    case_no: '2007.0001PRX',
    new_pipeline_units: '300',
    da: 'Fixture Shipyard'
  });
  const fact = { url: 'https://example.invalid/da.pdf', retrieved: '2026-10-01', locator: 'B' };
  const mp = baseMultiphase();
  mp.projects.unshift({
    caseNo: '2007.0001PRX',
    label: 'Fixture Shipyard',
    schedule: { label: 'Fixture Shipyard schedule', url: fact.url, retrieved: '2026-10-01' },
    searched: [],
    phases: [
      {
        name: 'Phase A',
        units: 300,
        blklots: ['3512008'],
        plannedPermitFiled: null,
        status: 'remaining',
        facts: { units: fact, blklots: fact }
      }
    ]
  });
  return mp;
}

// Main's ruling 3 and Ruling D1 (revised): a schedule-null master's DA parcels add every current
// parcel descended from its tracking lot.
describe('deriveProjects: descendant DA parcels of schedule-null masters', () => {
  it('reports the descendant count for every master', () => {
    const r = deriveProjects(baseInput());
    expect(r.counts['multiphase.descendants.2010.0002PRX']).toBe(1);
    const raw = baseRaw();
    const wide = deriveProjects(withDescendants(raw, { '3512006': ['3512006', '3512008'] }));
    expect(wide.counts['multiphase.descendants.2010.0002PRX']).toBe(2);
  });

  it('Balboa shape: a non-pipeline project on a descendant parcel nets the master, unflagged', () => {
    const control = baseRaw();
    addPermit(control, '008', 30);
    const before = deriveProjects(baseInput(control));
    expect(before.counts['multiphase.netted.2010.0002PRX']).toBe(0);

    const raw = baseRaw();
    addPermit(raw, '008', 30);
    const r = deriveProjects(withDescendants(raw, { '3512006': ['3512006', '3512008'] }));
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(30);
    expect(t3(r, D)).toMatchObject({ units: 70, quality: [NET] });
    expect(r.checks.multiphase.masters[D].daParcels).toEqual(
      expect.arrayContaining(['3512006', '3512008'])
    );
    // Ruling B2: the flag runs after netting and skips the projects that netted this master.
    expect(r.warnings.filter((w) => w.includes('descendant parcel'))).toEqual([]);
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('flags a descendant held by an unrelated pipeline project without netting it', () => {
    // Lot 003: BP:202403150003 matches its own pipeline row (no da). Lot 001: A holds a row with
    // D's da, so it is a DA project and is not flagged.
    const raw = baseRaw();
    const r = deriveProjects(
      withDescendants(raw, { '3512006': ['3512001', '3512003', '3512006'] })
    );
    expect(r.counts['multiphase.netted.2010.0002PRX']).toBe(0);
    expect(r.warnings).toContain(
      '2010.0002PRX: descendant parcel 3512003 is held by BP:202403150003, which is not a DA project'
    );
    expect(r.warnings.filter((w) => w.includes('descendant parcel'))).toHaveLength(1);
  });

  it("keeps an enriched master's DA parcels: its descendants do not net it", () => {
    const raw = baseRaw();
    const mp = addEnrichedMaster(raw);
    addPermit(raw, '004', 30);
    const r = deriveProjects(withDescendants(raw, { '3512008': ['3512004', '3512008'] }, mp));
    expect(r.counts['multiphase.netted.2007.0001PRX']).toBe(0);
    expect(r.counts['multiphase.descendants.2007.0001PRX']).toBe(2);
    expect(r.checks.multiphase.masters[H].daParcels).not.toContain('3512004');
    expect(r.warnings).toContain(
      '2007.0001PRX: descendant parcel 3512004 is held by BP:202608010011, which is not a DA project'
    );
  });
});

describe('baseCaseIds (Ruling B1)', () => {
  it('gives the case without PRX and that plus PRJ', () => {
    expect(baseCaseIds('2018-007883PRX')).toEqual(['2018-007883', '2018-007883PRJ']);
    expect(baseCaseIds('2007.0946PRX')).toEqual(['2007.0946', '2007.0946PRJ']);
    expect(baseCaseIds('2018-007883PRJ')).toEqual([]);
  });
});

const DASH = 'CASE:2012-000002PRX';

/** Renames master D to the dash-format case `2012-000002PRX` (row and multiphase entry). */
function dashMaster(raw: Record<ProjectSourceId, RawRow[]>): MultiphaseFile {
  const row = raw['datasf-dev-pipeline'].find((r) => r.case_no === '2010.0002PRX')!;
  row.case_no = '2012-000002PRX';
  const mp = baseMultiphase();
  mp.projects[0].caseNo = '2012-000002PRX';
  return mp;
}

// Ruling B1: a dash-format master's base-case PRJ is `<case>PRJ` (2018-007883PRX → 2018-007883PRJ).
describe('deriveProjects: dash-format base-case PRJ (Ruling B1)', () => {
  it('takes the base PRJ parcels as DA parcels, its completed permits as u, and prx_case_no', () => {
    const raw = baseRaw();
    const mp = dashMaster(raw);
    raw['datasf-planning-projects'].push({
      record_id: '2012-000002PRJ',
      record_status: 'Closed',
      block: '3512',
      lot: '009',
      open_date: ts('2012-01-05'),
      building_permits: '201501150014',
      number_of_units_prop: '40',
      new_construction: 'CHECKED'
    });
    raw['datasf-planning-review'].push({
      b1_alt_id: '2012-000002PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2012-02-01'),
      end_event_type: 'approval',
      end_event_date: ts('2013-03-01')
    });
    raw['datasf-permits-newcon'].push({
      permit_number: '201501150014',
      permit_type: '2',
      block: '3512',
      lot: '009',
      status: 'complete',
      status_date: ts('2017-04-01'),
      filed_date: ts('2015-01-15'),
      issued_date: ts('2015-06-01'),
      first_construction_document_date: ts('2015-08-01'),
      completed_date: ts('2017-04-01'),
      proposed_units: '40',
      site_permit: 'Y',
      primary_address_flag: 'Y'
    });
    raw['datasf-unit-completions'].push({
      building_permit_application: '201501150014',
      date_issued: ts('2017-03-01'),
      document_type: 'CFC',
      number_of_units_certified: '40'
    });
    const r = deriveProjects(baseInput(raw, mp));
    expect(r.checks.multiphase.masters[DASH].daParcels).toEqual(['3512001', '3512006', '3512009']);
    expect(r.counts['multiphase.u.2012-000002PRX']).toBe(40);
    expect(r.counts['multiphase.u.2012-000002PRX.n']).toBe(1);
    const permit = r.permits.find((p) => p.permit_number === '201501150014')!;
    expect(permit).toMatchObject({
      prj_record_id: '2012-000002PRJ',
      prx_case_no: '2012-000002PRX'
    });
    expect(checkV24(r.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('does not flag an in-flight base-case PRJ project on a descendant parcel (Ruling B2)', () => {
    // The base PRJ (lot 008, a descendant of the tracking lot 006) holds its own pipeline row with
    // no da, so it neither nets the master nor is a same-da project: only the base-case match
    // keeps it unflagged.
    const raw = baseRaw();
    const mp = dashMaster(raw);
    raw['datasf-planning-projects'].push({
      record_id: '2012-000002PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '008',
      open_date: ts('2026-05-01'),
      number_of_units_prop: '10',
      new_construction: 'CHECKED'
    });
    raw['datasf-dev-pipeline'].push({
      blklot: '3512008',
      current_status: 'PL Filed',
      current_status_date: ts('2026-06-01'),
      case_no: '2012-000002PRJ',
      new_pipeline_units: '10'
    });
    const r = deriveProjects(withDescendants(raw, { '3512006': ['3512006', '3512008'] }, mp));
    expect(t3(r, 'PRJ:2012-000002PRJ')).toMatchObject({ parcelIds: ['3512008'] });
    expect(r.counts['multiphase.descendants.2012-000002PRX']).toBe(2);
    expect(r.counts['multiphase.netted.2012-000002PRX']).toBe(0);
    expect(r.checks.multiphase.masters[DASH].daParcels).toContain('3512008');
    expect(r.warnings.filter((w) => w.includes('descendant parcel'))).toEqual([]);
  });
});
