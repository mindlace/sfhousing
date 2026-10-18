// The pure core `calibrate` and its report (stage-calibration spec §4.3–§4.10).
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
import { PANEL_FEATURES, type PanelSource, type PanelYearRow } from '../../lib/fzp-cal/panel';
import { REPORT_SECTIONS, aliasGroups, num } from '../../lib/fzp-cal/report';
import { SC_RULE_IDS, type PermitRow } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import { readParcelsBin } from '../../steps/scenario';

const d = isoToDay;
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
    datasetVersion: 'test-0'
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
      'phaseGap'
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
      'calibration.purge.windows'
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

  it('writes the ten report sections in order, with the window and method counts', () => {
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
