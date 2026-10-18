/**
 * Inputs and flattening for the cross-engine model golden (AC-11). The generator
 * (`scripts/model-golden.ts`, Node) writes `fixtures/model-golden.json` from `modelGoldenCases`;
 * `model.golden.shared.ts` (run by the server test and, in every browser engine, the client spec)
 * recomputes the same cases and compares every output bit for bit. Test support only: nothing in
 * the app imports it.
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
  type ExitReason,
  type FeatureId,
  type Pathway,
  type Stage,
  type Transition
} from './types';

export type GoldenCase = { fn: string; input: string; bits: string[] };

type Tabled = Exclude<Stage, 'complete'>;
type Cell = { pathway: Pathway; stage: Tabled };

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
  return kind === 'advance' ? 0 : EXIT_ORDER.indexOf(kind as ExitReason) + 1;
}

/** Every transition cell in pathway then stage order (16 of them). */
function allCells(): Cell[] {
  const out: Cell[] = [];
  for (const pathway of PATHWAYS) {
    for (const stage of pathwayStages(pathway)) {
      if (stage !== 'complete') out.push({ pathway, stage });
    }
  }
  return out;
}

/** The two cells of `calibration-small.json` the sampling and incidence cases use. */
const SMALL_CELLS: Cell[] = [
  { pathway: 'discretionary', stage: 'permitFiled' }, // 12-month table with an expiry exit
  { pathway: 'discretionary', stage: 'filed' } // 1-month table, tail from month 2
];

/** Four synthetic cells (by `allCells()` index) with different table lengths and exit sets. */
function syntheticCells(): Cell[] {
  const all = allCells();
  return [1, 4, 8, 13].map((i) => all[i]);
}

/**
 * A calibration with far more entropy than the fixture, built in code from +, * and / only
 * (exactly rounded, so identical in every engine): per cell a table of 3..13 months, one to four
 * exit reasons and a non-round tail rho of about 0.02 to 0.07; a five-term initiation model with
 * non-round coefficients and edges. It passes `parseCalibration`; everything else is the fixture's.
 */
function syntheticCalibration(): Calibration {
  const cal = JSON.parse(JSON.stringify(small)) as Calibration;
  const base = cal.transitions.discretionary.filed!;
  allCells().forEach(({ pathway, stage }, i) => {
    const months = 3 + ((i * 5) % 11);
    const reasons = EXIT_ORDER.filter(
      (_, r) =>
        r === 0 || (r === 1 && i % 2 === 0) || (r === 2 && i % 3 === 0) || (r === 3 && i % 4 === 1)
    );
    const advance: number[] = [];
    let a = 0;
    for (let j = 0; j < months; j++) {
      a += 0.013 + 0.0071 * ((i + j) % 4) + 0.0003 * i;
      advance.push(a);
    }
    const exit: Transition['exit'] = {};
    const tailExit: Transition['tail']['exit'] = {};
    for (const reason of reasons) {
      const r = EXIT_ORDER.indexOf(reason);
      const cum: number[] = [];
      let e = 0;
      for (let j = 0; j < months; j++) {
        e += 0.0021 + 0.0013 * ((i * 2 + j + r) % 3);
        cum.push(e);
      }
      exit[reason] = cum;
      tailExit[reason] = 0.0043 + 0.00061 * (r + 1) + 0.00007 * i;
    }
    cal.transitions[pathway][stage] = {
      months,
      advance,
      exit,
      tail: { advance: 0.0137 + 0.0019 * (i % 5) + 0.00011 * i, exit: tailExit },
      provenance: base.provenance,
      tailProvenance: base.tailProvenance
    };
  });
  cal.initiation = {
    kind: 'logit-monthly',
    intercept: -5.37,
    terms: [
      { feature: 'potentialRatio', bins: [0.3, 1.1, 2.7, 6.2], coef: [-0.41, 0.13, 0.62, 1.07] },
      {
        feature: 'yearBuilt',
        bins: [1880, 1920, 1960, 1979, 2000],
        coef: [0.31, 0.12, -0.07, -0.23, -0.49]
      },
      { feature: 'improvementShare', bins: [0, 0.25, 0.5, 0.8], coef: [0.52, 0.17, -0.19, -0.58] },
      { feature: 'rentControlLikely', bins: [0, 1], coef: [0.09, -0.37] },
      { feature: 'storiesGap', bins: [-2, 0, 1, 3], coef: [-0.2, 0.05, 0.28, 0.44] }
    ],
    provenance: cal.initiation.provenance
  };
  return parseCalibration(cal);
}

/** Fixed months already survived: before, at and beyond a cell's table end. */
const MONTHS_ELAPSED = [0, 0, 1, 2, 5, 11, 12, 13, 20, 60];

/** Fixed uniforms in [0, 1): both ends, then a scrambled grid of `mod`ths offset by `off`. */
function uniform(i: number, step: number, mod: number, off: number): number {
  if (i === 0) return 0;
  if (i === 1) return 0.9999999;
  return ((i * step) % mod) / mod + off;
}

function sampleCases(
  label: string,
  cal: Calibration,
  cells: Cell[],
  grid: { step: number; mod: number; off: number }
): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (let i = 0; i < 50; i++) {
    const cell = cells[i % cells.length];
    const u = uniform(i, grid.step, grid.mod, grid.off);
    const m = MONTHS_ELAPSED[Math.floor(i / cells.length) % MONTHS_ELAPSED.length];
    const r = sampleTransition(cal.transitions[cell.pathway][cell.stage]!, u, m);
    out.push({
      fn: 'sampleTransition',
      input: `${label} ${cell.pathway}.${cell.stage} u=${u} m=${m}`,
      bits: [bits(r.days), bits(kindIndex(r.kind))]
    });
  }
  return out;
}

const RATIOS = [
  -1, 0, 0.5, 1, 1.9999, 2, 2.5, 3, 4.9999, 5, 5.5, 6, 8, 10, 15, 25, 50, 100, 1e3, 1e6
];

/** The fixture has one initiation term (`potentialRatio`), so only that feature matters there. */
function smallInitiationCases(cal: Calibration): GoldenCase[] {
  return RATIOS.map((potentialRatio) => {
    const f: Record<FeatureId, number> = {
      potentialRatio,
      existingUnits: 0,
      lotAreaM2: 0,
      yearBuilt: 0,
      storiesGap: 0,
      improvementShare: 0,
      rentControlLikely: 0,
      landUseClass: 0
    };
    return {
      fn: 'initiationHazard',
      input: `small potentialRatio=${potentialRatio} (the fixture's only term)`,
      bits: [bits(initiationHazard(cal.initiation, f))]
    };
  });
}

/** Thirty vectors varying every feature the synthetic model uses, across all its bins. */
function syntheticInitiationCases(cal: Calibration): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (let i = 0; i < 30; i++) {
    const f: Record<FeatureId, number> = {
      potentialRatio: ((i * 37) % 101) / 9.3 - 0.5,
      existingUnits: (i * 11) % 40,
      lotAreaM2: 150 + ((i * 97) % 900),
      yearBuilt: 1870 + ((i * 53) % 160),
      storiesGap: ((i * 5) % 9) - 3,
      improvementShare: ((i * 29) % 97) / 97,
      rentControlLikely: i % 2,
      landUseClass: i % 6
    };
    const described = (Object.keys(f) as FeatureId[]).map((k) => `${k}=${f[k]}`).join(' ');
    out.push({
      fn: 'initiationHazard',
      input: `synthetic ${described}`,
      bits: [bits(initiationHazard(cal.initiation, f))]
    });
  }
  return out;
}

function chanceCases(label: string, cal: Calibration): GoldenCase[] {
  const table = chanceTable(cal);
  const out: GoldenCase[] = [];
  for (const { pathway, stage } of allCells()) {
    const arr = table[pathway][stage];
    if (arr === undefined) continue;
    // Float32 widened to double, months in stage 0..240.
    out.push({
      fn: 'chanceTable',
      input: `${label} ${pathway}.${stage}`,
      bits: Array.from(arr, (v) => bits(v))
    });
  }
  return out;
}

function typicalCases(label: string, cal: Calibration): GoldenCase[] {
  const typical = typicalMonths(cal);
  const names: string[] = [];
  const flat: string[] = [];
  for (const { pathway, stage } of allCells()) {
    const v = typical[pathway][stage];
    if (v === undefined) continue;
    names.push(`${pathway}.${stage}`);
    flat.push(bits(v));
  }
  return [{ fn: 'typicalMonths', input: `${label} ${names.join(',')}`, bits: flat }];
}

function incidenceCases(label: string, cal: Calibration, cells: Cell[]): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const cell of cells) {
    const t = cal.transitions[cell.pathway][cell.stage]!;
    for (let k = 0; k <= 40; k++) {
      const inc = cumulativeIncidence(t, k);
      // advance, then the exit reasons the transition mentions in `EXIT_ORDER`.
      const reasons = EXIT_ORDER.filter((r) => r in inc.exit);
      out.push({
        fn: 'cumulativeIncidence',
        input: `${label} ${cell.pathway}.${cell.stage} k=${k}`,
        bits: [bits(inc.advance), ...reasons.map((r) => bits(inc.exit[r]!))]
      });
    }
  }
  return out;
}

/**
 * Every golden case in the current engine: `calibration-small.json` (the brief's cells and counts)
 * and `syntheticCalibration()` (varied tables, several exit reasons, a multi-term initiation model).
 */
export function modelGoldenCases(): GoldenCase[] {
  const cal = parseCalibration(small);
  const syn = syntheticCalibration();
  return [
    ...sampleCases('small', cal, SMALL_CELLS, { step: 17, mod: 50, off: 0.0013 }),
    ...sampleCases('synthetic', syn, syntheticCells(), { step: 23, mod: 97, off: 0.00071 }),
    ...smallInitiationCases(cal),
    ...syntheticInitiationCases(syn),
    ...chanceCases('small', cal),
    ...chanceCases('synthetic', syn),
    ...typicalCases('small', cal),
    ...typicalCases('synthetic', syn),
    ...incidenceCases('small', cal, SMALL_CELLS),
    ...incidenceCases('synthetic', syn, syntheticCells())
  ];
}
