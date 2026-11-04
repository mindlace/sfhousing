// The live /lesscars plan (pipeline/enrichment/lesscars/plan.json) held to the owner-approved
// document, docs/lesscars/plan-v1.md: Appendix A plus the v1.1 section ("freeway removal and
// freeway land": Owner decisions, Phases, Garages, Appendix A changes). This file parses the
// document's tables itself and rebuilds the expected plan from them, so it checks the
// transcription rather than echoing whatever produced plan.json. CNN lists come from corridors.resolved.json; the geary-trench CNNs
// and the Masonic display are the Plan 3 Decisions (global.md), restated here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLessCarsPlan,
  type LessCarsPlan,
  type Param,
  type PlanProject,
  type SegmentRef
} from '../../src/lib/data/lesscars/plan';
import { checkPlan, schedulePlan, yearStart } from '../../src/lib/data/lesscars/schedule';
import type { Provenance } from '../../src/lib/timelapse/types';
import { parseFreewayLand } from '../lib/lesscars/freeway-land';
import { LESSCARS_FREEWAY_LAND_JSON, LESSCARS_PLAN_JSON } from '../lesscars-config';
import { table, under } from './lesscars-doc';
import { CORRIDORS_RESOLVED_JSON } from '../steps/lesscars-cnns';

const ROOT = join(import.meta.dirname, '../..');
const DOC = readFileSync(join(ROOT, 'docs/lesscars/plan-v1.md'), 'utf8');
const plan: LessCarsPlan = parseLessCarsPlan(
  JSON.parse(readFileSync(LESSCARS_PLAN_JSON.live, 'utf8'))
);
interface ResolvedCorridor {
  owner: string;
  street: string;
  from: string;
  to: string;
  cnn: string[];
}
const catalog = parseFreewayLand(JSON.parse(readFileSync(LESSCARS_FREEWAY_LAND_JSON.live, 'utf8')));
const resolved: { corridors: ResolvedCorridor[] } = JSON.parse(
  readFileSync(CORRIDORS_RESOLVED_JSON, 'utf8')
);

/** Decisions: the trench's main lanes, their twins and the Fillmore frontage roads. */
const FOURTEEN = [
  '6039201',
  '6040201',
  '6041201',
  '6039101',
  '6039102',
  '6040102',
  '6040103',
  '6040104',
  '6041101',
  '6041102',
  '6041103',
  '6041202',
  '6041203',
  '6041204'
];
const MASONIC_LABEL = 'Masonic underpass filled: Geary at grade at the Masonic station';

// ---- Markdown tables -------------------------------------------------------------------------

type Table = { header: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Every pipe table in the section under `heading` (an exact heading line), up to the next one. */
function tablesUnder(heading: string, after = 0): Table[] {
  const lines = DOC.split('\n');
  const start = lines.findIndex((l, i) => i >= after && l.trim() === heading);
  if (start < 0) throw new Error(`no heading ${heading}`);
  const out: Table[] = [];
  let cur: string[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6} /.test(l)) break;
    if (l.trim().startsWith('|')) (cur ??= []).push(l);
    else if (cur) {
      out.push({ header: cells(cur[0]), rows: cur.slice(2).map(cells) });
      cur = null;
    }
  }
  if (cur) out.push({ header: cells(cur[0]), rows: cur.slice(2).map(cells) });
  return out;
}

const APPENDIX_A = DOC.split('\n').findIndex((l) => l === '## Appendix A: plan.json fields');
const appendixTable = (heading: string) => tablesUnder(heading, APPENDIX_A)[0];
const unquote = (s: string) => s.replace(/^`|`$/g, '');
/** Markdown marks out, wording kept: code backticks and `_x_` / `*x*` emphasis (controller ruling). */
const stripMarkdown = (s: string) =>
  s
    .replace(/`/g, '')
    .replace(/(?<![\w*])\*{1,2}([^*]+?)\*{1,2}(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_{1,2}([^_]+?)_{1,2}(?![\w_])/g, '$1');
const MARKDOWN_MARK = /`|(?<![\w*])\*[^*]+\*(?![\w*])|(?<![\w_])_[^_]+_(?![\w_])/;

// ---- Appendix B sources and Appendix A provenances --------------------------------------------

// A source without a URL (D4, a code reference) is never a provenance source; citing one throws below.
const SOURCES = new Map(
  tablesUnder('## Appendix B: sources')[0].rows.flatMap(([id, source]) => {
    const url = source.match(/https?:\/\/\S+/);
    return url
      ? [[id, { label: stripMarkdown(source.slice(0, url.index).trim()), url: url[0] }] as const]
      : [];
  })
);

const provenanceRow = ([id, tier, label, sources, method]: string[]): [string, Provenance] => [
  id,
  {
    tier: Number(tier) as Provenance['tier'],
    label: stripMarkdown(label),
    sources:
      sources === '—'
        ? []
        : sources.split(', ').map((s) => {
            const src = SOURCES.get(s);
            if (!src) throw new Error(`${id}: no Appendix B row for ${s}`);
            return src;
          }),
    method: stripMarkdown(method)
  }
];

// Appendix A's rows, then the v1.1 section's "Provenances added" (v1's rows stay valid for the
// parameters v1.1 leaves unchanged: PV-hwy, PV-row-cfwy, PV-garage, PV-build).
const PROVENANCES = new Map<string, Provenance>([
  ...appendixTable('### Provenances').rows.map(provenanceRow),
  ...tablesUnder('#### Provenances added')[0].rows.map(provenanceRow)
]);

function pv(id: string): Provenance {
  const p = PROVENANCES.get(id);
  if (!p) throw new Error(`no provenance row ${id}`);
  return p;
}

/** `108 (PV-subway)` → a Param. */
function param(text: string): Param {
  const m = text.match(/^(\d[\d,]*(?:\.\d+)?) \((PV-[\w-]+)\)$/);
  if (!m) throw new Error(`not a Param: ${text}`);
  return { value: Number(m[1].replace(/,/g, '')), provenance: pv(m[2]) };
}

const appendixProvenance = (label: string) =>
  [...PROVENANCES.values()].find((p) => p.label === label);
const pick = (p: Provenance) => ({
  tier: p.tier,
  label: p.label,
  sources: p.sources,
  method: p.method
});

// ---- The expected plan, rebuilt from the document -----------------------------------------------

/** Field → value per project id, from a single "Value" table or a multi-project table. */
function projectFields(heading: string): Map<string, Record<string, string>> {
  const t = appendixTable(heading);
  const ids = t.header.slice(1).map(unquote);
  const out = new Map<string, Record<string, string>>();
  if (ids.length === 1 && ids[0] === 'Value') {
    const r = Object.fromEntries(t.rows.map(([f, v]) => [unquote(f), v]));
    out.set(unquote(r.id), r);
  } else {
    ids.forEach((id, j) =>
      out.set(id, Object.fromEntries(t.rows.map((row) => [unquote(row[0]), row[j + 1]])))
    );
  }
  return out;
}

const COORD = /\[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]/g;
const coords = (s: string): [number, number][] =>
  [...s.matchAll(COORD)].map((m) => [Number(m[1]), Number(m[2])]);

function selectorSegments(owner: string, text: string): SegmentRef[] {
  const sels = text.split('; ').map((s) => {
    const m = unquote(s).match(/^(.+?), (.+) → (.+)$/);
    if (!m) throw new Error(`${owner}: not a selector: ${s}`);
    return { street: m[1], from: m[2], to: m[3] };
  });
  return sels.map((s) => {
    const r = resolved.corridors.find(
      (c) => c.owner === owner && c.street === s.street && c.from === s.from && c.to === s.to
    );
    if (!r) throw new Error(`${owner}: ${s.street} ${s.from} → ${s.to} not resolved`);
    return { cnn: r.cnn };
  });
}

function expectedProject(f: Record<string, string>): PlanProject {
  const id = unquote(f.id);
  const kind = unquote(f.kind) as PlanProject['kind'];
  const startYear = Number(f.startYear.match(/^(\d{4})/)?.[1]);
  const base = {
    id,
    label: stripMarkdown(f.label),
    kind,
    startYear,
    durationMonths: param(f.durationMonths),
    dependsOn: JSON.parse(unquote(f.dependsOn)) as string[],
    ...(id === 'geary-19th-subway-2' ? { opensAfter: ['geary-subway-1'] } : {})
  };
  const build = () => {
    const m = f.build.match(/^`\{ startYear: (\d{4}), durationMonths: (.+) \}`$/);
    if (!m) throw new Error(`${id}: bad build ${f.build}`);
    return { startYear: Number(m[1]), durationMonths: param(m[2]) };
  };
  switch (kind) {
    case 'transit-line': {
      const stops = f.stops.split('; ').map((s) => {
        const m = s.match(/^`(lc:[^`]+)` (.+) \[(-?[\d.]+), (-?[\d.]+)\]$/);
        if (!m) throw new Error(`${id}: bad stop ${s}`);
        return {
          id: m[1],
          name: stripMarkdown(m[2]),
          lngLat: [Number(m[3]), Number(m[4])] as [number, number]
        };
      });
      const at = coords(f.alignment);
      const stopLine = stops.map((s) => s.lngLat);
      const alignment =
        id === 'geary-subway-1'
          ? stopLine
          : id === 'geary-19th-subway-2'
            ? [at[0], ...stopLine, at[1]]
            : at;
      return {
        ...base,
        kind,
        mode: unquote(f.mode) as 'subway',
        stops,
        peakTph: param(f.peakTph),
        alignment
      };
    }
    case 'bus-lane':
      return {
        ...base,
        kind,
        routeIds: JSON.parse(unquote(f.routeIds)),
        stopIds: f.stopIds
          .replace('`muni:` + ', '')
          .split(' ')
          .map((n) => `muni:${n}`),
        segments: selectorSegments(id, f.segments),
        peakTph: param(f.peakTph)
      };
    case 'tram-priority':
      return {
        ...base,
        kind,
        routeIds: JSON.parse(unquote(f.routeIds)),
        segments: selectorSegments(id, f.segments),
        peakTph: param(f.peakTph)
      };
    case 'street-change':
      return {
        ...base,
        kind,
        segments: selectorSegments(id, f.segments),
        lanes: JSON.parse(unquote(f.lanes))
      };
    case 'edge-garage':
      return {
        ...base,
        kind,
        site: { parcel: f.site.match(/parcel: "(\d+)"/)![1] },
        spaces: param(f.spaces)
      };
    case 'highway-truncation':
      return {
        ...base,
        kind,
        segments: [
          {
            line: coords(f.segments),
            provenance: pv(f.segments.match(/provenance: (PV-[\w-]+)/)![1])
          }
        ],
        rowHalfWidthM: param(f.rowHalfWidthM),
        build: build()
      };
    case 'street-removal': {
      // Appendix A lists the main lanes; the Decisions add their twins and frontage roads.
      const listed = JSON.parse(f.segments.match(/cnn: (\[.*?\])/)![1]) as string[];
      for (const c of listed) if (!FOURTEEN.includes(c)) throw new Error(`${id}: ${c}`);
      return {
        ...base,
        kind,
        segments: [{ cnn: FOURTEEN }],
        rowHalfWidthM: param(f.rowHalfWidthM),
        build: build()
      };
    }
    default:
      throw new Error(`${id}: unexpected kind ${kind}`);
  }
}

const NAMED_HEADINGS = DOC.split('\n')
  .slice(APPENDIX_A)
  .filter((l) => l.startsWith('### '))
  .filter((l) => !['### Provenances', '### Capacity', '### Parking conversions'].includes(l));

const SITES = tablesUnder('### Parking sites').find(
  (t) => t.header[0] === 'Parcel' && t.header[1] === 'Street'
)!;
/** A Data-findings row's parcel id; the cell may carry the **dropped** marker after it. */
const siteParcel = (row: string[]) => row[0].match(/`(\d+)`/)![1];
/** Data-findings rows marked **dropped** (Correction 2026-11-02): kept as findings, not in the plan. */
const isDropped = (row: string[]) => /\*\*dropped\*\*/.test(row[0]);
const DROPPED = SITES.rows.filter(isDropped).map(siteParcel);
const KEPT_SITES = SITES.rows.filter((r) => !isDropped(r));
const siteOf = (parcel: string) => SITES.rows.find((r) => siteParcel(r) === parcel);

function appendixParkingRows() {
  return appendixTable('### Parking conversions').rows.map(
    ([id, parcel, startYear, months, dependsOn, buildStart]) => ({
      id: unquote(id),
      parcel: unquote(parcel),
      startYear: Number(startYear),
      months: param(months),
      dependsOn: [unquote(dependsOn)],
      buildStart: Number(buildStart)
    })
  );
}

// ---- The v1.1 section -----------------------------------------------------------------------------

const V11 = under(DOC, '## v1.1 (2026-11-03): freeway removal and freeway land');
const v11Fields = (heading: string): Record<string, string> =>
  Object.fromEntries(
    table(under(V11, heading)).map((r) => [unquote(r['Field']), r[Object.keys(r)[1]]])
  );
/** The ids in a "Projects added" / "Projects removed" table's first column. */
const idsIn = (heading: string): string[] =>
  table(under(V11, heading)).map((r) => unquote(Object.values(r)[0]));
const ADDED = idsIn('#### Projects added');
const REMOVED = idsIn('#### Projects removed');
const US101_PHASES = ['us101-interchange', 'us101-james-lick', 'us101-bayshore'];
const PHASES = ['central-freeway-stub', ...US101_PHASES, 'i80-rincon'];

/** The catalog segment a phase removes; each phase removes exactly one. */
const segmentOf = (phase: string) => {
  const segs = catalog.segments.filter((s) => s.removedBy === phase);
  if (segs.length !== 1) throw new Error(`${phase}: ${segs.length} catalog segments`);
  return segs[0];
};

/** A phase's field table in the v1.1 section → its highway-truncation project. */
function expectedPhase(id: string): PlanProject {
  const f = v11Fields(`#### ${id} ${id === 'central-freeway-stub' ? '(changed)' : '(added)'}`);
  const m = f.build.match(/^`\{ startYear: (\d{4}), durationMonths: (.+) \}`$/);
  if (!m) throw new Error(`${id}: bad build ${f.build}`);
  const parcels = JSON.parse(f.freewayLand.match(/parcels `(\[.*?\])`/)![1]) as string[];
  return {
    id,
    label: stripMarkdown(f.label),
    kind: 'highway-truncation',
    startYear: Number(f.startYear),
    durationMonths: param(f.durationMonths),
    dependsOn: JSON.parse(unquote(f.dependsOn)) as string[],
    segments: [{ cnn: JSON.parse(f.segments.match(/cnn: (\[.*?\])/)![1]) as string[] }],
    rowHalfWidthM: param(f.rowHalfWidthM),
    build: { startYear: Number(m[1]), durationMonths: param(m[2]) },
    freewayLand: { parcels, excluded: segmentOf(id).excluded }
  };
}

function expectedGarageRincon(): PlanProject {
  const f = v11Fields('##### garage-rincon');
  return {
    id: 'garage-rincon',
    label: stripMarkdown(f.label),
    kind: 'edge-garage',
    startYear: Number(f.startYear),
    durationMonths: param(f.durationMonths),
    dependsOn: JSON.parse(unquote(f.dependsOn)) as string[],
    site: { parcel: f.site.match(/parcel: "(\d+)"/)![1] },
    spaces: param(f.spaces)
  };
}

/** "Capacity changed": each row replaces that kind's maxConcurrent and provenance. */
const CAPACITY_CHANGED = table(under(V11, '#### Capacity changed')).map((r) => ({
  kind: unquote(r['`kind`']),
  max: Number(r['v1.1 `maxConcurrent`']),
  provenance: pv(r['`provenance`'])
}));

/** Appendix A's projects with the v1.1 changes: garage-south becomes garage-rincon in place, and
 *  the stub is replaced by the stub and the four phases. */
function applyV11(named: PlanProject[]): PlanProject[] {
  return named.flatMap((p) =>
    REMOVED.includes(p.id)
      ? [expectedGarageRincon()]
      : p.id === 'central-freeway-stub'
        ? PHASES.map(expectedPhase)
        : [p]
  );
}

function expectedPlan(): LessCarsPlan {
  const named = applyV11(
    NAMED_HEADINGS.flatMap((h) => [...projectFields(h.trim()).values()]).map(expectedProject)
  );
  const parking: PlanProject[] = appendixParkingRows().map((r) => ({
    id: r.id,
    label: `Parking at ${stripMarkdown(siteOf(r.parcel)![1])} becomes homes`,
    kind: 'parking-conversion',
    startYear: r.startYear,
    durationMonths: r.months,
    dependsOn: r.dependsOn,
    parcel: r.parcel,
    build: { startYear: r.buildStart, durationMonths: param('30 (PV-build)') }
  }));
  const masonic = resolved.corridors.filter((c) => c.owner === 'masonic-station');
  return {
    schema: 1,
    id: 'lesscars-v1',
    label: 'Fewer cars, v1',
    capacity: appendixTable('### Capacity').rows.map(([kind, max, prov]) => {
      const changed = CAPACITY_CHANGED.find((c) => c.kind === unquote(kind));
      return {
        kind: unquote(kind) as 'transit',
        maxConcurrent: changed ? changed.max : Number(max),
        provenance: changed ? changed.provenance : pv(prov)
      };
    }),
    projects: [...named, ...parking],
    displays: [
      {
        id: 'masonic-station',
        label: MASONIC_LABEL,
        segments: masonic.map((c) => ({ cnn: c.cnn })),
        from: 'geary-subway-1'
      }
    ]
  };
}

// ---- Walking the plan ---------------------------------------------------------------------------

function params(p: LessCarsPlan): { path: string; provenance: Provenance }[] {
  const out: { path: string; provenance: Provenance }[] = [];
  p.capacity.forEach((c, i) => out.push({ path: `capacity.${i}`, provenance: c.provenance }));
  p.projects.forEach((pr) => {
    const add = (k: string, v: Param) =>
      out.push({ path: `${pr.id}.${k}`, provenance: v.provenance });
    add('durationMonths', pr.durationMonths);
    if ('peakTph' in pr) add('peakTph', pr.peakTph);
    if ('spaces' in pr) add('spaces', pr.spaces);
    if ('rowHalfWidthM' in pr) add('rowHalfWidthM', pr.rowHalfWidthM);
    if ('build' in pr && pr.build) add('build.durationMonths', pr.build.durationMonths);
    if ('segments' in pr)
      pr.segments.forEach((s, i) => {
        if ('line' in s) out.push({ path: `${pr.id}.segments.${i}`, provenance: s.provenance });
      });
  });
  return out;
}

const projectOf = (p: LessCarsPlan, id: string) => {
  const pr = p.projects.find((x) => x.id === id);
  if (!pr) throw new Error(`no project ${id}`);
  return pr;
};
const cnnsOf = (p: LessCarsPlan, owner: string): string[][] => {
  const segs =
    owner === 'masonic-station'
      ? ((p.displays ?? []).find((d) => d.id === owner)?.segments ?? [])
      : ('segments' in projectOf(p, owner) &&
          (projectOf(p, owner) as { segments: SegmentRef[] }).segments) ||
        [];
  return segs.flatMap((s) => ('cnn' in s ? [s.cnn] : []));
};
const codes = (problems: { code: string; project: string }[]) =>
  problems.map((x) => `${x.project}:${x.code}`);
const clone = (): LessCarsPlan => structuredClone(plan);

// ---- Tests --------------------------------------------------------------------------------------

describe('the live plan (plan-v1 Appendix A plus the v1.1 section)', () => {
  it('parses and checkPlan on the live plan is empty', () => {
    expect(checkPlan(plan, schedulePlan(plan))).toEqual([]);
  });

  it('has the approved v1.1 shape', () => {
    const ids = plan.projects.map((p) => p.id);
    expect(plan.id).toBe('lesscars-v1');
    expect(plan.label).toBe('Fewer cars, v1');
    expect(ids).not.toContain('garage-south');
    expect(ids).not.toContain('garage-alemany');
    expect(ids).toEqual(expect.arrayContaining(['garage-rincon', 'i80-rincon', ...US101_PHASES]));
    expect(ADDED).toEqual(['garage-rincon', ...US101_PHASES, 'i80-rincon']);
    expect(REMOVED).toEqual(['garage-south']);
    expect(plan.projects).toHaveLength(64 + ADDED.length - REMOVED.length);
    expect(plan.projects.filter((p) => p.kind === 'parking-conversion')).toHaveLength(46);
    expect(plan.capacity.map((c) => [c.kind, c.maxConcurrent])).toEqual([
      ['transit', 4],
      ['street', 7],
      ['garage', 2],
      ['housing', 15]
    ]);
    expect(plan.capacity.find((c) => c.kind === 'street')?.provenance.label).toBe(
      'Seven street projects at once (invented)'
    );
  });

  it('equals the plan rebuilt from the document, field for field and in order', () => {
    const expected = expectedPlan();
    expect(plan.projects.map((p) => p.id)).toEqual(expected.projects.map((p) => p.id));
    for (const [i, p] of expected.projects.entries()) expect(plan.projects[i], p.id).toEqual(p);
    expect(plan).toEqual(expected);
  });

  it('every Param has a provenance label; every tier 4 label says invented or unsourced', () => {
    const all = params(plan);
    expect(all.length).toBeGreaterThan(64);
    for (const { path, provenance } of all) {
      expect(provenance.label.trim(), path).not.toBe('');
      if (provenance.tier === 4) expect(provenance.label, path).toMatch(/invented|unsourced/i);
    }
  });

  it('every provenance equals its row (Appendix A or v1.1; tier, label, sources, method)', () => {
    for (const { path, provenance } of params(plan)) {
      const row = appendixProvenance(provenance.label);
      expect(row, path).toBeDefined();
      expect(pick(provenance), path).toEqual(row);
    }
  });

  it('the parking conversions equal Appendix A, row for row', () => {
    const parking = plan.projects.flatMap((p) =>
      p.kind === 'parking-conversion'
        ? [
            {
              id: p.id,
              parcel: p.parcel,
              startYear: p.startYear,
              months: p.durationMonths,
              dependsOn: p.dependsOn,
              buildStart: p.build.startYear
            }
          ]
        : []
    );
    expect(parking).toEqual(appendixParkingRows());
  });

  it("the Appendix A parking rows agree with the Data findings' 48-site table, less the dropped", () => {
    const rows = appendixParkingRows();
    expect(SITES.rows).toHaveLength(48);
    expect(KEPT_SITES).toHaveLength(46);
    expect(new Set(rows.map((r) => r.parcel))).toEqual(new Set(KEPT_SITES.map(siteParcel)));
    for (const r of rows) {
      const site = siteOf(r.parcel)!;
      expect(site[7].split(' ')[0], r.id).toBe(r.dependsOn[0]);
      expect(r.months.provenance.label, r.id).toBe(
        pv(site[3] === 'PL' ? 'PV-clear-lot' : 'PV-clear-garage').label
      );
      expect(r.buildStart, r.id).toBe(r.startYear + 1);
    }
  });

  it('no parking conversion targets a parcel the Data findings mark as dropped', () => {
    expect(DROPPED.length).toBeGreaterThan(0);
    const parcels = plan.projects.flatMap((p) =>
      p.kind === 'parking-conversion' ? [p.parcel] : []
    );
    for (const d of DROPPED) expect(parcels, d).not.toContain(d);
    for (const d of DROPPED)
      expect(
        appendixParkingRows().map((r) => r.parcel),
        d
      ).not.toContain(d);
  });

  it('selector segments equal corridors.resolved.json', () => {
    for (const c of resolved.corridors)
      expect(cnnsOf(plan, c.owner), c.owner).toContainEqual(c.cnn);
    const resolvedOwners = [...new Set(resolved.corridors.map((c) => c.owner))].sort();
    const selectorOwnersInPlan = [
      ...plan.projects
        .filter(
          (p) =>
            'segments' in p &&
            p.kind !== 'street-removal' &&
            p.kind !== 'highway-truncation' &&
            p.segments.every((s) => 'cnn' in s)
        )
        .map((p) => p.id),
      ...(plan.displays ?? []).map((d) => d.id)
    ].sort();
    expect(resolvedOwners).toEqual(selectorOwnersInPlan);
    for (const owner of resolvedOwners)
      expect(cnnsOf(plan, owner), owner).toEqual(
        resolved.corridors.filter((c) => c.owner === owner).map((c) => c.cnn)
      );
  });

  it('geary-trench removes the main lanes, their twins and the Fillmore frontage roads', () => {
    const trenchCnns = cnnsOf(plan, 'geary-trench').flat();
    expect([...trenchCnns].sort()).toEqual([...FOURTEEN].sort());
  });

  it('phase 2 opens after phase 1, and the check would catch the reverse', () => {
    const s = schedulePlan(plan);
    const open = (id: string) => s.times.get(id)!.openDay;
    expect(projectOf(plan, 'geary-19th-subway-2').opensAfter).toEqual(['geary-subway-1']);
    expect(plan.projects.filter((p) => p.opensAfter)).toHaveLength(1);
    expect(open('geary-19th-subway-2')).toBeGreaterThanOrEqual(open('geary-subway-1'));
    const phase2Earlier = clone();
    projectOf(phase2Earlier, 'geary-19th-subway-2').startYear = 2030;
    expect(codes(checkPlan(phase2Earlier, schedulePlan(phase2Earlier)))).toContain(
      'geary-19th-subway-2:opens-before'
    );
  });

  it('Masonic is a display from geary-subway-1, no project touches its CNNs, nothing is a roundabout', () => {
    expect(plan.displays).toEqual([
      expect.objectContaining({
        id: 'masonic-station',
        from: 'geary-subway-1',
        label: MASONIC_LABEL
      })
    ]);
    const masonicCnns = cnnsOf(plan, 'masonic-station').flat();
    expect(masonicCnns.length).toBeGreaterThan(0);
    const projectCnns = plan.projects.flatMap((p) => cnnsOf(plan, p.id).flat());
    expect(projectCnns.some((c) => masonicCnns.includes(c))).toBe(false);
    expect(JSON.stringify(plan)).not.toMatch(/roundabout/i);
  });

  it('a display id reused by a project reports duplicate-id on that id', () => {
    const withClash = clone();
    withClash.projects.push({
      ...structuredClone(projectOf(plan, 'van-ness-street')),
      id: 'masonic-station'
    });
    expect(codes(checkPlan(withClash, schedulePlan(withClash)))).toContain(
      'masonic-station:duplicate-id'
    );
  });

  describe('v1.1', () => {
    const byId = (id: string) => projectOf(plan, id);
    const phases = plan.projects.filter(
      (p): p is Extract<PlanProject, { kind: 'highway-truncation' }> =>
        p.kind === 'highway-truncation'
    );
    const sched = schedulePlan(plan);
    const t = (id: string) => sched.times.get(id)!;
    const garagesOf = (id: string) =>
      byId(id).dependsOn.filter((d) => byId(d).kind === 'edge-garage');

    it('the phases are the stub and four more, in the section order', () => {
      expect(phases.map((p) => p.id)).toEqual(PHASES);
    });

    it('each phase removes exactly its catalog segment and frees exactly its catalog parcels', () => {
      for (const p of phases) {
        const seg = segmentOf(p.id);
        expect(p.segments, p.id).toEqual([{ cnn: seg.cnn }]);
        expect(p.freewayLand?.parcels, p.id).toEqual([...seg.parcels].sort());
        expect(p.freewayLand?.excluded, p.id).toEqual(seg.excluded);
      }
      expect(segmentOf('i80-rincon').cnn).toHaveLength(24);
      expect(segmentOf('i80-rincon').cnn).toEqual(expect.arrayContaining(['19374000', '19383000']));
    });

    it('the phases start on the approved dates and the last build completes mid-2048', () => {
      expect(phases.map((p) => [p.id, p.startYear])).toEqual([
        ['central-freeway-stub', 2033],
        ['us101-interchange', 2037],
        ['us101-james-lick', 2040],
        ['us101-bayshore', 2043],
        ['i80-rincon', 2038]
      ]);
      const lastBuild = Math.max(...phases.map((p) => t(p.id).build!.completeDay));
      expect(lastBuild).toBe(Date.UTC(2048, 6, 1) / 86400000);
    });

    it('no two phases of one freeway overlap', () => {
      for (const a of phases)
        for (const b of phases) {
          if (a.id >= b.id || segmentOf(a.id).freeway !== segmentOf(b.id).freeway) continue;
          const [ta, tb] = [t(a.id), t(b.id)];
          expect(ta.startDay < tb.openDay && tb.startDay < ta.openDay, `${a.id} ${b.id}`).toBe(
            false
          );
        }
    });

    it('i80-rincon depends on garage-rincon, which opens first; no US-101 phase depends on a garage', () => {
      for (const id of ['central-freeway-stub', ...US101_PHASES])
        expect(garagesOf(id), id).toEqual([]);
      expect(byId('central-freeway-stub').dependsOn).toEqual(['fulton-brt', 'n-judah-priority']);
      expect(byId('i80-rincon').dependsOn).toContain('garage-rincon');
      expect(byId('garage-rincon')).toMatchObject({
        site: { parcel: '3764064' },
        spaces: { value: 1700 }
      });
      expect(segmentOf('i80-rincon').parcels).toContain('3764064');
      for (const p of phases)
        for (const g of garagesOf(p.id)) expect(t(g).openDay).toBeLessThanOrEqual(t(p.id).startDay);
    });

    it('the stub keeps its v1 dates', () => {
      const stub = byId('central-freeway-stub');
      expect(t('central-freeway-stub').startDay).toBe(yearStart(2033));
      expect(stub).toMatchObject({
        startYear: 2033,
        durationMonths: { value: 30 },
        build: { startYear: 2036, durationMonths: { value: 30 } },
        freewayLand: { parcels: ['3502112', '3503002', '3513024', '3513071', '3513074'] }
      });
    });
  });

  it('no string in plan.json carries Markdown markup', () => {
    const strings: { path: string; s: string }[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') strings.push({ path, s: v });
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(JSON.parse(readFileSync(LESSCARS_PLAN_JSON.live, 'utf8')), '');
    expect(strings.length).toBeGreaterThan(0);
    for (const { path, s } of strings) expect(s, path).not.toMatch(MARKDOWN_MARK);
    expect(stripMarkdown('SFCTA, _Geary Case_, `tph` and *x*')).toBe(
      'SFCTA, Geary Case, tph and x'
    );
  });

  it('every new stop lies in San Francisco', () => {
    const newStops = plan.projects.flatMap((p) =>
      p.kind === 'transit-line' ? p.stops.filter((s) => s.lngLat !== null) : []
    );
    expect(newStops).toHaveLength(14);
    for (const s of newStops) {
      const [lng, lat] = s.lngLat!;
      expect(lng, s.id).toBeGreaterThan(-122.53);
      expect(lng, s.id).toBeLessThan(-122.35);
      expect(lat, s.id).toBeGreaterThan(37.7);
      expect(lat, s.id).toBeLessThan(37.84);
    }
  });
});
