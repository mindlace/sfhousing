// The pure core `calibrate` and its report (stage-calibration spec §4.3–§4.10).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FILL_LEVELS, type ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { parseCalibration } from '../../../src/lib/timelapse/model';
import type { InFlightProject } from '../../../src/lib/timelapse/projects';
import {
  PATHWAYS,
  pathwayStages,
  type Day,
  type Pathway,
  type ProjectHistory,
  type Stage
} from '../../../src/lib/timelapse/types';
import {
  calibrate,
  fzpApplication,
  type CalInput,
  type CalOutput
} from '../../lib/fzp-cal/calibrate';
import { FIXTURE_CAL } from '../../lib/fzp-cal/config';
import { marketModel, type MarketInput } from '../../lib/fzp-cal/market';
import { logistic } from '../../lib/fzp-cal/irls';
import { datasf } from '../../lib/fzp-cal/provenance';
import { parseMarketFile } from '../../enrichment/market-schema';
import { parseFundingFile } from '../../enrichment/funding-schema';
import { MOHCD_RAW } from '../fixtures/mini/projects-raw';
import { PANEL_FEATURES, type PanelSource, type PanelYearRow } from '../../lib/fzp-cal/panel';
import { REPORT_SECTIONS, aliasGroups, marketSection, num } from '../../lib/fzp-cal/report';
import { SC_RULE_IDS, type PermitRow } from '../../lib/fzp-cal/types';
import { purgeCensor } from '../../lib/fzp-cal/purge';
import { buildSpells, normalise, qualifies } from '../../lib/fzp-cal/spells';
import { isoToDay } from '../../project-records/multiphase';
import { readParcelsBin } from '../../steps/scenario';

const d = isoToDay;
const MARKET_JSON_PATH = join(import.meta.dirname, '../../enrichment/market.json');
const marketFile = parseMarketFile(
  JSON.parse(readFileSync(MARKET_JSON_PATH, 'utf8')),
  'market.json'
);
const FUNDING_JSON_PATH = join(import.meta.dirname, '../fixtures/mini/enrichment/funding.json');
const fundingFile = parseFundingFile(
  JSON.parse(readFileSync(FUNDING_JSON_PATH, 'utf8')),
  FUNDING_JSON_PATH
);
const AS_OF = d('2026-06-30');
const FIXTURE_BIN = join(
  import.meta.dirname,
  '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/parcels.bin'
);

/** Days between successive stages and the end of each synthetic history. */
function synthetic(parcelIds: string[]): ProjectHistory[] {
  const out: ProjectHistory[] = [];
  for (let i = 0; i < 18; i++) {
    const pathway: Pathway = PATHWAYS[i % 3];
    const stages = pathwayStages(pathway).filter((s) => s !== 'preApplication' || i % 4 === 0);
    // How far this history gets: some complete, some exit, some stay open.
    const reach = 1 + (i % stages.length);
    const start = d('2016-01-01') + 97 * i;
    const entered: Partial<Record<Stage, Day>> = {};
    let day = start;
    for (let k = 0; k < reach; k++) {
      entered[stages[k]] = day;
      day += 120 + 31 * ((i + k) % 5);
    }
    const last = stages[reach - 1];
    let end: ProjectHistory['end'];
    if (last === 'complete') end = { kind: 'complete', day: entered.complete! };
    else if (i % 5 === 1) end = { kind: 'exit', stage: last, reason: 'withdrawn', day };
    else end = { kind: 'open', lastObserved: Math.min(day, AS_OF) };
    const first = pathway === 'permitOnly' ? 'permitFiled' : 'filed';
    out.push({
      id: `PRJ:H${String(i).padStart(2, '0')}`,
      pathway,
      parcelIds: [parcelIds[i % parcelIds.length]],
      entered,
      end,
      unitsAt: {
        [first]: 10 + i,
        ...(entered.complete !== undefined ? { complete: 10 + i + (i % 2) } : {})
      },
      existingUnits: i % 3,
      storiesProposed: 4 + (i % 3),
      baseStoriesAtFiling: 4,
      sources: [],
      quality: []
    });
  }
  return out;
}

function permitRows(hs: ProjectHistory[]): PermitRow[] {
  return hs
    .filter((h) => h.entered.permitFiled !== undefined)
    .map((h, k) => ({
      permit_number: `2016${String(k).padStart(8, '0')}`,
      project_id: h.id,
      prj_record_id: null,
      dva_record_id: null,
      prx_case_no: null,
      da: null,
      parcel_ids: [...h.parcelIds],
      proposed_units: 10 + k,
      site_permit: true,
      status: 'issued',
      live: true,
      superseded: false,
      filed_day: h.entered.permitFiled!,
      issued_day: h.entered.permitIssued ?? null,
      construction_day: h.entered.construction ?? null,
      complete_day: h.entered.complete === undefined ? null : h.entered.complete + 20,
      status_day: null
    }));
}

function fakePanel(ids: string[]): PanelSource {
  const sorted = [...ids].sort();
  return {
    years: [2023, 2024, 2025],
    async read(y) {
      return sorted.map((mapblklot, k): PanelYearRow => ({
        mapblklot,
        hostableBase: k % 4 !== 3,
        imputed: k === 0 ? 1 : 0,
        features: Object.fromEntries(
          PANEL_FEATURES.map((f) => [f, f === 'landUseClass' ? k % 2 : (k + y) % 7])
        ) as PanelYearRow['features']
      }));
    }
  };
}

let parcels: ScenarioParcels;
let input: CalInput;
let a: CalOutput;
let b: CalOutput;

beforeAll(async () => {
  parcels = readParcelsBin(FIXTURE_BIN);
  const histories = synthetic(parcels.id.slice(0, 6));
  const inFlight = [
    { id: 'PRJ:H01', pathway: 'streamlined', stage: 'filed', parcelIds: [parcels.id[0]] }
  ] as unknown as InFlightProject[];
  input = {
    asOf: AS_OF,
    histories,
    permits: permitRows(histories),
    panel: fakePanel(parcels.id.slice(0, 8)),
    parcels,
    inFlight,
    fillLevels: FILL_LEVELS,
    datasetVersion: 'test-0',
    market: { file: marketFile, path: 'market.json' },
    funding: fundingFile,
    mohcd: MOHCD_RAW
  };
  a = await calibrate(input, FIXTURE_CAL);
  b = await calibrate(input, FIXTURE_CAL);
});

describe('calibrate', () => {
  it('passes parseCalibration with keys in T4 order and no whitespace', () => {
    expect(parseCalibration(JSON.parse(a.json))).toEqual(a.calibration);
    expect(Object.keys(a.calibration)).toEqual([
      'schema',
      'asOf',
      'transitions',
      'initiation',
      'pathwayForNew',
      'ppaShare',
      'size',
      'revision',
      'streamlinedForLocalProgram',
      'phaseGap',
      'market',
      'affordableRoutes',
      'baselineFunding'
    ]);
    expect(a.json).toBe(JSON.stringify(JSON.parse(a.json)));
    // No whitespace between tokens: none outside string literals.
    expect(a.json.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\s/);
    expect(Object.keys(a.calibration.transitions)).toEqual([...PATHWAYS]);
    for (const p of PATHWAYS) {
      expect(Object.keys(a.calibration.transitions[p])).toEqual(
        pathwayStages(p).filter((s) => s !== 'complete')
      );
    }
    expect(a.calibration.asOf).toBe(AS_OF);
  });

  it('emits the fixture market after phaseGap, today in F2 order', () => {
    const today = a.calibration.market!.today;
    expect(Object.keys(today)).toEqual([
      'all',
      'private',
      'years',
      'observed',
      'implied',
      'provenance'
    ]);
    expect(today.all).toBe(-0.693147);
    expect(today.private).toBe(-0.798508);
    expect(today.observed).toEqual({ all: 10, private: 9 });
    expect(today.implied).toBe(20);
    expect(today.years).toEqual([2023, 2025]);
    expect(today.provenance.tier).toBe(4);
    expect(Object.keys(a.calibration.market!)).toEqual(['today', 'crossCheck', 'slope']);
  });

  it('is deterministic: two calls give identical json, report, counts and tallies', () => {
    expect(b.json).toBe(a.json);
    expect(b.reportMd).toBe(a.reportMd);
    expect(b.counts).toEqual(a.counts);
    expect(b.tallies).toEqual(a.tallies);
  });

  it('counts every calibration.* key and nothing else', () => {
    const want = [
      'calibration.histories',
      'calibration.qualifying',
      'calibration.pathwayNull',
      'calibration.window.preRoll',
      'calibration.method.permitOnlyPre2015',
      'calibration.method.ppaPooled',
      'calibration.method.sizeOverEnvelope',
      'calibration.rung3',
      'calibration.noFcd.flaggedPooled',
      'calibration.panel.parcelYears',
      'calibration.panel.parcelYearsExcluded',
      'calibration.panel.exposureMonths',
      'calibration.panel.events',
      'calibration.panel.eventsOffPanel',
      'calibration.panel.eventsCovered',
      'calibration.panel.noParcel',
      'calibration.panel.noStart',
      'calibration.panel.noPermit',
      'calibration.panel.outOfRange',
      'calibration.purge.windows',
      'calibration.market.recentStarts',
      'calibration.market.recentPrivate',
      'calibration.market.recentAffordable',
      'calibration.market.recentNoRecord',
      'calibration.market.recentUnknown',
      'calibration.market.weightStarts',
      'calibration.market.unbinnedHomes',
      'calibration.market.unbinnedStories',
      'calibration.affordable.histories',
      'calibration.affordable.fallback',
      'calibration.funding.mohcdRows',
      'calibration.funding.impliedHomesPerYear',
      'calibration.funding.observedHomesPerYear',
      'calibration.siteChoice.affordableOnPanel',
      'calibration.siteChoice.privateOnPanel'
    ];
    for (const k of want) expect(a.counts, k).toHaveProperty(k);
    for (const p of PATHWAYS) {
      for (const s of pathwayStages(p)) {
        if (s === 'complete' || s === 'preApplication') continue;
        expect(a.counts, `${p}.${s}`).toHaveProperty(`calibration.spells.${p}.${s}`);
      }
    }
    expect(a.counts).toHaveProperty('calibration.spells.pooled.preApplication');
    for (const k of Object.keys(a.counts)) {
      expect(k.startsWith('calibration.'), k).toBe(true);
      expect(k, k).not.toMatch(/^calibration\.(adjust|purge\.censored|bytes)/);
    }
    expect(a.counts['calibration.histories']).toBe(18);
    expect(a.counts['calibration.qualifying']).toBe(18);
    expect(Object.keys(a.tallies)).toEqual([...SC_RULE_IDS]);
  });

  it('writes the thirteen report sections in order, with the window and method counts', () => {
    expect(REPORT_SECTIONS).toHaveLength(13);
    expect(REPORT_SECTIONS.slice(-2)).toEqual([
      '## 12. Publicly funded housing: routes, stages and baseline funding',
      '## 13. Where publicly funded housing starts'
    ]);
    const lines = a.reportMd.split('\n');
    expect(lines[0]).toBe('# Calibration report: test-0');
    const at = REPORT_SECTIONS.map((h) => lines.findIndex((l) => l === h || l.startsWith(`${h}:`)));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(lines.filter((l) => /^#{1,2} /.test(l))).toHaveLength(REPORT_SECTIONS.length);
    expect(a.reportMd).toContain('calibration.window.preRoll');
    expect(a.reportMd).toContain('calibration.method.permitOnlyPre2015');
    for (const id of SC_RULE_IDS) expect(a.reportMd).toContain(id);
    expect(a.reportMd).not.toMatch(/Infinity|NaN|\bnull\b|undefined/);
    // Mask shares for bits 0..6 and the parameter index.
    expect(a.reportMd).toMatch(/\| 6 \| [0-9.e-]+ \| [0-9.e-]+ \|/);
    expect(a.reportMd).toContain('transitions.permitOnly.construction.tailProvenance');
    expect(a.reportMd).toContain('Parcel-years excluded by roll year');
    // Section 11 in fixture mode: the Mode line, then the weights and the cross-check only.
    expect(lines).toContain("## 11. Today's market");
    expect(a.reportMd).toContain(
      "Mode: fixture (today's levels fixed at ln 0.5 and ln 0.45 from 10 and 9 observed against 20 implied; tier 4)"
    );
    expect(a.reportMd).toContain('typicalUncoveredShare');
    const s11 = a.reportMd.slice(a.reportMd.indexOf("## 11. Today's market"));
    expect(s11).not.toContain('Reproduction check');
    expect(s11).not.toContain('Hold-out');
    // Section 8 lists the four market provenances.
    for (const path of [
      'market.today.provenance',
      'market.crossCheck.provenance',
      'market.slope.provenance',
      'market.slope.crossChecks.provenance'
    ]) {
      expect(a.reportMd).toMatch(
        new RegExp(`\\| ${path.replaceAll('.', '\\.')} \\| 4 \\| fixture:`)
      );
    }
    // C4: the window section lists the partial calendar years (as-of year 2026 is partial).
    expect(a.reportMd).toMatch(
      /Partial calendar years[^\n]*\n\n\| stage \| year \| to \| entries \|[\s\S]*\| 2026 \| 2026-06-30 \|/
    );
  });

  it('the FZP application takes T11 FZP features and skips in-flight parcels', () => {
    const app = fzpApplication(parcels, input.inFlight);
    const hostable = [...parcels.hostable.keys()].filter((i) => parcels.hostable[i] === 1);
    expect(app.hostable).toEqual(hostable.filter((i) => parcels.id[i] !== parcels.id[0]));
    const i = hostable[0];
    expect(app.features(i).potentialRatio).toBe(parcels.potentialRatio.fzp[i]);
    expect(app.features(i).storiesGap).toBe(parcels.storiesGap.fzp[i]);
    expect(app.features(i).lotAreaM2).toBe(parcels.lotAreaM2[i]);
  });
});

const FILL_TIER_SENTENCE =
  "Grants fill a project's uncovered cost in three tiers: federal, then state, then the City's pools in proportion to their shares; with the whole baseline and nothing added, every grant pays its full share.";
const SITE_SENTENCE =
  'A ratio near 1 means funded projects started on lots like those private projects chose (the draw of F9 (d)); well above 1 means they took the likeliest lots; well below 1, lots private projects pass over. No San Francisco estimate of displacement exists.';

/** The report section that starts at `heading`, up to the next `## ` heading. */
function section(md: string, heading: string): string {
  const at = md.indexOf(`\n${heading}\n`);
  if (at < 0) throw new Error(`no section ${heading}`);
  const next = md.indexOf('\n## ', at + heading.length + 1);
  return md.slice(at + 1, next < 0 ? undefined : next);
}

describe('publicly funded housing (finance-data spec 4.4, 4.6-4.9)', () => {
  it('emits affordableRoutes as the tier 4 fallback with pathwayForNew shares', () => {
    const r = a.calibration.affordableRoutes!;
    const f = a.calibration.pathwayForNew;
    expect(r.provenance.tier).toBe(4);
    expect([r.discretionary, r.streamlined, r.permitOnly]).toEqual([
      f.discretionary,
      f.streamlined,
      f.permitOnly
    ]);
    expect(a.counts['calibration.affordable.fallback']).toBe(1);
    expect(a.counts['calibration.affordable.histories']).toBe(0);
  });

  it('emits the fixture baseline funding: minHomes 2, every provenance tier 4', () => {
    const bf = a.calibration.baselineFunding!;
    expect(bf.programmes.every((p) => p.minHomes === 2)).toBe(true);
    expect(bf.provenance.every((p) => p.tier === 4)).toBe(true);
    expect(bf.check.provenance.tier).toBe(4);
    expect(a.counts['calibration.funding.mohcdRows']).toBe(2);
    expect(a.counts['calibration.funding.impliedHomesPerYear']).toBe(20);
    expect(a.counts['calibration.funding.observedHomesPerYear']).toBe(25);
  });

  it('tallies the undeclared MOHCD homes', () => {
    expect(a.tallies['sc.funding.ami-undeclared']).toMatchObject({ fired: 1, of: 8 });
  });

  it('warns of the routes fallback on a live profile only, once', async () => {
    expect(a.warnings.filter((w) => w.startsWith('affordableRoutes:'))).toEqual([]);
    const live = await calibrate(input, { ...FIXTURE_CAL, name: 'live' });
    expect(live.warnings.filter((w) => w.startsWith('affordableRoutes:'))).toEqual([
      'affordableRoutes: only 0 100% affordable histories (fewer than 30); the pathway mix of all new projects is used, labelled tier 4'
    ]);
    expect(live.reportMd).toContain('affordableRoutes: only 0 100% affordable histories');
  });

  it('writes sections 12 and 13 after section 11', () => {
    const md = a.reportMd;
    const s11 = md.indexOf("\n## 11. Today's market\n");
    const s12 = md.indexOf(
      '\n## 12. Publicly funded housing: routes, stages and baseline funding\n'
    );
    const s13 = md.indexOf('\n## 13. Where publicly funded housing starts\n');
    expect(s11).toBeGreaterThan(0);
    expect(s12).toBeGreaterThan(s11);
    expect(s13).toBeGreaterThan(s12);
    const twelve = section(
      md,
      '## 12. Publicly funded housing: routes, stages and baseline funding'
    );
    expect(twelve).toContain(FILL_TIER_SENTENCE);
    expect(twelve).toContain('ami_undeclared');
    expect(twelve).toContain('minHomes');
    expect(twelve).toContain('fallback');
    expect(twelve).toContain('| 1, federal | baseline-federal-tax-credits |');
    expect(twelve).toContain('| 2, state | baseline-state |');
    expect(twelve).toContain('| 3, City | baseline-city-debt |');
    expect(twelve).toContain('uncapped');
    const thirteen = section(md, '## 13. Where publicly funded housing starts');
    expect(thirteen).toContain(SITE_SENTENCE);
    expect(md).not.toMatch(/Infinity|NaN|\bnull\b|undefined/);
  });

  it('indexes the new provenances in section 8', () => {
    const n = a.calibration.baselineFunding!.provenance.length;
    expect(a.reportMd).toMatch(/\| affordableRoutes\.provenance \| 4 \|/);
    for (let i = 0; i < n; i++) {
      expect(a.reportMd).toContain(`| baselineFunding.provenance[${i}] | 4 |`);
    }
    expect(a.reportMd).toContain('| baselineFunding.check.provenance | 4 |');
  });

  it('joins the stage table on the calibration spells by history id, split-part ids included', async () => {
    const id = 'PRJ:1:BP:A';
    // PRJ:H02: permit-only, through permitFiled, permitIssued and construction.
    const histories = input.histories.map((h, i) =>
      i === 2 ? { ...h, id, planningProposed: { units: 12, affordable: 12 } } : h
    );
    const out = await calibrate({ ...input, histories }, FIXTURE_CAL);
    expect(out.counts['calibration.affordable.histories']).toBe(1);
    // The spells calibrate fits on, rebuilt here: the cohort's are those of `id`.
    const q = histories.filter(qualifies).sort((x, y) => (x.id < y.id ? -1 : 1));
    const p = purgeCensor(normalise(q, AS_OF).norm, FIXTURE_CAL);
    const { spells } = buildSpells(p.norm, AS_OF);
    const mine = spells.filter((s) => s.projectId === id && s.stage !== 'preApplication');
    expect(mine.length).toBeGreaterThan(0);
    const twelve = section(
      out.reportMd,
      '## 12. Publicly funded housing: routes, stages and baseline funding'
    );
    const rows = twelve
      .split('\n')
      .filter((l) =>
        /^\| (filed|entitled|permitFiled|permitIssued|construction) \| 100% affordable \|/.test(l)
      );
    expect(rows).toHaveLength(5);
    const total = rows.reduce((acc, l) => acc + Number(l.split(' | ')[2]), 0);
    expect(total).toBe(mine.length);
  });
});

/** A permit-only history through every stage from `start` (post-2015 unless told otherwise). */
function permitOnlyHistory(id: string, start: Day, complete: boolean): ProjectHistory {
  const stages = pathwayStages('permitOnly').filter((s) => s !== 'preApplication');
  const entered: Partial<Record<Stage, Day>> = {};
  const reach = complete ? stages.length : 2;
  for (let k = 0; k < reach; k++) entered[stages[k]] = start + 90 * k;
  return {
    id,
    pathway: 'permitOnly',
    parcelIds: [],
    entered,
    end: complete
      ? { kind: 'complete', day: entered.complete! }
      : { kind: 'open', lastObserved: start + 90 },
    unitsAt: { permitFiled: 12, ...(complete ? { complete: 12 } : {}) },
    existingUnits: 0,
    storiesProposed: 4,
    baseStoriesAtFiling: 4,
    sources: [],
    quality: []
  };
}

async function runWith(extra: ProjectHistory[], completeDayOf?: (h: ProjectHistory) => number) {
  const histories = [...input.histories, ...extra].sort((x, y) => (x.id < y.id ? -1 : 1));
  const permits = permitRows(histories).map((r) => {
    const h = extra.find((e) => e.id === r.project_id);
    return h && completeDayOf ? { ...r, complete_day: completeDayOf(h) } : r;
  });
  return calibrate({ ...input, histories, permits }, FIXTURE_CAL);
}

const tcoCounts = (md: string): { differ: number; of: number; median: string } => {
  const m = md.match(
    /Over (\d+) completed histories[^\n]*?(\d+) of them have a completion day different from[^\n]*?paired median[^\n]*? = (-?[\d.]+|none) days/
  );
  if (!m) throw new Error('no TCO diagnostic line');
  return { of: Number(m[1]), differ: Number(m[2]), median: m[3] };
};

describe('report diagnostics and counts (Task 16b)', () => {
  it('TCO diagnostic counts histories whose completion differs from the permit and pairs them', async () => {
    const base = tcoCounts(a.reportMd);
    expect(base.differ).toBeGreaterThan(0);
    expect(base.differ).toBe(base.of);
    // permit rows are the completion day plus 20: the paired median is -20 days
    expect(base.median).toBe('-20');
    // a completed history whose permit complete_day equals its completion is not counted
    const same = permitOnlyHistory('PRJ:Z01', d('2019-01-01'), true);
    const withSame = await runWith([same], (h) => h.entered.complete!);
    const t = tcoCounts(withSame.reportMd);
    expect(t.of).toBe(base.of + 1);
    expect(t.differ).toBe(base.differ);
    expect(t.median).toBe('-20');
    // the subset is empty: "none"
    const only = [permitOnlyHistory('PRJ:Z02', d('2019-02-01'), true)];
    const alone = await calibrate(
      {
        ...input,
        histories: only,
        permits: permitRows(only).map((r) => ({
          ...r,
          complete_day: only[0].entered.complete!
        }))
      },
      FIXTURE_CAL
    );
    expect(tcoCounts(alone.reportMd)).toEqual({ of: 1, differ: 0, median: 'none' });
  });

  it('pathwayNull counts T4d nulls only, additive with permitOnlyPre2015', async () => {
    expect(a.counts['calibration.pathwayNull']).toBe(0);
    expect(a.counts['calibration.method.permitOnlyPre2015']).toBe(0);
    const nullPathway: ProjectHistory = {
      ...permitOnlyHistory('PRJ:Z03', d('2019-03-01'), false),
      pathway: null,
      unitsAt: { permitFiled: 12 }
    };
    const pre2015 = permitOnlyHistory('PRJ:Z04', d('2012-03-01'), false);
    const out = await runWith([nullPathway, pre2015]);
    expect(out.counts['calibration.pathwayNull']).toBe(1);
    expect(out.counts['calibration.method.permitOnlyPre2015']).toBe(1);
    expect(out.reportMd).toContain('T4d nulls');
  });

  it('shows the unweighted raw column beside the unit-weighted one', () => {
    expect(a.reportMd).toContain('advance (published table)');
    expect(a.reportMd).toContain('advance (raw, unweighted)');
    expect(a.reportMd).toContain('advance (units)');
  });

  it('counts the streamlined spells that end on or after the provenance window start', () => {
    const lp = a.calibration.streamlinedForLocalProgram;
    expect(lp.n).toBeGreaterThan(0);
    expect(lp.window?.[0]).toBe('2015-01-01');
  });
});

describe('report helpers', () => {
  it('num writes non-finite values as "none"', () => {
    expect(num(-Infinity)).toBe('none');
    expect(num(NaN)).toBe('none');
    expect(num(null)).toBe('none');
    expect(num(3)).toBe('3');
    expect(num(1 / 3)).toBe('0.333333');
  });

  it('aliasGroups finds bins of different terms that hold the same design rows', () => {
    const terms = [
      { feature: 'yearBuilt' as const, edges: [0, 1800], map: [0, 1] },
      { feature: 'landUseClass' as const, edges: [0, 4], map: [0, 1] },
      { feature: 'existingUnits' as const, edges: [0, 1], map: [0, 1] }
    ];
    const cells = [
      { bins: [0, 1, 0], basis: 0 as const, exposure: 5, events: 1 },
      { bins: [1, 0, 0], basis: 0 as const, exposure: 5, events: 1 },
      { bins: [1, 0, 1], basis: 1 as const, exposure: 5, events: 1 }
    ];
    expect(aliasGroups(terms, cells)).toEqual([
      ['yearBuilt bin 0 (≥ 0)', 'landUseClass bin 1 (≥ 4)'],
      ['yearBuilt bin 1 (≥ 1800)', 'landUseClass bin 0 (≥ 0)']
    ]);
  });
});

/** A live market input over 2023-2025 (129 starts), with a given hold-out. */
function liveMarket(holdOut: MarketInput['holdOut']) {
  const z = Math.log(1e-4 / (1 - 1e-4));
  const observed = [40, 43, 46];
  const impliedPerYear: Record<number, number> = {};
  const observedPerYear: Record<number, number> = {};
  for (let y = 2007; y <= 2025; y++) {
    impliedPerYear[y] = 100;
    observedPerYear[y] = 7;
  }
  const starts: MarketInput['starts'] = [];
  for (const y of [2021, 2022]) {
    for (let i = 0; i < 7; i++)
      starts.push({ year: y, basis: 0, cohort: 'private', homes: 30, stories: 5 });
  }
  const recentCells: MarketInput['recentCells'] = [];
  observed.forEach((n, i) => {
    const y = 2023 + i;
    impliedPerYear[y] = 1e6 * logistic(z);
    observedPerYear[y] = n;
    recentCells.push({ exposure: 1e6, z });
    for (let k = 0; k < n; k++) {
      starts.push({
        year: y,
        basis: 0,
        cohort: k === 0 ? 'affordable' : 'private',
        homes: 10,
        stories: 4
      });
    }
  });
  return marketModel({
    fixture: false,
    impliedPerYear,
    observedPerYear,
    recentCells,
    holdOut,
    starts,
    enrichment: { file: marketFile, path: 'market.json' },
    initiationSources: [datasf('planningProjects')]
  });
}

describe("report section 11: today's market (live)", () => {
  it('prints the recent-years table, the levels, the checks, the weights and the cross-check', () => {
    const mk = liveMarket({
      fitThrough: 2022,
      rows: [
        { year: 2023, observed: 40, predicted: 120 },
        { year: 2024, observed: 43, predicted: 130 },
        { year: 2025, observed: 46, predicted: 136.399 }
      ],
      observed: 129,
      predicted: 386.399
    });
    const s = marketSection(mk.market, mk.report).join('\n');
    expect(s.startsWith("## 11. Today's market")).toBe(true);
    expect(s).toContain(
      '| year | observed | affordable cohort | private | implied (published hazard) | hold-out predicted |'
    );
    expect(s).toContain('| 2025 | 46 | 1 | 45 | 100 | 136.399 |');
    expect(s).toContain(`today.all = ${mk.market.today.all}`);
    expect(s).toContain('**Reproduction check**');
    expect(s).toContain('against 129 observed');
    expect(s).toContain('**Hold-out, report only**');
    expect(s).toContain('386.399');
    expect(s).toContain('-1.09706');
    expect(s).toContain('(OD-F11)');
    expect(s).toContain('| prototype | rule | private starts 2021-2025 | weight |');
    expect(s).toContain('typicalUncoveredShare');
    expect(s).toContain(`crossCheck.logOdds = ${mk.market.crossCheck.logOdds}`);
    expect(s).not.toContain('Mode: fixture');
    expect(s).not.toMatch(/Infinity|NaN|\bnull\b|undefined/);
    expect(s.split('\n').filter((l) => /^#+ /.test(l))).toEqual(["## 11. Today's market"]);
  });

  it('prints the hold-out error and none for a missing predicted', () => {
    const mk = liveMarket({ error: 'singular' });
    const s = marketSection(mk.market, mk.report).join('\n');
    expect(s).toContain('singular');
    expect(s).toContain('| 2023 | 40 | 1 | 39 | 100 | none |');
    expect(s).toContain('market: the hold-out refit failed: singular');
    expect(s).not.toMatch(/Infinity|NaN|\bnull\b|undefined/);
  });
});
