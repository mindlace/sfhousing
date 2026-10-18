// project-records T14 rules (spec §4.11, §6 "project-records/quality.test.ts"): the registry
// entries, one recordQuality call per rule from deriveProjects, and the rule ids on records.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SCORE_ONLY_QUALITY_ID, parseProjectsFile } from '../../../src/lib/timelapse/projects';
import { QUALITY_RULES, qualityRule, type QualityRule } from '../../lib/quality';
import { PR, PR_RULES } from '../../lib/quality-rules/pr';
import { T3_ONLY_QUALITY, historyQuality } from '../../project-records/assemble';
import { deriveProjects, type DeriveResult } from '../../project-records/derive';
import type { ProjectSourceId, RawRow } from '../../project-records/types';
import { ASOF, baseInput, baseRaw } from './derive-input';

type Call = { counts: object; id: string; sample: string[] | undefined; added: string[] };
const calls = vi.hoisted(() => [] as Call[]);

// Wraps the real recordQuality: each call is logged with the keys it added to `counts`.
vi.mock('../../lib/quality', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/quality')>();
  return {
    ...actual,
    recordQuality: (counts: Record<string, number>, id: string, c: { sample?: string[] }) => {
      const before = new Set(Object.keys(counts));
      actual.recordQuality(counts, id, c as Parameters<typeof actual.recordQuality>[2]);
      calls.push({
        counts,
        id,
        sample: c.sample === undefined ? undefined : [...c.sample],
        added: Object.keys(counts).filter((k) => !before.has(k))
      });
    }
  };
});

type Spec = Pick<
  QualityRule,
  'kind' | 'action' | 'tier' | 'valueTier' | 'unitsWeighted' | 'warnShare' | 'failShare' | 'label'
>;

/** Spec §4.11 table, verbatim. */
const TABLE: Record<string, Spec> = {
  'pr.date.valid-range': {
    kind: 'bound',
    action: 'null',
    tier: 4,
    valueTier: null,
    unitsWeighted: false,
    warnShare: 0.01,
    failShare: 0.1,
    label: 'A date outside 1970 to the snapshot day was treated as missing'
  },
  'pr.stories.parse-range': {
    kind: 'bound',
    action: 'null',
    tier: 4,
    valueTier: null,
    unitsWeighted: false,
    warnShare: 0.01,
    failShare: 0.1,
    label: 'A story count read from the project description was outside 1 to 80 and was not used'
  },
  'pr.stages.forward-clamp': {
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    unitsWeighted: false,
    warnShare: 0.25,
    failShare: 0.5,
    label: "A stage date earlier than the stage before it was moved up to that stage's date"
  },
  'pr.units.capacity': {
    kind: 'outlier',
    action: 'null',
    tier: 4,
    valueTier: null,
    unitsWeighted: true,
    warnShare: 0.01,
    failShare: 0.1,
    label: "A permit's unit count was more than its lot could physically hold and was not used"
  },
  'pr.units.capacity-unmapped': {
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    unitsWeighted: false,
    warnShare: 0.01,
    failShare: 0.1,
    label:
      "A permit's unit count was not checked against its lot because the permit's lot could not be matched to a parcel"
  },
  'pr.units.capacity-cap': {
    kind: 'outlier',
    action: 'replace',
    tier: 4,
    valueTier: 4,
    unitsWeighted: true,
    warnShare: 0.05,
    failShare: 0.1,
    label:
      "A permit's unit count was more than its lot could physically hold, so the most homes the lot can hold at the minimum space per home was used"
  },
  'pr.pipeline.status-date-linked': {
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 0,
    unitsWeighted: true,
    warnShare: 0.1,
    failShare: 0.2,
    label: 'Dates taken from the Planning record on this lot'
  },
  'pr.pipeline.no-status-date': {
    kind: 'shape',
    action: 'drop',
    tier: 4,
    valueTier: null,
    unitsWeighted: true,
    warnShare: 0.01,
    failShare: 0.1,
    label: 'A pipeline row with no status date and no Planning record on its lot was left out'
  },
  'pr.pipeline.records-win': {
    kind: 'observe',
    action: 'none',
    tier: 4,
    valueTier: null,
    unitsWeighted: false,
    warnShare: 0.01,
    failShare: 0.1,
    label:
      'The quarterly pipeline lists a project that the daily permit and Planning records show has finished or ended; the daily records are used'
  },
  'pr.parcels.shared-existing': {
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    unitsWeighted: false,
    warnShare: 0.25,
    failShare: 0.5,
    label: 'Existing homes counted once on a shared lot'
  },
  'pr.multiphase.score-only': {
    kind: 'shape',
    action: 'none',
    // Main's ruling 5 (F2 live): tier 2, as the design's rules table has it (Ruling Q1 overturned).
    tier: 2,
    valueTier: null,
    unitsWeighted: true,
    warnShare: 0.25,
    failShare: 0.5,
    label: 'Counted in the score but not drawn: no free lot in the plan area'
  },
  'pr.multiphase.da-netting': {
    kind: 'shape',
    action: 'replace',
    tier: 2,
    valueTier: 2,
    unitsWeighted: true,
    warnShare: 0.1,
    failShare: 0.5,
    label:
      "Remaining Development Agreement homes reduced by projects filed after Planning's quarterly count"
  }
};
const IDS = Object.keys(TABLE).sort();

const key = (id: string, k: string) => ['quality', id, k].join('.');
const tally = (r: DeriveResult, id: string) => ({
  fired: r.counts[key(id, 'fired')],
  of: r.counts[key(id, 'of')],
  units: r.counts[key(id, 'units')],
  unitsOf: r.counts[key(id, 'unitsOf')]
});
const callsFor = (counts: object) => calls.filter((c) => c.counts === counts);

function derive(edit: (raw: Record<ProjectSourceId, RawRow[]>) => void = () => {}) {
  const raw = baseRaw();
  edit(raw);
  const counts: Record<string, number> = {};
  return deriveProjects(baseInput(raw), { counts });
}
const project = (r: DeriveResult, id: string) => r.file.projects.find((p) => p.id === id);
const history = (r: DeriveResult, id: string) => r.histories.find((h) => h.id === id);

describe('pr.* registry (spec §4.11)', () => {
  it('has exactly the ten spec entries, owner project-records, maskBit null, fields per the table', () => {
    const pr = QUALITY_RULES.filter((r) => r.id.startsWith('pr.'));
    expect(pr.map((r) => r.id)).toEqual(IDS);
    expect(PR_RULES.map((r) => r.id).sort()).toEqual(IDS);
    for (const id of IDS) {
      expect(qualityRule(id), id).toMatchObject({
        id,
        owner: 'project-records',
        maskBit: null,
        ...TABLE[id]
      });
    }
    expect(QUALITY_RULES.filter((r) => r.owner === 'project-records').map((r) => r.id)).toEqual(
      IDS
    );
  });

  it('labels are generic: no permit number, PRJ, PRX or block-lot', () => {
    for (const r of PR_RULES) {
      expect(r.label, r.id).not.toMatch(/\d{6,}|PRJ|PRX|\b\d{4}[A-Z]?\d{3}[A-Z]?\b/);
      expect(r.label.trim(), r.id).not.toBe('');
    }
  });

  it("the score-only rule's id is the T3 validator's SCORE_ONLY_QUALITY_ID", () => {
    expect(PR.multiphaseScoreOnly).toBe(SCORE_ONLY_QUALITY_ID);
    expect(qualityRule(SCORE_ONLY_QUALITY_ID).owner).toBe('project-records');
    expect(Object.values(PR).sort()).toEqual(IDS);
  });
});

describe('deriveProjects records every pr.* rule through recordQuality', () => {
  it('once per rule into the caller counts, zeros included, samples sorted, no direct writes', () => {
    const counts: Record<string, number> = { 'other.key': 7 };
    const r = deriveProjects(baseInput(), { counts });
    expect(r.counts).toBe(counts);
    expect(counts['other.key']).toBe(7);
    const mine = callsFor(counts);
    expect(mine.map((c) => c.id).sort()).toEqual(IDS);
    for (const c of mine) {
      expect(c.sample, c.id).toBeDefined();
      expect(c.sample, c.id).toEqual([...(c.sample ?? [])].sort());
    }
    const written = mine.flatMap((c) => c.added).sort();
    const quality = Object.keys(counts)
      .filter((k) => k.startsWith('quality.'))
      .sort();
    expect(quality).toEqual(written);
    for (const id of IDS) {
      const keys = qualityRule(id).unitsWeighted
        ? ['fired', 'of', 'units', 'unitsOf']
        : ['fired', 'of'];
      for (const k of keys) expect(counts, `${id}.${k}`).toHaveProperty([key(id, k)]);
    }
  });

  it('records into a fresh object when no counts are given', () => {
    const r = deriveProjects(baseInput());
    expect(
      callsFor(r.counts)
        .map((c) => c.id)
        .sort()
    ).toEqual(IDS);
  });

  it('writes no histories.clamped.* or projects.pipelineConflicts key', () => {
    const r = derive();
    expect(Object.keys(r.counts).filter((k) => k.startsWith('histories.clamped.'))).toEqual([]);
    expect(r.counts).not.toHaveProperty(['projects.pipelineConflicts']);
  });

  it('the rules whose behaviour lands later record zero with their denominators', () => {
    const r = derive();
    // Five pipeline rows: 24 + 2 + 100 + 5 + 4 new units.
    expect(tally(r, PR.pipelineStatusDateLinked)).toEqual({
      fired: 0,
      of: 5,
      units: 0,
      unitsOf: 135
    });
    expect(tally(r, PR.parcelsSharedExisting)).toMatchObject({ fired: 0, of: 4 });
    // D (CASE:2010.0002PRX, 100 units) is the only in-flight master.
    expect(tally(r, PR.multiphaseScoreOnly)).toEqual({ fired: 0, of: 1, units: 0, unitsOf: 100 });
    expect(tally(r, PR.multiphaseDaNetting)).toEqual({ fired: 0, of: 1, units: 0, unitsOf: 100 });
  });
});

describe('pr.date.valid-range (spec §4.1)', () => {
  it('a clipped 1909 date is counted and its project and history carry the id', () => {
    const base = derive();
    expect(tally(base, PR.dateValidRange).fired).toBe(0);
    const r = derive((raw) => {
      raw['datasf-permits-newcon'][0].completed_date = '1909-06-02T00:00:00.000';
    });
    expect(tally(r, PR.dateValidRange)).toMatchObject({
      fired: 1,
      of: tally(base, PR.dateValidRange).of + 1
    });
    const call = callsFor(r.counts).find((c) => c.id === PR.dateValidRange);
    expect(call?.sample).toEqual(['201906010001']);
    expect(project(r, 'PRJ:2019-000001PRJ')?.quality).toContain(PR.dateValidRange);
    expect(history(r, 'PRJ:2019-000001PRJ')?.quality).toContain(PR.dateValidRange);
    expect(project(r, 'BP:202403150003')?.quality).toEqual([]);
    expect(r.file.qualityRules.map((q) => q.id)).toContain(PR.dateValidRange);
  });

  it('a clipped 2205 j67f date and an unparseable date are counted too', () => {
    const r = derive((raw) => {
      raw['datasf-unit-completions'][0].date_issued = '2205-03-13T00:00:00.000';
      raw['datasf-planning-projects'][0].close_date = 'not a date';
    });
    expect(tally(r, PR.dateValidRange).fired).toBe(2);
    const call = callsFor(r.counts).find((c) => c.id === PR.dateValidRange);
    expect(call?.sample).toEqual(['201605010006', '2019-000001PRJ']);
    expect(history(r, 'PRJ:2016-000006PRJ')?.quality).toContain(PR.dateValidRange);
  });
});

describe('pr.stages.forward-clamp (spec §4.5)', () => {
  it('fires per clamped history over histories.total; history and T3 project carry it', () => {
    const r = derive();
    // A: permit filed 2019-06-01 before its 2020-03-02 entitlement, moved up.
    expect(tally(r, PR.stagesForwardClamp)).toEqual({
      fired: 1,
      of: r.counts['histories.total'],
      units: undefined,
      unitsOf: undefined
    });
    const call = callsFor(r.counts).find((c) => c.id === PR.stagesForwardClamp);
    expect(call?.sample).toEqual(['PRJ:2019-000001PRJ']);
    expect(history(r, 'PRJ:2019-000001PRJ')?.quality).toEqual([PR.stagesForwardClamp]);
    expect(project(r, 'PRJ:2019-000001PRJ')?.quality).toEqual([PR.stagesForwardClamp]);
    expect(history(r, 'PRJ:2016-000006PRJ')?.quality).toEqual([]);
  });
});

describe('pr.stories.parse-range (spec §4.8)', () => {
  it('a discarded parsed story count is counted and its project carries the id', () => {
    const base = derive();
    expect(tally(base, PR.storiesParseRange)).toMatchObject({ fired: 0, of: 0 });
    // The §4.8 regexes read at most two digits of stories and floor(999 ft / 10) = 99, so a
    // parsed value above 80 is at most 99: a 950-foot tower parses as 95 stories.
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'][3].description_planning = 'Construct a new 950-foot tower';
    });
    expect(tally(r, PR.storiesParseRange)).toMatchObject({ fired: 1, of: 1 });
    const call = callsFor(r.counts).find((c) => c.id === PR.storiesParseRange);
    expect(call?.sample).toEqual(['CASE:2099-000099PRJ']);
    const e = project(r, 'CASE:2099-000099PRJ');
    expect(e).toMatchObject({ stories: null, storiesTier: null });
    expect(e?.quality).toEqual([PR.storiesParseRange]);
  });

  it('an in-range parsed value counts in `of` only', () => {
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'][3].description_planning = 'Construct a new 7-story building';
    });
    expect(tally(r, PR.storiesParseRange)).toMatchObject({ fired: 0, of: 1 });
    expect(project(r, 'CASE:2099-000099PRJ')).toMatchObject({ stories: 7, quality: [] });
  });
});

describe('pr.pipeline.records-win (spec §4.7, observe)', () => {
  it('a stage mismatch alone no longer fires', () => {
    const base = derive();
    // A (Construction = construction) and B (BP Filed = permitFiled) agree with the pipeline.
    expect(tally(base, PR.pipelineRecordsWin)).toMatchObject({ fired: 0, of: 2 });
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'][0].current_status = 'BP Issued';
    });
    expect(tally(r, PR.pipelineRecordsWin)).toMatchObject({ fired: 0, of: 2 });
  });

  it('counts a matched project whose history ends exit, over projects matching a row', () => {
    const r = derive((raw) => {
      const b = raw['datasf-permits-newcon'].find((x) => x.permit_number === '202403150003');
      Object.assign(b ?? {}, { status: 'withdrawn', status_date: '2026-01-05T00:00:00.000' });
    });
    expect(r.histories.find((h) => h.id === 'BP:202403150003')?.end?.kind).toBe('exit');
    expect(tally(r, PR.pipelineRecordsWin)).toMatchObject({ fired: 1, of: 2 });
    const call = callsFor(r.counts).find((c) => c.id === PR.pipelineRecordsWin);
    expect(call?.sample).toEqual(['BP:202403150003']);
    for (const p of r.file.projects) expect(p.quality).not.toContain(PR.pipelineRecordsWin);
    for (const h of r.histories) expect(h.quality).not.toContain(PR.pipelineRecordsWin);
  });

  it('counts a row on a project whose history ends complete', () => {
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'].push({
        blklot: '3512004',
        current_status: 'Construction',
        current_status_date: '2019-01-01T00:00:00.000',
        bpa_no: '201605010006',
        new_pipeline_units: '60'
      });
    });
    expect(tally(r, PR.pipelineRecordsWin)).toMatchObject({ fired: 1, of: 3 });
    const call = callsFor(r.counts).find((c) => c.id === PR.pipelineRecordsWin);
    expect(call?.sample).toEqual(['PRJ:2016-000006PRJ']);
  });

  it('a row whose status maps to no stage is not a conflict', () => {
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'][0].current_status = 'Something Else';
    });
    expect(tally(r, PR.pipelineRecordsWin)).toMatchObject({ fired: 0, of: 2 });
  });
});

describe('pr.units.capacity (spec §4.8)', () => {
  // Parcel areas in baseInput are 100 + the last digit of the parcel id.
  const overfill = (raw: Record<ProjectSourceId, RawRow[]>) => {
    // B (lot 003, 103 m²): 5,000 units on 1 story hold at most 10.3.
    const b = raw['datasf-permits-newcon'].find((x) => x.permit_number === '202403150003');
    Object.assign(b ?? {}, { proposed_units: '5000', number_of_proposed_stories: '1' });
  };

  it('a clean build checks A only (6 stories, 24 units) and fires nothing', () => {
    const r = derive();
    expect(tally(r, PR.unitsCapacity)).toEqual({ fired: 0, of: 1, units: 0, unitsOf: 24 });
    for (const p of r.file.projects) expect(p.quality).not.toContain(PR.unitsCapacity);
  });

  it('tally: fired counts permits on the fallback branch; the cap rule takes the rest', () => {
    const r = derive((raw) => {
      overfill(raw);
      // F (lot 002, 102 m²) is stale-open, has no fallback and never becomes a record: 11 units on
      // 1 story fail and are capped at floor(10.2) = 10.
      const f = raw['datasf-permits-newcon'].find((x) => x.permit_number === '201410070008');
      Object.assign(f ?? {}, { proposed_units: '11', number_of_proposed_stories: '1' });
    });
    expect(tally(r, PR.unitsCapacity)).toEqual({
      fired: 1,
      of: 3,
      units: 5000,
      unitsOf: 24 + 5000 + 11
    });
    expect(tally(r, PR.unitsCapacityCap)).toEqual({
      fired: 1,
      of: 3,
      units: 11,
      unitsOf: 24 + 5000 + 11
    });
    const call = callsFor(r.counts).find((c) => c.id === PR.unitsCapacity);
    expect(call?.sample).toEqual(['BP:202403150003']);
    const cap = callsFor(r.counts).find((c) => c.id === PR.unitsCapacityCap);
    expect(cap?.sample).toEqual(['BP:201410070008']);
  });

  // B with a pipeline row that states no units has no fallback source: 103 m² x 1 story, capped at 10.
  const noFallback = (raw: Record<ProjectSourceId, RawRow[]>) => {
    overfill(raw);
    // Its pipeline row stays (it sets the cutoff) but states no units.
    const row = raw['datasf-dev-pipeline'].find((x) => x.bpa_no === '202403150003');
    delete row?.new_pipeline_units;
  };

  it('no fallback: the permit is capped, the project and history carry the cap id', () => {
    const r = derive(noFallback);
    const id = 'BP:202403150003';
    expect(tally(r, PR.unitsCapacity)).toMatchObject({ fired: 0 });
    expect(tally(r, PR.unitsCapacityCap)).toMatchObject({ fired: 1, units: 5000 });
    expect(project(r, id)?.quality).toEqual([PR.unitsCapacityCap]);
    expect(history(r, id)?.quality).toEqual([PR.unitsCapacityCap]);
    expect(project(r, id)?.units).toBe(10);
    expect(history(r, id)?.unitsAt).toMatchObject({ permitFiled: 10 });
    expect(r.permits.find((q) => q.permit_number === '202403150003')?.proposed_units).toBe(10);
    expect(r.file.qualityRules.map((q) => q.id)).toContain(PR.unitsCapacityCap);
    expect(r.file.qualityRules.map((q) => q.id)).not.toContain(PR.unitsCapacity);
  });

  it('the project and its history carry the id; units fall through; permitFiled and the row follow', () => {
    const r = derive(overfill);
    const id = 'BP:202403150003';
    expect(project(r, id)?.quality).toEqual([PR.unitsCapacity]);
    expect(history(r, id)?.quality).toEqual([PR.unitsCapacity]);
    // The permit's units are missing, so units fall through to the pipeline row's 2.
    expect(project(r, id)?.units).toBe(2);
    expect(history(r, id)?.unitsAt).not.toHaveProperty('permitFiled');
    expect(r.permits.find((q) => q.permit_number === '202403150003')?.proposed_units).toBeNull();
    // The other projects keep their permit units.
    expect(r.permits.find((q) => q.permit_number === '201906010001')?.proposed_units).toBe(24);
    expect(project(r, 'PRJ:2019-000001PRJ')?.quality).not.toContain(PR.unitsCapacity);
    expect(r.file.qualityRules.map((q) => q.id)).toContain(PR.unitsCapacity);
  });

  it('a permit whose own lot is unmapped is skipped and counted, with its units untouched', () => {
    const r = derive((raw) => {
      overfill(raw);
      // B's address lot 3512099 is in no parcel set; the project still has lot 003 from its row.
      const b = raw['datasf-permits-newcon'].find((x) => x.permit_number === '202403150003');
      Object.assign(b ?? {}, { lot: '099' });
    });
    const id = 'BP:202403150003';
    expect(tally(r, PR.unitsCapacity)).toMatchObject({ fired: 0, of: 2 });
    expect(tally(r, PR.unitsCapacityCap)).toMatchObject({ fired: 0, of: 2 });
    expect(tally(r, PR.unitsCapacityUnmapped)).toMatchObject({ fired: 1, of: 2 });
    expect(callsFor(r.counts).find((c) => c.id === PR.unitsCapacityUnmapped)?.sample).toEqual([id]);
    expect(project(r, id)?.units).toBe(5000);
    expect(project(r, id)?.quality).toEqual([]);
    expect(history(r, id)?.quality).toEqual([]);
    expect(r.file.qualityRules.map((q) => q.id)).not.toContain(PR.unitsCapacityUnmapped);
  });

  it('a clean build skips nothing', () => {
    expect(tally(derive(), PR.unitsCapacityUnmapped)).toMatchObject({ fired: 0, of: 1 });
  });

  it('no recorded stories, or no parcels: no check', () => {
    const noStories = derive((raw) => {
      overfill(raw);
      const b = raw['datasf-permits-newcon'].find((x) => x.permit_number === '202403150003');
      delete b?.number_of_proposed_stories;
    });
    expect(tally(noStories, PR.unitsCapacity)).toMatchObject({ fired: 0, of: 1 });
    expect(project(noStories, 'BP:202403150003')?.units).toBe(5000);
  });

  it('a permit voided by the rule leaves the phase-size medians', () => {
    const base = derive();
    expect(base.counts['multiphase.u.2010.0002PRX']).toBe(60);
    // C's 60-unit completed permit (lot 004, 104 m²) on 1 story holds at most 10.4.
    const r = derive((raw) => {
      const c = raw['datasf-permits-newcon'].find((x) => x.permit_number === '201605010006');
      Object.assign(c ?? {}, { number_of_proposed_stories: '1' });
    });
    expect(tally(r, PR.unitsCapacity)).toMatchObject({ fired: 1, units: 60 });
    expect(r.counts['multiphase.u.2010.0002PRX']).toBeUndefined();
  });

  it('a clipped date on a voided permit still marks its project', () => {
    const r = derive((raw) => {
      overfill(raw);
      const b = raw['datasf-permits-newcon'].find((x) => x.permit_number === '202403150003');
      Object.assign(b ?? {}, { completed_date: '1909-06-02T00:00:00.000' });
    });
    expect(project(r, 'BP:202403150003')?.quality).toEqual([PR.dateValidRange, PR.unitsCapacity]);
  });
});

describe('pr.pipeline.no-status-date', () => {
  it('counts a dropped pipeline-only row with no status date, unit-weighted', () => {
    const r = derive((raw) => {
      raw['datasf-dev-pipeline'].push({
        blklot: '3512008',
        current_status: 'PL Filed',
        case_no: '2026-000018PRJ',
        new_pipeline_units: '20'
      });
    });
    expect(tally(r, PR.pipelineNoStatusDate)).toEqual({
      fired: 1,
      of: 6,
      units: 20,
      unitsOf: 155
    });
    const call = callsFor(r.counts).find((c) => c.id === PR.pipelineNoStatusDate);
    expect(call?.sample).toEqual(['CASE:2026-000018PRJ']);
    expect(project(r, 'CASE:2026-000018PRJ')).toBeUndefined();
  });
});

describe('pr.pipeline.status-date-linked (spec §4.2 step 10)', () => {
  it('samples the joined project id; the dropped row is not counted as dropped', () => {
    const r = derive((raw) => {
      raw['datasf-planning-projects'].push({
        record_id: '2020-006887PRJ',
        record_status: 'Under Review',
        block: '3512',
        lot: '008',
        open_date: '2020-07-24T00:00:00.000',
        number_of_units_prop: '2387',
        new_construction: 'CHECKED'
      });
      raw['datasf-dev-pipeline'].push({
        blklot: '3512008',
        current_status: 'PL Filed',
        case_no: '2026-000018PRJ',
        new_pipeline_units: '20'
      });
    });
    expect(tally(r, PR.pipelineStatusDateLinked)).toEqual({
      fired: 1,
      of: 6,
      units: 20,
      unitsOf: 155
    });
    const linked = callsFor(r.counts).find((c) => c.id === PR.pipelineStatusDateLinked);
    expect(linked?.sample).toEqual(['PRJ:2020-006887PRJ']);
    expect(tally(r, PR.pipelineNoStatusDate)).toMatchObject({ fired: 0, units: 0 });
    const dropped = callsFor(r.counts).find((c) => c.id === PR.pipelineNoStatusDate);
    expect(dropped?.sample).toEqual([]);
    expect(project(r, 'PRJ:2020-006887PRJ')?.quality).toEqual([PR.pipelineStatusDateLinked]);
    expect(history(r, 'PRJ:2020-006887PRJ')?.quality).toEqual([PR.pipelineStatusDateLinked]);
  });
});

describe('quality on records', () => {
  it('T3 quality is sorted and unique; qualityRules lists exactly the ids used, from the registry', () => {
    const r = derive((raw) => {
      raw['datasf-permits-newcon'][0].completed_date = '1909-06-02T00:00:00.000';
    });
    const a = project(r, 'PRJ:2019-000001PRJ');
    expect(a?.quality).toEqual([PR.dateValidRange, PR.stagesForwardClamp]);
    const used = [...new Set(r.file.projects.flatMap((p) => p.quality))].sort();
    expect(r.file.qualityRules).toEqual(
      used.map((id) => {
        const q = qualityRule(id);
        return { id, label: q.label, tier: q.tier, valueTier: q.valueTier };
      })
    );
    expect(() => parseProjectsFile(r.file, { asOf: ASOF })).not.toThrow();
  });

  it('qualityRules is empty when no project carries an id', () => {
    const r = derive((raw) => {
      // Entitlement after the permit filing no longer forces A's permitFiled up.
      raw['datasf-planning-review'][0].end_event_date = '2019-05-01T00:00:00.000';
    });
    expect(r.file.projects.every((p) => p.quality.length === 0)).toBe(true);
    expect(r.file.qualityRules).toEqual([]);
  });

  it('T4d quality drops the two rules that act only on T3', () => {
    expect([...T3_ONLY_QUALITY].sort()).toEqual([PR.multiphaseDaNetting, PR.parcelsSharedExisting]);
    expect(
      historyQuality(
        new Set([PR.parcelsSharedExisting, PR.stagesForwardClamp, PR.multiphaseDaNetting])
      )
    ).toEqual([PR.stagesForwardClamp]);
    expect(historyQuality(new Set([PR.stagesForwardClamp, PR.dateValidRange]))).toEqual([
      PR.dateValidRange,
      PR.stagesForwardClamp
    ]);
  });
});

describe('fixture-0 report.json (spec §6, §7 AC-7)', () => {
  const file = 'e2e/fixtures/data/fixture-0/report.json';
  it('carries every pr.* rule and none of the replaced keys', () => {
    expect(existsSync(file)).toBe(true);
    const counts = (JSON.parse(readFileSync(file, 'utf8')) as { counts: Record<string, number> })
      .counts;
    for (const id of IDS) {
      const keys = qualityRule(id).unitsWeighted
        ? ['fired', 'of', 'units', 'unitsOf']
        : ['fired', 'of'];
      for (const k of keys) expect(counts, `${id}.${k}`).toHaveProperty([key(id, k)]);
    }
    expect(Object.keys(counts).filter((k) => k.startsWith('histories.clamped.'))).toEqual([]);
    expect(counts).not.toHaveProperty(['projects.pipelineConflicts']);
  });
});
