import { describe, expect, it } from 'vitest';
import type { ParcelId } from '../data/parcel';
import {
  PROJECT_ID_RE,
  ProjectsFormatError,
  SCORE_ONLY_QUALITY_ID,
  parseProjectsFile,
  type InFlightProject,
  type ProjectsFile,
  type QualityRuleRef
} from './projects';
import type { Day } from './time';
import type { Pathway, Provenance, Stage } from './types';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// Restated literally from design doc row T3 (docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md).
interface RowInFlightProject {
  id: string;
  label: string | null;
  parcelIds: ParcelId[];
  pathway: Pathway;
  stage: Stage;
  history: Partial<Record<Stage, Day>>;
  units: number;
  existingUnits: number;
  stories: number | null;
  storiesTier: 0 | 3 | null;
  multiPhase: boolean;
  phases:
    | {
        units: number;
        parcelIds: ParcelId[];
        plannedPermitFiled: Day | null;
        source: { label: string; url: string; retrieved: string } | null;
      }[]
    | null;
  sources: { dataset: string; id: string; key?: string }[];
  quality: string[];
}
type RowQualityRuleRef = {
  id: string;
  label: string;
  tier: 2 | 3 | 4;
  valueTier: 0 | 1 | 2 | 3 | 4 | null;
};
type RowProjectsFile = {
  schema: 1;
  asOf: Day;
  rhnaCompletedNet: { units: number; since: Day; provenance: Provenance };
  qualityRules: RowQualityRuleRef[];
  projects: RowInFlightProject[];
};
type RowParseProjectsFile = (
  json: unknown,
  opts?: {
    asOf?: Day;
    parcelIds?: ReadonlySet<ParcelId>;
    onInvalid?: (path: string, message: string) => void;
  }
) => ProjectsFile;

const rowsMatch: Assert<
  Equals<InFlightProject, RowInFlightProject> extends true
    ? Equals<ProjectsFile, RowProjectsFile> extends true
      ? Equals<QualityRuleRef, RowQualityRuleRef> extends true
        ? Equals<typeof parseProjectsFile, RowParseProjectsFile>
        : false
      : false
    : false
> = true;

describe('compile-time row checks', () => {
  it('exported types equal the design-doc rows', () => {
    expect(rowsMatch).toBe(true);
  });
});

const ASOF = 20371;
const VALID_RANGE = 'pr.date.valid-range';
const FORWARD_CLAMP = 'pr.stages.forward-clamp';

function validFile(): ProjectsFile {
  return {
    schema: 1,
    asOf: ASOF,
    rhnaCompletedNet: {
      units: 12000,
      since: 19173,
      provenance: {
        tier: 0,
        label: 'Housing Inventory net units',
        sources: [{ label: 'SF Housing Inventory', url: 'https://example.org/hi' }],
        method: 'completions plus alteration gains, minus demolitions and losses',
        n: 3,
        window: ['2022-06-30', '2025-12-31']
      }
    },
    qualityRules: [
      { id: VALID_RANGE, label: 'Dates outside the valid range', tier: 2, valueTier: null },
      { id: FORWARD_CLAMP, label: 'Stage dates clamped forward', tier: 3, valueTier: 2 }
    ],
    projects: [
      {
        id: 'PRJ:2020-001234PRJ',
        label: '1 Main St',
        parcelIds: ['0001001', '0001002'],
        pathway: 'discretionary',
        stage: 'entitled',
        history: { filed: 19500, entitled: 20000 },
        units: 40,
        existingUnits: 2,
        stories: 6,
        storiesTier: 0,
        multiPhase: false,
        phases: null,
        sources: [{ dataset: 'p7e5-vtjv', id: '2020-001234PRJ', key: 'case_no' }],
        quality: [VALID_RANGE, FORWARD_CLAMP]
      },
      {
        id: 'BP:202001011234',
        label: null,
        parcelIds: ['0002001'],
        pathway: 'permitOnly',
        stage: 'permitIssued',
        history: { permitFiled: 19800, permitIssued: 20200 },
        units: 12,
        existingUnits: 0,
        stories: null,
        storiesTier: null,
        multiPhase: false,
        phases: null,
        sources: [{ dataset: 'i98e-djp9', id: '202001011234' }],
        quality: []
      },
      {
        id: 'CASE:2007.0001PRX',
        label: 'Block B',
        parcelIds: ['0003001'],
        pathway: 'discretionary',
        stage: 'entitled',
        history: { filed: 15000, entitled: 16000 },
        units: 300,
        existingUnits: 300,
        stories: 12,
        storiesTier: 3,
        multiPhase: true,
        phases: null,
        sources: [{ dataset: '6jgi-cpb4', id: '2007.0001PRX', key: 'case_no' }],
        quality: [FORWARD_CLAMP]
      }
    ]
  };
}

/** Makes projects[2] a score-only master: multiPhase, phases null, parcelIds [] (DQ-3). */
function scoreOnly(f: ProjectsFile): void {
  f.qualityRules.push({
    id: SCORE_ONLY_QUALITY_ID,
    label: 'Master with no free parcel',
    tier: 4,
    valueTier: null
  });
  f.qualityRules.sort((a, b) => (a.id < b.id ? -1 : 1));
  f.projects[2].parcelIds = [];
  f.projects[2].phases = null;
  f.projects[2].quality = [SCORE_ONLY_QUALITY_ID, FORWARD_CLAMP];
}

describe('parseProjectsFile accepts', () => {
  it('a valid file, returning the input itself', () => {
    const f = validFile();
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('a valid file with matching opts', () => {
    const f = validFile();
    const parcelIds = new Set(['0001001', '0001002', '0002001', '0003001']);
    expect(parseProjectsFile(f, { asOf: ASOF, parcelIds })).toBe(f);
  });

  it('a history with two stages on the same day (non-decreasing, not strictly increasing)', () => {
    const f = validFile();
    f.projects[0].history = { filed: 19500, entitled: 19500 };
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('an empty projects array, with no quality rules', () => {
    const f = validFile();
    f.projects = [];
    f.qualityRules = [];
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('projects with no quality and an empty qualityRules', () => {
    const f = validFile();
    for (const p of f.projects) p.quality = [];
    f.qualityRules = [];
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('a score-only master (multiPhase, phases null, parcelIds [])', () => {
    const f = validFile();
    scoreOnly(f);
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('every valueTier 0..4 and null, and every tier 2..4', () => {
    for (const valueTier of [0, 1, 2, 3, 4, null] as const) {
      for (const tier of [2, 3, 4] as const) {
        const f = validFile();
        f.qualityRules[0] = { ...f.qualityRules[0], tier, valueTier };
        expect(parseProjectsFile(f)).toBe(f);
      }
    }
  });

  it('enriched phases, with and without a source', () => {
    const f = validFile();
    f.projects[2].phases = [
      { units: 100, parcelIds: ['0003001'], plannedPermitFiled: 21000, source: null },
      {
        units: 200,
        parcelIds: [],
        plannedPermitFiled: null,
        source: { label: 'DA', url: 'https://example.org/da', retrieved: '2026-01-01' }
      }
    ];
    expect(parseProjectsFile(f)).toBe(f);
  });

  it('every PROJECT_ID_RE shape', () => {
    const ok = ['PRJ:a', 'PRJ:a:BP:b', 'BP:b', 'CASE:c', 'PPA:p'];
    expect(ok.map((s) => PROJECT_ID_RE.test(s))).toEqual(ok.map(() => true));
    const bad = ['', 'PRJ:', 'PRJ:a:b', 'BP:a:b', 'PRJ:a:BP:', 'XYZ:1', 'prj:a', 'PPA:a:BP:b'];
    expect(bad.map((s) => PROJECT_ID_RE.test(s))).toEqual(bad.map(() => false));
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
type Case = [name: string, mutate: (f: Loose) => void, path: string];

const P = 'projects[0]';
const cases: Case[] = [
  ['schema 2', (f) => (f.schema = 2), 'schema'],
  ['schema missing', (f) => delete f.schema, 'schema'],
  ['asOf fractional', (f) => (f.asOf = 20371.5), 'asOf'],
  ['asOf string', (f) => (f.asOf = '20371'), 'asOf'],
  ['asOf NaN', (f) => (f.asOf = NaN), 'asOf'],
  ['rhna missing', (f) => delete f.rhnaCompletedNet, 'rhnaCompletedNet'],
  ['rhna null', (f) => (f.rhnaCompletedNet = null), 'rhnaCompletedNet'],
  ['rhna units fractional', (f) => (f.rhnaCompletedNet.units = 1.5), 'rhnaCompletedNet.units'],
  ['rhna since string', (f) => (f.rhnaCompletedNet.since = 'x'), 'rhnaCompletedNet.since'],
  [
    'rhna provenance missing',
    (f) => delete f.rhnaCompletedNet.provenance,
    'rhnaCompletedNet.provenance'
  ],
  [
    'prov tier 5',
    (f) => (f.rhnaCompletedNet.provenance.tier = 5),
    'rhnaCompletedNet.provenance.tier'
  ],
  [
    'prov tier -1',
    (f) => (f.rhnaCompletedNet.provenance.tier = -1),
    'rhnaCompletedNet.provenance.tier'
  ],
  [
    'prov tier 1.5',
    (f) => (f.rhnaCompletedNet.provenance.tier = 1.5),
    'rhnaCompletedNet.provenance.tier'
  ],
  [
    'prov label empty',
    (f) => (f.rhnaCompletedNet.provenance.label = ''),
    'rhnaCompletedNet.provenance.label'
  ],
  [
    'prov method empty',
    (f) => (f.rhnaCompletedNet.provenance.method = ''),
    'rhnaCompletedNet.provenance.method'
  ],
  [
    'prov method number',
    (f) => (f.rhnaCompletedNet.provenance.method = 3),
    'rhnaCompletedNet.provenance.method'
  ],
  [
    'prov sources not array',
    (f) => (f.rhnaCompletedNet.provenance.sources = {}),
    'rhnaCompletedNet.provenance.sources'
  ],
  [
    'prov source url number',
    (f) => (f.rhnaCompletedNet.provenance.sources[0].url = 1),
    'rhnaCompletedNet.provenance.sources[0].url'
  ],
  [
    'prov source null',
    (f) => (f.rhnaCompletedNet.provenance.sources[0] = null),
    'rhnaCompletedNet.provenance.sources[0]'
  ],
  [
    'prov n Infinity',
    (f) => (f.rhnaCompletedNet.provenance.n = Infinity),
    'rhnaCompletedNet.provenance.n'
  ],
  [
    'prov n string',
    (f) => (f.rhnaCompletedNet.provenance.n = '3'),
    'rhnaCompletedNet.provenance.n'
  ],
  [
    'prov window one entry',
    (f) => (f.rhnaCompletedNet.provenance.window = ['a']),
    'rhnaCompletedNet.provenance.window'
  ],
  [
    'prov window number',
    (f) => (f.rhnaCompletedNet.provenance.window = ['a', 2]),
    'rhnaCompletedNet.provenance.window[1]'
  ],
  ['projects not array', (f) => (f.projects = {}), 'projects'],
  ['projects missing', (f) => delete f.projects, 'projects'],
  ['qualityRules missing', (f) => delete f.qualityRules, 'qualityRules'],
  ['qualityRules object', (f) => (f.qualityRules = {}), 'qualityRules'],
  ['qualityRule null', (f) => (f.qualityRules[0] = null), 'qualityRules[0]'],
  ['qualityRule array', (f) => (f.qualityRules[0] = []), 'qualityRules[0]'],
  ['qualityRule id number', (f) => (f.qualityRules[0].id = 7), 'qualityRules[0].id'],
  ['qualityRule id missing', (f) => delete f.qualityRules[0].id, 'qualityRules[0].id'],
  ['qualityRule label empty', (f) => (f.qualityRules[0].label = ''), 'qualityRules[0].label'],
  ['qualityRule label number', (f) => (f.qualityRules[0].label = 1), 'qualityRules[0].label'],
  ['qualityRule label missing', (f) => delete f.qualityRules[0].label, 'qualityRules[0].label'],
  ['qualityRule tier 1', (f) => (f.qualityRules[0].tier = 1), 'qualityRules[0].tier'],
  ['qualityRule tier 5', (f) => (f.qualityRules[0].tier = 5), 'qualityRules[0].tier'],
  ['qualityRule tier 2.5', (f) => (f.qualityRules[0].tier = 2.5), 'qualityRules[0].tier'],
  ['qualityRule tier string', (f) => (f.qualityRules[0].tier = '2'), 'qualityRules[0].tier'],
  [
    'qualityRule valueTier 5',
    (f) => (f.qualityRules[0].valueTier = 5),
    'qualityRules[0].valueTier'
  ],
  [
    'qualityRule valueTier -1',
    (f) => (f.qualityRules[0].valueTier = -1),
    'qualityRules[0].valueTier'
  ],
  [
    'qualityRule valueTier 1.5',
    (f) => (f.qualityRules[0].valueTier = 1.5),
    'qualityRules[0].valueTier'
  ],
  [
    'qualityRule valueTier missing',
    (f) => delete f.qualityRules[0].valueTier,
    'qualityRules[0].valueTier'
  ],
  [
    'qualityRules unsorted',
    (f) => (f.qualityRules = [f.qualityRules[1], f.qualityRules[0]]),
    'qualityRules[1].id'
  ],
  [
    'qualityRules duplicate id',
    (f) => f.qualityRules.splice(1, 0, { ...f.qualityRules[0] }),
    'qualityRules[1].id'
  ],
  [
    'qualityRule no project uses',
    (f) => f.qualityRules.push({ id: 'pr.zz.unused', label: 'x', tier: 2, valueTier: null }),
    'qualityRules[2].id'
  ],
  [
    'qualityRule used only by a malformed quality',
    (f) => {
      f.projects[0].quality = [VALID_RANGE];
      f.projects[2].quality = FORWARD_CLAMP;
    },
    'qualityRules[1].id'
  ],
  ['project null', (f) => (f.projects[1] = null), 'projects[1]'],
  ['project array', (f) => (f.projects[1] = []), 'projects[1]'],
  ['id number', (f) => (f.projects[0].id = 5), `${P}.id`],
  ['id bad prefix', (f) => (f.projects[0].id = 'XYZ:1'), `${P}.id`],
  ['id bad shape', (f) => (f.projects[0].id = 'BP:a:b'), `${P}.id`],
  ['id duplicate', (f) => (f.projects[2].id = f.projects[0].id), 'projects[2].id'],
  ['label number', (f) => (f.projects[0].label = 4), `${P}.label`],
  ['label undefined', (f) => delete f.projects[0].label, `${P}.label`],
  ['parcelIds not array', (f) => (f.projects[0].parcelIds = '0001001'), `${P}.parcelIds`],
  ['parcelIds empty', (f) => (f.projects[0].parcelIds = []), `${P}.parcelIds`],
  [
    'parcelIds empty on a phased master',
    (f) => {
      scoreOnly(f);
      f.projects[2].phases = [
        { units: 300, parcelIds: ['0003001'], plannedPermitFiled: null, source: null }
      ];
    },
    'projects[2].parcelIds'
  ],
  [
    'parcelIds empty on a master without the score-only rule',
    (f) => {
      scoreOnly(f);
      f.projects[2].quality = [FORWARD_CLAMP];
      f.qualityRules = f.qualityRules.filter((r: QualityRuleRef) => r.id !== SCORE_ONLY_QUALITY_ID);
    },
    'projects[2].parcelIds'
  ],
  [
    'parcelIds empty on a non-multiPhase project with the score-only rule',
    (f) => {
      scoreOnly(f);
      f.projects[2].quality = [FORWARD_CLAMP];
      f.projects[0].parcelIds = [];
      f.projects[0].quality = [VALID_RANGE, SCORE_ONLY_QUALITY_ID, FORWARD_CLAMP];
    },
    `${P}.parcelIds`
  ],
  ['parcelIds number', (f) => (f.projects[0].parcelIds = ['0001001', 5]), `${P}.parcelIds[1]`],
  [
    'parcelIds descending',
    (f) => (f.projects[0].parcelIds = ['0001002', '0001001']),
    `${P}.parcelIds[1]`
  ],
  [
    'parcelIds repeated',
    (f) => (f.projects[0].parcelIds = ['0001001', '0001001']),
    `${P}.parcelIds[1]`
  ],
  ['pathway unknown', (f) => (f.projects[0].pathway = 'fast'), `${P}.pathway`],
  ['pathway missing', (f) => delete f.projects[0].pathway, `${P}.pathway`],
  ['history array', (f) => (f.projects[0].history = []), `${P}.history`],
  ['history null', (f) => (f.projects[0].history = null), `${P}.history`],
  ['history empty', (f) => (f.projects[0].history = {}), `${P}.history`],
  ['history unknown stage', (f) => (f.projects[0].history.bogus = 20000), `${P}.history.bogus`],
  ['history day fractional', (f) => (f.projects[0].history.filed = 1.5), `${P}.history.filed`],
  [
    'history day after asOf',
    (f) => (f.projects[0].history.entitled = ASOF + 1),
    `${P}.history.entitled`
  ],
  ['history decreasing', (f) => (f.projects[0].history.filed = 20001), `${P}.history.entitled`],
  [
    'permitOnly has filed',
    (f) => (f.projects[1].history.filed = 19000),
    'projects[1].history.filed'
  ],
  [
    'permitOnly has entitled',
    (f) => (f.projects[1].history.entitled = 19900),
    'projects[1].history.entitled'
  ],
  ['stage not last history key', (f) => (f.projects[0].stage = 'filed'), `${P}.stage`],
  ['stage unknown', (f) => (f.projects[0].stage = 'nope'), `${P}.stage`],
  ['units zero', (f) => (f.projects[0].units = 0), `${P}.units`],
  ['units fractional', (f) => (f.projects[0].units = 2.5), `${P}.units`],
  ['units = existingUnits', (f) => (f.projects[0].units = 2), `${P}.units`],
  ['units < existingUnits', (f) => (f.projects[0].existingUnits = 50), `${P}.units`],
  ['existingUnits negative', (f) => (f.projects[0].existingUnits = -1), `${P}.existingUnits`],
  ['existingUnits fractional', (f) => (f.projects[0].existingUnits = 0.5), `${P}.existingUnits`],
  ['stories zero', (f) => (f.projects[0].stories = 0), `${P}.stories`],
  ['stories 81', (f) => (f.projects[0].stories = 81), `${P}.stories`],
  ['stories fractional', (f) => (f.projects[0].stories = 2.5), `${P}.stories`],
  ['stories undefined', (f) => delete f.projects[0].stories, `${P}.stories`],
  ['storiesTier 1', (f) => (f.projects[0].storiesTier = 1), `${P}.storiesTier`],
  ['storiesTier null with stories', (f) => (f.projects[0].storiesTier = null), `${P}.storiesTier`],
  [
    'storiesTier set without stories',
    (f) => (f.projects[1].storiesTier = 0),
    'projects[1].storiesTier'
  ],
  ['multiPhase string', (f) => (f.projects[0].multiPhase = 'no'), `${P}.multiPhase`],
  ['phases on non-multiPhase', (f) => (f.projects[0].phases = []), `${P}.phases`],
  ['phases undefined', (f) => delete f.projects[0].phases, `${P}.phases`],
  ['phases object', (f) => (f.projects[2].phases = {}), 'projects[2].phases'],
  ['phase null', (f) => (f.projects[2].phases = [null]), 'projects[2].phases[0]'],
  [
    'phase units zero',
    (f) =>
      (f.projects[2].phases = [
        { units: 0, parcelIds: [], plannedPermitFiled: null, source: null }
      ]),
    'projects[2].phases[0].units'
  ],
  [
    'phase parcelIds number',
    (f) =>
      (f.projects[2].phases = [
        { units: 1, parcelIds: [7], plannedPermitFiled: null, source: null }
      ]),
    'projects[2].phases[0].parcelIds[0]'
  ],
  [
    'phase plannedPermitFiled fractional',
    (f) =>
      (f.projects[2].phases = [{ units: 1, parcelIds: [], plannedPermitFiled: 1.5, source: null }]),
    'projects[2].phases[0].plannedPermitFiled'
  ],
  [
    'phase plannedPermitFiled missing',
    (f) => (f.projects[2].phases = [{ units: 1, parcelIds: [], source: null }]),
    'projects[2].phases[0].plannedPermitFiled'
  ],
  [
    'phase source missing',
    (f) => (f.projects[2].phases = [{ units: 1, parcelIds: [], plannedPermitFiled: null }]),
    'projects[2].phases[0].source'
  ],
  [
    'phase source retrieved number',
    (f) =>
      (f.projects[2].phases = [
        {
          units: 1,
          parcelIds: [],
          plannedPermitFiled: null,
          source: { label: 'a', url: 'b', retrieved: 3 }
        }
      ]),
    'projects[2].phases[0].source.retrieved'
  ],
  ['sources empty', (f) => (f.projects[0].sources = []), `${P}.sources`],
  ['sources not array', (f) => (f.projects[0].sources = null), `${P}.sources`],
  ['source null', (f) => (f.projects[0].sources = [null]), `${P}.sources[0]`],
  [
    'source dataset number',
    (f) => (f.projects[0].sources[0].dataset = 1),
    `${P}.sources[0].dataset`
  ],
  ['source id missing', (f) => delete f.projects[0].sources[0].id, `${P}.sources[0].id`],
  ['source key number', (f) => (f.projects[0].sources[0].key = 1), `${P}.sources[0].key`],
  ['quality missing', (f) => delete f.projects[1].quality, 'projects[1].quality'],
  ['quality null', (f) => (f.projects[1].quality = null), 'projects[1].quality'],
  ['quality number entry', (f) => (f.projects[0].quality[1] = 3), `${P}.quality[1]`],
  [
    'quality unsorted',
    (f) => (f.projects[0].quality = [FORWARD_CLAMP, VALID_RANGE]),
    `${P}.quality[1]`
  ],
  [
    'quality duplicated',
    (f) => (f.projects[0].quality = [VALID_RANGE, VALID_RANGE]),
    `${P}.quality[1]`
  ],
  [
    'quality id absent from qualityRules',
    (f) => (f.projects[1].quality = ['pr.nope.rule']),
    'projects[1].quality[0]'
  ],
  ['second project, deep path', (f) => (f.projects[1].units = 0), 'projects[1].units']
];

describe('parseProjectsFile rejects', () => {
  it.each(cases)('%s', (_name, mutate, path) => {
    const f = validFile();
    mutate(f);
    let err: unknown;
    try {
      parseProjectsFile(f);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProjectsFormatError);
    const e = err as ProjectsFormatError;
    expect(e.path).toBe(path);
    expect(e.name).toBe('ProjectsFormatError');
    expect(e.message).toMatch(
      new RegExp(`^projects\\.json ${path.replace(/[[\].$]/g, '\\$&')}: .+`)
    );
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a number', 7],
    ['undefined', undefined]
  ])('garbage root %s', (_name, root) => {
    expect(() => parseProjectsFile(root)).toThrow(ProjectsFormatError);
    try {
      parseProjectsFile(root);
    } catch (e) {
      expect((e as ProjectsFormatError).path).toBe('$');
    }
  });

  it('never throws anything but ProjectsFormatError on garbage fields', () => {
    const garbage: unknown[] = [null, undefined, 0, 'x', [], {}, true, NaN, () => 1];
    const fields = ['schema', 'asOf', 'rhnaCompletedNet', 'qualityRules', 'projects'];
    for (const field of fields) {
      for (const g of garbage) {
        const f = validFile() as unknown as Record<string, unknown>;
        f[field] = g;
        if (field === 'projects' && Array.isArray(g)) continue; // an empty array is valid
        expect(() => parseProjectsFile(f)).toThrow(ProjectsFormatError);
      }
    }
    const keys = Object.keys(validFile().projects[0]);
    for (const key of keys) {
      for (const g of garbage) {
        const f = validFile();
        (f.projects[0] as unknown as Record<string, unknown>)[key] = g;
        try {
          parseProjectsFile(f);
        } catch (e) {
          expect(e).toBeInstanceOf(ProjectsFormatError);
        }
      }
    }
  });

  it('opts.asOf mismatch', () => {
    const f = validFile();
    expect(() => parseProjectsFile(f, { asOf: ASOF + 1 })).toThrow(ProjectsFormatError);
    try {
      parseProjectsFile(f, { asOf: ASOF + 1 });
    } catch (e) {
      expect((e as ProjectsFormatError).path).toBe('asOf');
    }
  });

  it('a parcel missing from opts.parcelIds', () => {
    const f = validFile();
    const parcelIds = new Set(['0001001', '0002001', '0003001']);
    try {
      parseProjectsFile(f, { parcelIds });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectsFormatError);
      expect((e as ProjectsFormatError).path).toBe('projects[0].parcelIds[1]');
    }
  });

  it('reports the first violation when several exist', () => {
    const f = validFile();
    f.projects[0].units = 0;
    f.projects[1].units = 0;
    try {
      parseProjectsFile(f);
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectsFormatError).path).toBe('projects[0].units');
    }
  });

  it('throws a file-level violation before any project-level one', () => {
    const f = validFile();
    f.projects[0].units = 0;
    f.qualityRules.push({ id: 'pr.zz.unused', label: 'x', tier: 2, valueTier: null });
    try {
      parseProjectsFile(f);
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectsFormatError).path).toBe('qualityRules[2].id');
    }
  });
});

describe('parseProjectsFile with onInvalid', () => {
  type Call = [path: string, message: string];

  function run(f: unknown): { out: ProjectsFile; calls: Call[] } {
    const calls: Call[] = [];
    const out = parseProjectsFile(f, { onInvalid: (path, message) => calls.push([path, message]) });
    return { out, calls };
  }

  it('reports one invalid project once, with its path, and leaves it out', () => {
    const f = validFile();
    f.projects[1].units = 0;
    const before = structuredClone(f);
    const { out, calls } = run(f);
    expect(calls).toEqual([['projects[1].units', 'projects.json projects[1].units: must be >= 1']]);
    expect(out.projects).toEqual([before.projects[0], before.projects[2]]);
    expect(out.projects[0]).toBe(f.projects[0]);
    expect(out.projects[1]).toBe(f.projects[2]);
    expect(f).toEqual(before);
  });

  it('returns a shallow copy, never the input, and does not mutate it', () => {
    const f = validFile();
    const before = structuredClone(f);
    const { out, calls } = run(f);
    expect(calls).toEqual([]);
    expect(out).not.toBe(f);
    expect(out.projects).not.toBe(f.projects);
    expect(out).toEqual(before);
    expect(out.rhnaCompletedNet).toBe(f.rhnaCompletedNet);
    expect(out.qualityRules).toBe(f.qualityRules);
    expect(f).toEqual(before);
  });

  it('reports only the first violation of a project with several', () => {
    const f = validFile();
    f.projects[0].units = 0;
    f.projects[0].sources = [];
    const { out, calls } = run(f);
    expect(calls.map((c) => c[0])).toEqual(['projects[0].units']);
    expect(out.projects.map((p) => p.id)).toEqual(['BP:202001011234', 'CASE:2007.0001PRX']);
  });

  it('reports each invalid project, in input order, and may return none', () => {
    const f = validFile() as Loose;
    f.qualityRules = [];
    f.projects[0] = null;
    f.projects[1].stories = 99;
    f.projects[2].quality = [VALID_RANGE];
    const { out, calls } = run(f);
    expect(calls.map((c) => c[0])).toEqual([
      'projects[0]',
      'projects[1].stories',
      'projects[2].quality[0]'
    ]);
    expect(out.projects).toEqual([]);
  });

  it('judges qualityRules usage on the input array, so a rule used only by a dropped project passes', () => {
    const f = validFile();
    f.projects[2].quality = [];
    f.projects[0].units = 0; // the only user of both rules, and invalid
    const { out, calls } = run(f);
    expect(calls.map((c) => c[0])).toEqual(['projects[0].units']);
    expect(out.qualityRules).toEqual(f.qualityRules);
    expect(out.projects.map((p) => p.id)).toEqual(['BP:202001011234', 'CASE:2007.0001PRX']);
  });

  it('a duplicate id: the later project is the invalid one', () => {
    const f = validFile();
    f.projects[2].id = f.projects[0].id;
    const { out, calls } = run(f);
    expect(calls).toEqual([
      ['projects[2].id', `projects.json projects[2].id: duplicate id ${f.projects[0].id}`]
    ]);
    expect(out.projects).toEqual([f.projects[0], f.projects[1]]);
  });

  it.each([
    ['unsorted', [FORWARD_CLAMP, VALID_RANGE], 'projects[0].quality[1]'],
    ['duplicated', [VALID_RANGE, VALID_RANGE], 'projects[0].quality[1]'],
    ['absent from qualityRules', [VALID_RANGE, 'pr.nope.rule'], 'projects[0].quality[1]']
  ])('a quality array %s makes the project invalid', (_name, quality, path) => {
    const f = validFile();
    f.projects[0].quality = quality;
    const { out, calls } = run(f);
    expect(calls.map((c) => c[0])).toEqual([path]);
    expect(out.projects.map((p) => p.id)).toEqual(['BP:202001011234', 'CASE:2007.0001PRX']);
  });

  it('keeps a score-only master and drops a non-master with empty parcelIds', () => {
    const f = validFile();
    scoreOnly(f);
    f.projects[1].parcelIds = [];
    const { out, calls } = run(f);
    expect(calls.map((c) => c[0])).toEqual(['projects[1].parcelIds']);
    expect(out.projects.map((p) => p.id)).toEqual(['PRJ:2020-001234PRJ', 'CASE:2007.0001PRX']);
  });

  it('applies opts.parcelIds per project', () => {
    const f = validFile();
    const calls: Call[] = [];
    const out = parseProjectsFile(f, {
      asOf: ASOF,
      parcelIds: new Set(['0001001', '0001002', '0003001']),
      onInvalid: (path, message) => calls.push([path, message])
    });
    expect(calls.map((c) => c[0])).toEqual(['projects[1].parcelIds[0]']);
    expect(out.projects).toHaveLength(2);
  });

  it.each<Case>([
    ['bad schema', (f) => (f.schema = 2), 'schema'],
    ['opts-free asOf garbage', (f) => (f.asOf = 'x'), 'asOf'],
    ['bad rhnaCompletedNet', (f) => (f.rhnaCompletedNet = null), 'rhnaCompletedNet'],
    ['projects not an array', (f) => (f.projects = {}), 'projects'],
    [
      'unsorted qualityRules',
      (f) => (f.qualityRules = [f.qualityRules[1], f.qualityRules[0]]),
      'qualityRules[1].id'
    ],
    [
      'a listed rule no project uses',
      (f) => f.qualityRules.push({ id: 'pr.zz.unused', label: 'x', tier: 2, valueTier: null }),
      'qualityRules[2].id'
    ],
    ['a bad qualityRules tier', (f) => (f.qualityRules[0].tier = 1), 'qualityRules[0].tier']
  ])('a file-level violation still throws: %s', (_name, mutate, path) => {
    const f = validFile();
    f.projects[0].units = 0; // a project-level violation too: never reported
    mutate(f);
    const calls: Call[] = [];
    try {
      parseProjectsFile(f, { onInvalid: (p, m) => calls.push([p, m]) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectsFormatError);
      expect((e as ProjectsFormatError).path).toBe(path);
    }
    expect(calls).toEqual([]);
  });

  it('opts.asOf mismatch still throws', () => {
    const f = validFile();
    const onInvalid = () => expect.unreachable();
    expect(() => parseProjectsFile(f, { asOf: ASOF + 1, onInvalid })).toThrow(ProjectsFormatError);
  });

  it('a garbage root still throws', () => {
    expect(() => parseProjectsFile(null, { onInvalid: () => {} })).toThrow(ProjectsFormatError);
  });
});

describe('units minus existingUnits', () => {
  it('is 0 only for multiPhase', () => {
    const f = validFile();
    expect(f.projects[2].units - f.projects[2].existingUnits).toBe(0);
    expect(parseProjectsFile(f)).toBe(f);
    f.projects[2].multiPhase = false;
    expect(() => parseProjectsFile(f)).toThrow(ProjectsFormatError);
  });
});

describe('ProjectsFormatError', () => {
  it('carries name, path and message', () => {
    const e = new ProjectsFormatError('projects[3].history.filed', 'bad');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ProjectsFormatError');
    expect(e.path).toBe('projects[3].history.filed');
    expect(e.message).toBe('projects.json projects[3].history.filed: bad');
  });
});
