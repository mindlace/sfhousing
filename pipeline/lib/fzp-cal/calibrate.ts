/**
 * The pure core of the stage-calibration step (stage-calibration spec §4.3–§4.10): every
 * estimator in a fixed order, assembled into `calibration.json` in T4 key order, validated by
 * `parseCalibration`, with its report, the eight `sc.*` tallies (recorded by the step through
 * `recordQuality`) and the `calibration.*` counts. No I/O: the step reads the files and the panel.
 * The publicly funded housing (finance-data spec 4.4, 4.6-4.8) follows today's market.
 */
import type { OptionTable } from '../../../src/lib/data/option-table';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import {
  allowedCount,
  choiceCtxOf,
  choiceFeatures,
  type ChoiceCtx
} from '../../../src/lib/sim/choice/choose';
import type { ChoiceModel } from '../../../src/lib/sim/choice/types';
import type { CarModel } from '../../../src/lib/sim/cars';
import { featureValue } from '../../../src/lib/data/scenario-codec';
import { CalibrationFormatError, parseCalibration } from '../../../src/lib/timelapse/model';
import type { InFlightProject } from '../../../src/lib/timelapse/projects';
import type {
  Calibration,
  Day,
  FeatureId,
  ProjectHistory,
  Provenance
} from '../../../src/lib/timelapse/types';
import type { FundingFile } from '../../enrichment/funding-schema';
import type { MarketFile } from '../../enrichment/market-schema';
import { isoOf } from '../../project-records/parse';
import { isoToDay } from '../../project-records/multiphase';
import { recordTargets, type RecordTargets } from '../building-records';
import type { RawRow } from '../../project-records/types';
import { affordableRoutes, fundedStages, routesWarning, siteChoice } from './affordable';
import {
  affordableRule,
  choiceRecords,
  fitChoiceSpread,
  marketRecords,
  measureOverlap,
  atSearchBound,
  affordableRuleMeasurable,
  SPREAD_RANGE,
  type ChoiceSpreadFit
} from './choice-fit';
import { baselineFunding } from './funding';
import {
  FZP_BAND,
  INITIAL_EDGES,
  TERM_ORDER,
  backcastGate,
  fitInitiation,
  type FzpApplication
} from './initiation';
import { marketModel } from './market';
import {
  aggregatePanel,
  firstFiledDays,
  initiationEvents,
  projectTypes,
  withChoiceFeatures,
  type PanelSource
} from './panel';
import {
  localProgramDiagnostic,
  pathwayForNew,
  ppaShare,
  streamlinedForLocalProgram
} from './pathway-mix';
import { phaseGap } from './phase-gap';
import { purgeCensor, purgeCensorTally } from './purge';
import { calibrationReport } from './report';
import { datasf } from './provenance';
import { revisionModel } from './revision';
import { shippedStep } from './shipped-step';
import { ERA_COST_PROVENANCE, ERA_VALUE_INDEX, eraPrices, eraRatios } from './era-market';
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
  /** scenarios/fzp/options.bin: one row per parcels.bin row (the FZP application's choice). */
  options: OptionTable;
  /** `<derivedDir>`/panel-options.bin: one row per panel key (`scenario_panel.option_row`). */
  panelOptions: OptionTable;
  /** The location value's provenance (locationValueByLot). */
  locationValue: Provenance;
  datasetVersion: string;
  /** the parsed `pipeline/enrichment/market.json` and its path (for error messages) */
  market: { file: MarketFile; path: string };
  /** the parsed `pipeline/enrichment/funding.json` (or the mini fixture's) */
  funding: FundingFile;
  /** the locked `datasf-mohcd-pipeline` rows, as read (finance-data spec 4.1 "Reading") */
  mohcd: RawRow[];
  /** The locked DGS CCCI's yearly means (`readCostIndex`): the choice fit's cost by year. */
  costIndex: Record<number, number>;
  /**
   * The car step's output: the model (written as `cars`, after `baselineFunding`) and the report
   * lines of section 14. Absent, or no lines, means no car data: no `cars` and no section 14.
   */
  cars?: { model: CarModel | null; report: string[]; backcast?: string[] };
}

export interface CalOutput {
  calibration: Calibration;
  /** `calibration.json`: `JSON.stringify` with no whitespace */
  json: string;
  /** `calibration-report.md` */
  reportMd: string;
  /** the eight `sc.*` rules' counts, for `recordQuality` */
  tallies: Tallies;
  /** `calibration.*` report counts only (the step adds `calibration.bytes`) */
  counts: Record<string, number>;
  warnings: string[];
  /** V28 as measured (mode-agnostic; the step decides whether it gates) */
  backcast: { ok: boolean; detail: string };
  /** The record check's targets (building-records.ts), written by the step beside the report. */
  targets: RecordTargets;
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const sig = (x: number): string => String(Number(x.toPrecision(4)));

const NULL_CAP = 0xffff;

/**
 * The FZP application of the initiation model: T11's FZP-variant features, with potentialRatio,
 * storiesGap and choiceMargin from the choice among the row's options allowed at its envelope
 * (building-choice spec, "Start odds refit"), and the hostable parcels that no in-flight project
 * occupies (spec §4.6). The cap is parcels.bin's `fzpCap` (none on Local Program parcels, the
 * cap on the build's snapshot day elsewhere).
 */
export function fzpApplication(
  parcels: ScenarioParcels,
  inFlight: readonly InFlightProject[],
  choice: ChoiceCtx
): FzpApplication {
  if (choice.t.count !== parcels.count) {
    throw new CalibrationError(
      `options.bin has ${choice.t.count} rows, parcels.bin ${parcels.count}`
    );
  }
  const occupied = new Set<string>();
  for (const p of inFlight) for (const id of p.parcelIds) occupied.add(id);
  const hostable: number[] = [];
  for (let i = 0; i < parcels.count; i++) {
    if (parcels.hostable[i] === 1 && !occupied.has(parcels.id[i])) hostable.push(i);
  }
  return {
    features(i) {
      const f = {} as Record<FeatureId, number>;
      const cap = parcels.fzpCap[i] === NULL_CAP ? null : parcels.fzpCap[i];
      const n = allowedCount(choice.t, i, parcels.envelopeStories[i]);
      const c = choiceFeatures(
        choice,
        0,
        i,
        n,
        cap,
        parcels.existingUnits[i],
        parcels.existingStories[i]
      );
      for (const id of TERM_ORDER) {
        f[id] =
          id === 'potentialRatio' || id === 'storiesGap' || id === 'choiceMargin'
            ? c[id]
            : featureValue(parcels, i, id, c);
      }
      return f;
    },
    hostable
  };
}

/**
 * The build warning for a spread fit that sits at a search bound (the shipped value is then the
 * invented bound), or null.
 */
export function choiceSpreadWarning(spread: ChoiceSpreadFit, cal: CalProfile): string | null {
  if (spread.n < cal.sizeMinN || !atSearchBound(spread)) return null;
  return (
    `choice: choiceSpread ${g(spread.choiceSpread)} sits at the search bound of [${SPREAD_RANGE.join(', ')}] ` +
    `over ${spread.n} records: the records do not identify it; shipped as tier 4 (invented)`
  );
}

/** The spread a fit with too few records takes (tier 4, invented). */
export const FALLBACK_CHOICE_SPREAD = 1;

const g = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : 'none');

/**
 * `calibration.choice`: the shipped price step from `asOf`, the fitted (or, under SIZE_MIN_N
 * records, the invented) spread and the affordable rule, each with its provenance.
 */
export function choiceModelOf(
  step: ReturnType<typeof shippedStep>,
  spread: ChoiceSpreadFit,
  aff: ReturnType<typeof affordableRule>,
  cohort: RecordTargets['cohort'],
  locationValue: Provenance,
  cal: CalProfile,
  asOf: Day,
  o: { affordableLeftOut?: number } = {}
): ChoiceModel {
  const window: [string, string] = [PLANNING_START, isoOf(asOf)];
  const sources = [
    datasf('planningProjects'),
    datasf('permits'),
    ...ERA_VALUE_INDEX.provenance.sources,
    ...ERA_COST_PROVENANCE.sources
  ];
  const fitted = spread.n >= cal.sizeMinN && Number.isFinite(spread.choiceSpread);
  const bound = fitted && atSearchBound(spread);
  const records =
    `${spread.n} histories first recorded ${window[0]} to ${window[1]} with proposed and base ` +
    `stories at filing of at least 1 on a panel row; ${spread.excludedOver} over their limit ` +
    `left out (sizeOverEnvelope), ${spread.noOption} with no option gaining a home left out, ` +
    `${o.affordableLeftOut ?? 0} in the affordable cohort left out (they choose by rule A)`;
  const method =
    `maximum likelihood of each record's built stories under the market choice among its ` +
    `lot's options allowed at its base stories at filing (choose.ts choiceRow), each record ` +
    `priced at the market of the year it was first recorded: the shipped step's value per home ` +
    `times the FHFA San Francisco County house price index and its cost per home times the ` +
    `DGS California Construction Cost Index, each relative to ${isoOf(asOf).slice(0, 4)} (an ` +
    `index held at its last year past it; era-market.ts); golden-section on ln choiceSpread in ` +
    `[${SPREAD_RANGE.join(', ')}]; ${records}; ` +
    `log-likelihood ${g(spread.logLik)}; ` +
    "locationValue is today's for every record (the panel options carry no past value), " +
    "an index against each roll year's median, so it assumes neighbourhoods kept their rank";
  const choiceSpread: Provenance = bound
    ? {
        tier: 4,
        label: 'Choice spread: invented (fit at search bound)',
        sources,
        method:
          `the likelihood is highest at the search bound ${g(spread.choiceSpread)}, an invented ` +
          `limit, so the records do not identify the spread and the bound is shipped; ${method}`,
        n: spread.n,
        window
      }
    : fitted
      ? {
          tier: 2,
          label: `SF Planning & permit records ${window[0].slice(0, 4)}–${window[1].slice(0, 4)}: choice spread (tier 2)`,
          sources,
          method,
          n: spread.n,
          window
        }
      : {
          tier: 4,
          label: 'Choice spread: invented, too few records to fit',
          sources,
          method: `invented value ${FALLBACK_CHOICE_SPREAD}: only ${spread.n} records (fewer than SIZE_MIN_N = ${cal.sizeMinN}); ${records}`,
          n: spread.n,
          window
        };
  const known = affordableRuleMeasurable(aff);
  const affordable: Provenance = known
    ? {
        tier: 2,
        label: `Affordable projects' choice rule from the records: ${aff.rule} (tier 2)`,
        sources,
        method:
          `built height ÷ limit, affordable mean ${g(cohort.affordable.mean)} (n = ` +
          `${cohort.affordable.n}) minus private mean ${g(cohort.private.mean)} (n = ` +
          `${cohort.private.n}) = ${g(aff.diff)}, SE of the difference ${g(aff.se)}; ` +
          `'most-homes' (rule A) exactly when the difference exceeds 2 SE, else 'market' ` +
          '(owner decision, spec)',
        n: cohort.affordable.n + cohort.private.n
      }
    : {
        tier: 4,
        label: "Affordable projects' choice rule: market, invented default without cohort records",
        sources,
        method: `no cohort difference measurable (diff ${g(aff.diff)}, SE ${g(aff.se)}): the market rule`
      };
  return {
    prices: [{ from: asOf, value: step.prices }],
    choiceSpread: fitted ? spread.choiceSpread : FALLBACK_CHOICE_SPREAD,
    affordableRule: aff.rule,
    provenance: {
      anchors: step.provenance.anchors,
      aboveTopCostRatio: step.aboveTop.provenance,
      carrying: step.provenance.carrying,
      choiceSpread,
      affordableRule: affordable,
      locationValue
    }
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

  // The developer's choice (building-choice spec): the shipped step, the spread fitted on the
  // records, the affordable rule from the cohort check. The panel's start features come from it.
  const firstFiled = firstFiledDays(permits);
  const lotArea = (id: string): number => {
    const i = parcels.index.get(id);
    return i === undefined ? 0 : parcels.lotAreaM2[i];
  };
  const step = shippedStep({ histories: input.histories, permits, asOf, cal });
  // The affordable rule comes first: under 'most-homes' affordable records leave the market fit.
  const targets = recordTargets(input.histories, permits, parcels, asOf);
  const aff = affordableRule(targets.cohort);
  const recs = await choiceRecords(p.norm, input.panel, input.panelOptions, lotArea, asOf);
  const market = marketRecords(recs.records, aff.rule);
  // Each record at its own year's market (era-market.ts): the shipped step scaled by value and
  // cost indices relative to asOf's year. The shipped simulation keeps the one shipped step.
  const shipYear = Number(isoOf(asOf).slice(0, 4));
  const spread = fitChoiceSpread(
    market.records,
    step.prices,
    step.heightTime.steps[0].value,
    step.heightTime.upTo,
    (year) => eraPrices(step.prices, eraRatios(year, shipYear, input.costIndex))
  );
  const choice = choiceModelOf(step, spread, aff, targets.cohort, input.locationValue, cal, asOf, {
    affordableLeftOut: market.affordable
  });
  const heightTime = step.heightTime;
  const panelCtx = choiceCtxOf(input.panelOptions, choice, heightTime);
  const filled = withChoiceFeatures(input.panel, panelCtx);

  // §4.6 initiation.
  const ev = initiationEvents(p.norm, firstFiled, lotArea, projectTypes(permits));
  const panel = await aggregatePanel(filled, ev, INITIAL_EDGES);
  const fzpCtx = choiceCtxOf(input.options, choice, heightTime);
  const init = fitInitiation(panel, cal, fzpApplication(parcels, input.inFlight, fzpCtx), {
    permitOnlyPre2015: n.method.permitOnlyPre2015
  });
  const marginVsSlope = await measureOverlap(filled, panelCtx);
  // Today's market (market-baseline spec §4.6), from the initiation report and the panel starts.
  const r = init.report;
  const mk = marketModel({
    fixture: cal.fixtureInitiation,
    impliedPerYear: r.impliedPerYear,
    observedPerYear: r.observedPerYear,
    recentCells: r.recentCells,
    holdOut: r.holdOut,
    starts: panel.starts,
    aboveTopCostRatio: step.prices.aboveTopCostRatio,
    enrichment: input.market,
    initiationSources: init.model.provenance.sources
  });

  // §4.7, §4.7a, §4.8, §4.9.
  const forNew = pathwayForNew(p.norm, input.inFlight, asOf, cal);
  // Publicly funded housing (finance-data spec 4.4, 4.6-4.8). The stage table reads the spells
  // the transition tables are fitted on, joined on the history id (`Spell.projectId`).
  const ar = affordableRoutes(p.norm, forNew, asOf);
  const bf = baselineFunding(input.funding, input.mohcd, asOf, cal);
  const sites = await siteChoice(filled, init.model, p.norm, lotArea);
  const stages = fundedStages(p.norm, spells, asOf);
  const ppa = ppaShare(p.norm, asOf);
  const lpDiag = localProgramDiagnostic(p.norm, asOf);
  // The provenance window is [PLANNING_START, asOf]: count the spells that end inside it.
  const planningStart = isoToDay(PLANNING_START);
  const streamlinedSpells = spells.filter(
    (s) => s.pathway === 'streamlined' && s.e + s.x >= planningStart
  ).length;
  const localProgram = streamlinedForLocalProgram(streamlinedSpells, asOf, lpDiag);
  const rev = revisionModel(p.norm, asOf, cal);
  const gaps = phaseGap(permits, asOf, cal);

  const calibration: Calibration = {
    schema: 1,
    asOf,
    transitions: fit.transitions,
    initiation: init.model,
    pathwayForNew: forNew,
    ppaShare: ppa,
    revision: rev.revision,
    streamlinedForLocalProgram: localProgram,
    phaseGap: gaps.phaseGap,
    market: mk.market,
    affordableRoutes: ar.routes,
    baselineFunding: bf.baselineFunding,
    ...(input.cars?.model ? { cars: input.cars.model } : {}),
    choice,
    heightTime
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
    'sc.revision.carried-excluded': rev.carried,
    'sc.funding.ami-undeclared': bf.tally
  };

  const counts: Record<string, number> = {
    'calibration.histories': input.histories.length,
    'calibration.qualifying': q.length,
    'calibration.pathwayNull': q.filter((h) => h.pathway === null).length,
    'calibration.window.preRoll': preRollCount(p.norm),
    'calibration.method.permitOnlyPre2015': n.method.permitOnlyPre2015.fired,
    'calibration.method.ppaPooled': fit.ppaPooled,
    'calibration.method.sizeOverEnvelope': spread.excludedOver,
    'calibration.choice.records': spread.n,
    'calibration.choice.excludedOver': spread.excludedOver,
    'calibration.choice.noOption': spread.noOption,
    'calibration.choice.noPanelRow': recs.noPanelRow,
    'calibration.choice.affordableLeftOut': market.affordable,
    'calibration.choice.mostHomes': choice.affordableRule === 'most-homes' ? 1 : 0,
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
    'calibration.purge.windows': p.windows.length,
    'calibration.affordable.histories': ar.n,
    'calibration.affordable.fallback': ar.fallback ? 1 : 0,
    'calibration.funding.mohcdRows': bf.report.mix.used,
    'calibration.funding.impliedHomesPerYear': bf.report.check.impliedHomesPerYear,
    'calibration.funding.observedHomesPerYear': bf.report.check.observedHomesPerYear,
    'calibration.siteChoice.affordableOnPanel': sites.affordable.onPanel,
    'calibration.siteChoice.privateOnPanel': sites.private.onPanel
  };
  for (const [k, v] of Object.entries(fit.spellsCount)) counts[k] = v;
  for (const [k, v] of Object.entries(mk.report.counts)) counts[k] = v;

  const warnings = [...fit.warnings];
  if (r.fzpWarning) {
    const ratio = r.fzpVsHistorical === null ? 'none' : sig(r.fzpVsHistorical);
    warnings.push(
      `initiation: FZP expected filings ${sig(r.fzpPerYear)} per year vs historical mean ${sig(r.historicalMean)} (ratio ${ratio}) outside the [${FZP_BAND[0]}, ${FZP_BAND[1]}] band`
    );
  }
  warnings.push(...mk.report.warnings);
  const spreadWarning = choiceSpreadWarning(spread, cal);
  if (spreadWarning) warnings.push(spreadWarning);
  // A fixture build takes the routes fallback by design and does not warn (spec 4.4).
  if (ar.fallback && cal.name !== 'fixture') warnings.push(routesWarning(ar.n));
  warnings.push(...bf.warnings);
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
    sizeOverEnvelope: {
      fired: spread.excludedOver,
      of: spread.n + spread.excludedOver + spread.noOption
    },
    choice: {
      spread,
      measured: recs.measured,
      noPanelRow: recs.noPanelRow,
      affordableLeftOut: market.affordable,
      affordable: { ...aff, cohort: targets.cohort },
      marginVsSlope,
      filedToIssued: step.filedToIssued,
      aboveTopN: step.aboveTop.n
    },
    fit,
    initiation: r,
    panel,
    events: ev,
    backcast,
    lpDiag,
    phaseGap: { rung: gaps.rung, groups: gaps.groups },
    market: mk.report,
    affordable: {
      routes: { n: ar.n, fallback: ar.fallback },
      stages,
      funding: bf.report,
      siteChoice: sites
    },
    cars: input.cars?.report ?? [],
    carsBackcast: input.cars?.backcast ?? [],
    warnings
  });

  return { calibration, json, reportMd, tallies, counts, warnings, backcast, targets };
}
