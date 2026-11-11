// Paired-draw fix, acceptance 2: the engine's stage step `scaledTransition` draws the kind and the
// time apart, so a time-in-stage scale s never changes the kind, moves the day monotonically in s,
// and at s = 1 is exactly the sampler's (`sampleKind`, `sampleTime`) on the days survived.
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCalibration, sampleKind, sampleTime } from '$lib/timelapse/model';
import { arbTransition } from '$lib/timelapse/test/arbitraries';
import { stageMonths } from '$lib/timelapse/time';
import { PATHWAYS, pathwayStages, type Calibration, type Transition } from '$lib/timelapse/types';
import { scaledTransition } from './engine';
import miniCalibrationJson from './fixtures/mini-calibration.json';

function load(path: string): Calibration {
  return parseCalibration(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));
}

const SOURCES: Calibration[] = [
  parseCalibration(structuredClone(miniCalibrationJson) as unknown),
  load('../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json')
];

const cells: Transition[] = [];
for (const c of SOURCES) {
  for (const p of PATHWAYS) {
    for (const s of pathwayStages(p)) {
      const t = (c.transitions[p] as Record<string, Transition | undefined>)[s];
      if (t) cells.push(t);
    }
  }
}

const u = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
const survivedArb = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 1860 }));
const scaleArb = fc.double({ min: 0.25, max: 4, noNaN: true });

/** The acceptance-2 properties of one (t, uKind, uTime, survived, s). */
function holds(t: Transition, uK: number, uT: number, survived: number, s: number): boolean {
  const r1 = scaledTransition(t, uK, uT, survived, 1);
  const rs = scaledTransition(t, uK, uT, survived, s);
  if (rs.kind !== r1.kind) return false;
  if (s < 1 && !(rs.days <= r1.days)) return false;
  if (s > 1 && !(rs.days >= r1.days)) return false;
  if (!(rs.days >= survived) || !Number.isInteger(rs.days)) return false;
  const tau = stageMonths(survived);
  const kind = sampleKind(t, uK, tau);
  return r1.kind === kind && r1.days === sampleTime(t, kind, uT, tau);
}

describe('scaledTransition (paired-draw fix, acceptance 2)', () => {
  it('has at least one mini and one fixture-0 cell', () => {
    expect(cells.length).toBeGreaterThan(10);
  });

  it('property: arbitrary transitions keep the kind and move the day monotonically in s', () => {
    expect(() =>
      fc.assert(fc.property(arbTransition(), u, u, survivedArb, scaleArb, holds), {
        numRuns: 500,
        seed: 0x5eed
      })
    ).not.toThrow();
  });

  it('property: every mini and fixture-0 cell keeps the kind and moves the day monotonically', () => {
    expect(() =>
      fc.assert(fc.property(fc.constantFrom(...cells), u, u, survivedArb, scaleArb, holds), {
        numRuns: 1000,
        seed: 0x5eed
      })
    ).not.toThrow();
  });
});
