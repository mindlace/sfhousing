import { describe, expect, it } from 'vitest';
import type { ParcelId } from '../data/parcel';
import {
  PROJECT_ID_RE,
  ProjectsFormatError,
  parseProjectsFile,
  type InFlightProject,
  type ProjectsFile
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
}
type RowProjectsFile = {
  schema: 1;
  asOf: Day;
  rhnaCompletedNet: { units: number; since: Day; provenance: Provenance };
  projects: RowInFlightProject[];
};

const rowsMatch: Assert<
  Equals<InFlightProject, RowInFlightProject> extends true
    ? Equals<ProjectsFile, RowProjectsFile>
    : false
> = true;

describe('compile-time row checks', () => {
  it('exported types equal the design-doc rows', () => {
    expect(rowsMatch).toBe(true);
  });
});

const ASOF = 20371;

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
        sources: [{ dataset: 'p7e5-vtjv', id: '2020-001234PRJ', key: 'case_no' }]
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
        sources: [{ dataset: 'i98e-djp9', id: '202001011234' }]
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
        sources: [{ dataset: '6jgi-cpb4', id: '2007.0001PRX', key: 'case_no' }]
      }
    ]
  };
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

  it('an empty projects array', () => {
    const f = validFile();
    f.projects = [];
    expect(parseProjectsFile(f)).toBe(f);
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
  ['project null', (f) => (f.projects[1] = null), 'projects[1]'],
  ['project array', (f) => (f.projects[0] = []), 'projects[0]'],
  ['id number', (f) => (f.projects[0].id = 5), `${P}.id`],
  ['id bad prefix', (f) => (f.projects[0].id = 'XYZ:1'), `${P}.id`],
  ['id bad shape', (f) => (f.projects[0].id = 'BP:a:b'), `${P}.id`],
  ['id duplicate', (f) => (f.projects[2].id = f.projects[0].id), 'projects[2].id'],
  ['label number', (f) => (f.projects[0].label = 4), `${P}.label`],
  ['label undefined', (f) => delete f.projects[0].label, `${P}.label`],
  ['parcelIds not array', (f) => (f.projects[0].parcelIds = '0001001'), `${P}.parcelIds`],
  ['parcelIds empty', (f) => (f.projects[0].parcelIds = []), `${P}.parcelIds`],
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
    const fields = ['schema', 'asOf', 'rhnaCompletedNet', 'projects'];
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
