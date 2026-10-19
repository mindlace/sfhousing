/**
 * The pure core of the stage-calibration step (stage-calibration spec §4.3–§4.10): every
 * estimator in a fixed order, assembled into `calibration.json` in T4 key order, validated by
 * `parseCalibration`, with its report, the seven `sc.*` tallies (recorded by the step through
 * `recordQuality`) and the `calibration.*` counts. No I/O: the step reads the files and the panel.
 */
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { featureValue } from '../../../src/lib/data/scenario-codec';
import { CalibrationFormatError, parseCalibration } from '../../../src/lib/timelapse/model';
import type { InFlightProject } from '../../../src/lib/timelapse/projects';
import type { Calibration, Day, FeatureId, ProjectHistory } from '../../../src/lib/timelapse/types';
import { isoToDay } from '../../project-records/multiphase';
import {
  FZP_BAND,
  INITIAL_EDGES,
  TERM_ORDER,
  backcastGate,
  fitInitiation,
  type FzpApplication
} from './initiation';
import { aggregatePanel, firstFiledDays, initiationEvents, type PanelSource } from './panel';
import {
  localProgramDiagnostic,
  pathwayForNew,
  ppaShare,
  streamlinedForLocalProgram
} from './pathway-mix';
import { phaseGap } from './phase-gap';
import { purgeCensor, purgeCensorTally } from './purge';
import { calibrationReport } from './report';
import { revisionModel } from './revision';
import { sizeModel } from './size';
import {
  buildSpells,
  gapImputeTally,
  noFcdTally,
  normalise,
  preRollCount,
  qualifies,
  windowedIds
} from './spells';
import { fitTransitions } from './transitions';
import { CalibrationError, type CalProfile, type PermitRow, type Tallies } from './types';
import { PLANNING_START } from './window';

export interface CalInput {
  asOf: Day;
  histories: ProjectHistory[];
  permits: PermitRow[];
  panel: PanelSource;
  parcels: ScenarioParcels;
  inFlight: InFlightProject[];
  fillLevels: readonly number[];
  datasetVersion: string;
}

export interface CalOutput {
  calibration: Calibration;
  /** `calibration.json`: `JSON.stringify` with no whitespace */
  json: string;
  /** `calibration-report.md` */
  reportMd: string;
  /** the seven `sc.*` rules' counts, for `recordQuality` */
  tallies: Tallies;
  /** `calibration.*` report counts only (the step adds `calibration.bytes`) */
  counts: Record<string, number>;
  warnings: string[];
  /** V28 as measured (mode-agnostic; the step decides whether it gates) */
  backcast: { ok: boolean; detail: string };
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const sig = (x: number): string => String(Number(x.toPrecision(4)));

/**
 * The FZP application of the initiation model: T11's FZP-variant features, and the hostable
 * parcels that no in-flight project occupies (spec §4.6).
 */
export function fzpApplication(
  parcels: ScenarioParcels,
  inFlight: readonly InFlightProject[]
): FzpApplication {
  const occupied = new Set<string>();
  for (const p of inFlight) for (const id of p.parcelIds) occupied.add(id);
  const hostable: number[] = [];
  for (let i = 0; i < parcels.count; i++) {
    if (parcels.hostable[i] === 1 && !occupied.has(parcels.id[i])) hostable.push(i);
  }
  return {
    features(i) {
      const f = {} as Record<FeatureId, number>;
      for (const id of TERM_ORDER) f[id] = featureValue(parcels, i, id, 'fzp');
      return f;
    },
    hostable
  };
}

/** Runs every estimator (spec §4.4–§4.10) and assembles the outputs. Deterministic. */
export async function calibrate(input: CalInput, cal: CalProfile): Promise<CalOutput> {
  const { asOf, permits, parcels } = input;
  const q = input.histories.filter(qualifies).sort(byId);

  // §4.4 steps 1–4, step 6, spells.
  const n = normalise(q, asOf);
  const p = purgeCensor(n.norm, cal);
  const { spells, unobserved } = buildSpells(p.norm, asOf);
  const purgeWindowed = purgeCensorTally(windowedIds(spells, unobserved), p);

  // §4.5 transition cells.
  const fit = fitTransitions(spells, unobserved, asOf, cal, {
    purge: { windows: p.windows, windowed: purgeWindowed },
    permitOnlyPre2015: n.method.permitOnlyPre2015,
    gapImpute: { ids: n.imputed }
  });

  // §4.6 initiation.
  const firstFiled = firstFiledDays(permits);
  const lotArea = (id: string): number => {
    const i = parcels.index.get(id);
    return i === undefined ? 0 : parcels.lotAreaM2[i];
  };
  const ev = initiationEvents(p.norm, firstFiled, lotArea);
  const panel = await aggregatePanel(input.panel, ev, INITIAL_EDGES);
  const init = fitInitiation(panel, cal, fzpApplication(parcels, input.inFlight), {
    permitOnlyPre2015: n.method.permitOnlyPre2015
  });

  // §4.7, §4.7a, §4.8, §4.9.
  const forNew = pathwayForNew(p.norm, input.inFlight, asOf, cal);
  const ppa = ppaShare(p.norm, asOf);
  const lpDiag = localProgramDiagnostic(p.norm, asOf);
  // The provenance window is [PLANNING_START, asOf]: count the spells that end inside it.
  const planningStart = isoToDay(PLANNING_START);
  const streamlinedSpells = spells.filter(
    (s) => s.pathway === 'streamlined' && s.e + s.x >= planningStart
  ).length;
  const localProgram = streamlinedForLocalProgram(streamlinedSpells, asOf, lpDiag);
  const size = sizeModel(p.norm, asOf, cal, input.fillLevels);
  const rev = revisionModel(p.norm, asOf, cal);
  const gaps = phaseGap(permits, asOf, cal);

  const calibration: Calibration = {
    schema: 1,
    asOf,
    transitions: fit.transitions,
    initiation: init.model,
    pathwayForNew: forNew,
    ppaShare: ppa,
    size: size.size,
    revision: rev.revision,
    streamlinedForLocalProgram: localProgram,
    phaseGap: gaps.phaseGap
  };
  const json = JSON.stringify(calibration);
  try {
    parseCalibration(JSON.parse(json));
  } catch (e) {
    if (e instanceof CalibrationFormatError) {
      throw new CalibrationError(`calibration.json does not parse: ${e.message}`);
    }
    throw e;
  }

  const tallies: Tallies = {
    'sc.stages.gap-impute': gapImputeTally(n.imputed, spells, unobserved),
    'sc.stages.no-fcd-duration': noFcdTally(p.norm, spells, unobserved),
    'sc.stages.running-max': n.tallies['sc.stages.running-max'],
    'sc.exit.last-stage': n.tallies['sc.exit.last-stage'],
    'sc.exit.purge-censor': purgeWindowed,
    'sc.revision.ratio-clamp': rev.clamp,
    'sc.revision.carried-excluded': rev.carried
  };

  const counts: Record<string, number> = {
    'calibration.histories': input.histories.length,
    'calibration.qualifying': q.length,
    'calibration.pathwayNull': q.filter((h) => h.pathway === null).length,
    'calibration.window.preRoll': preRollCount(p.norm),
    'calibration.method.permitOnlyPre2015': n.method.permitOnlyPre2015.fired,
    'calibration.method.ppaPooled': fit.ppaPooled,
    'calibration.method.sizeOverEnvelope': size.overEnvelope.fired,
    'calibration.rung3': fit.rung3,
    'calibration.noFcd.flaggedPooled': fit.noFcdFlaggedPooled,
    'calibration.panel.parcelYears': panel.parcelYears,
    'calibration.panel.parcelYearsExcluded': panel.parcelYearsExcluded,
    'calibration.panel.exposureMonths': panel.exposureMonths,
    'calibration.panel.events': panel.events.record + panel.events.permit,
    'calibration.panel.eventsOffPanel': panel.eventsOffPanel,
    'calibration.panel.eventsCovered': panel.eventsCovered,
    'calibration.panel.noParcel': ev.noParcel,
    'calibration.panel.noStart': ev.noStart,
    'calibration.panel.noPermit': ev.noPermit,
    'calibration.panel.outOfRange': ev.outOfRange,
    'calibration.purge.windows': p.windows.length
  };
  for (const [k, v] of Object.entries(fit.spellsCount)) counts[k] = v;

  const warnings = [...fit.warnings];
  const r = init.report;
  if (r.fzpWarning) {
    const ratio = r.fzpVsHistorical === null ? 'none' : sig(r.fzpVsHistorical);
    warnings.push(
      `initiation: FZP expected filings ${sig(r.fzpPerYear)} per year vs historical mean ${sig(r.historicalMean)} (ratio ${ratio}) outside the [${FZP_BAND[0]}, ${FZP_BAND[1]}] band`
    );
  }
  const backcast = backcastGate(r);

  const reportMd = calibrationReport({
    datasetVersion: input.datasetVersion,
    cal,
    calibration,
    counts,
    tallies,
    norm: p.norm,
    spells,
    permits,
    perStage: n.perStage,
    purge: { tally: p.tally, windows: p.windows, exits: p.exits },
    permitOnlyPre2015: n.method.permitOnlyPre2015,
    sizeOverEnvelope: size.overEnvelope,
    fit,
    initiation: r,
    panel,
    events: ev,
    backcast,
    lpDiag,
    phaseGap: { rung: gaps.rung, groups: gaps.groups },
    warnings
  });

  return { calibration, json, reportMd, tallies, counts, warnings, backcast };
}
