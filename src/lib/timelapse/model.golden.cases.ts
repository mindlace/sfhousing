/**
 * Inputs and flattening for the cross-engine model golden (AC-11). The generator
 * (`scripts/model-golden.ts`, Node) writes `fixtures/model-golden.json` from `modelGoldenCases`;
 * `model.golden.test.ts` (Node) and `model.golden.svelte.spec.ts` (browser engines) recompute the
 * same cases and compare every output bit for bit. Test support only: nothing in the app imports it.
 */
import small from './fixtures/calibration-small.json';
import {
  chanceTable,
  cumulativeIncidence,
  initiationHazard,
  parseCalibration,
  sampleTransition,
  typicalMonths
} from './model';
import {
  EXIT_ORDER,
  PATHWAYS,
  pathwayStages,
  type Calibration,
  type FeatureId,
  type Pathway,
  type Stage
} from './types';

export type GoldenCase = { fn: string; input: string; bits: string[] };

type Tabled = Exclude<Stage, 'complete'>;

const view = new DataView(new ArrayBuffer(8));

/** The IEEE-754 double bit pattern of `x` as 16 hex digits. */
export function bits(x: number): string {
  view.setFloat64(0, x);
  return (
    view.getUint32(0).toString(16).padStart(8, '0') +
    view.getUint32(4).toString(16).padStart(8, '0')
  );
}

/** Outcome kind as a number: advance 0, then the exit reasons in `EXIT_ORDER` from 1. */
function kindIndex(kind: string): number {
  return kind === 'advance' ? 0 : EXIT_ORDER.indexOf(kind as (typeof EXIT_ORDER)[number]) + 1;
}

/** The two cells of `calibration-small.json` the sampling and incidence cases use. */
const CELLS: { pathway: Pathway; stage: Tabled }[] = [
  { pathway: 'discretionary', stage: 'permitFiled' }, // 12-month table with an expiry exit
  { pathway: 'discretionary', stage: 'filed' } // 1-month table, tail from month 2
];

/** Fixed months already survived: before, at and beyond each cell's table end. */
const MONTHS_ELAPSED = [0, 0, 1, 2, 5, 11, 12, 13, 20, 60];

/** Fixed uniforms in [0, 1): both ends, then a scrambled grid of 50ths offset by 0.0013. */
function uniform(i: number): number {
  if (i === 0) return 0;
  if (i === 1) return 0.9999999;
  return ((i * 17) % 50) / 50 + 0.0013;
}

function sampleCases(cal: Calibration): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (let i = 0; i < 50; i++) {
    const cell = CELLS[i % 2];
    const u = uniform(i);
    const m = MONTHS_ELAPSED[Math.floor(i / 2) % MONTHS_ELAPSED.length];
    const r = sampleTransition(cal.transitions[cell.pathway][cell.stage]!, u, m);
    out.push({
      fn: 'sampleTransition',
      input: `${cell.pathway}.${cell.stage} u=${u} m=${m}`,
      bits: [bits(r.days), bits(kindIndex(r.kind))]
    });
  }
  return out;
}

const RATIOS = [
  -1, 0, 0.5, 1, 1.9999, 2, 2.5, 3, 4.9999, 5, 5.5, 6, 8, 10, 15, 25, 50, 100, 1e3, 1e6
];

function initiationCases(cal: Calibration): GoldenCase[] {
  return RATIOS.map((potentialRatio, i) => {
    const f: Record<FeatureId, number> = {
      potentialRatio,
      existingUnits: i,
      lotAreaM2: 200 + 37 * i,
      yearBuilt: 1900 + 5 * i,
      storiesGap: i % 7,
      improvementShare: (i % 10) / 10,
      rentControlLikely: i % 2,
      landUseClass: i % 6
    };
    return {
      fn: 'initiationHazard',
      input: `potentialRatio=${potentialRatio} (other features vary with row ${i})`,
      bits: [bits(initiationHazard(cal.initiation, f))]
    };
  });
}

function chanceCases(cal: Calibration): GoldenCase[] {
  const table = chanceTable(cal);
  const out: GoldenCase[] = [];
  for (const p of PATHWAYS) {
    for (const stage of pathwayStages(p)) {
      if (stage === 'complete') continue;
      const arr = table[p][stage];
      if (arr === undefined) continue;
      // Float32 widened to double, months in stage 0..240.
      out.push({
        fn: 'chanceTable',
        input: `${p}.${stage}`,
        bits: Array.from(arr, (v) => bits(v))
      });
    }
  }
  return out;
}

function typicalCases(cal: Calibration): GoldenCase[] {
  const typical = typicalMonths(cal);
  const names: string[] = [];
  const flat: string[] = [];
  for (const p of PATHWAYS) {
    for (const stage of pathwayStages(p)) {
      if (stage === 'complete') continue;
      const v = typical[p][stage];
      if (v === undefined) continue;
      names.push(`${p}.${stage}`);
      flat.push(bits(v));
    }
  }
  return [{ fn: 'typicalMonths', input: names.join(','), bits: flat }];
}

function incidenceCases(cal: Calibration): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const cell of CELLS) {
    const t = cal.transitions[cell.pathway][cell.stage]!;
    for (let k = 0; k <= 40; k++) {
      const inc = cumulativeIncidence(t, k);
      // advance, then the exit reasons the transition mentions in `EXIT_ORDER`.
      const reasons = EXIT_ORDER.filter((r) => r in inc.exit);
      out.push({
        fn: 'cumulativeIncidence',
        input: `${cell.pathway}.${cell.stage} k=${k}`,
        bits: [bits(inc.advance), ...reasons.map((r) => bits(inc.exit[r]!))]
      });
    }
  }
  return out;
}

/** Every golden case, computed from `calibration-small.json` in the current engine. */
export function modelGoldenCases(): GoldenCase[] {
  const cal = parseCalibration(small);
  return [
    ...sampleCases(cal),
    ...initiationCases(cal),
    ...chanceCases(cal),
    ...typicalCases(cal),
    ...incidenceCases(cal)
  ];
}
