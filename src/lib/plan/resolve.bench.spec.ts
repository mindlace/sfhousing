import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { createParcelIndex, type ParcelIndex } from './parcel-index';
import { applyOp, resolveEnvelopes } from './resolve';
import { quantize } from './schema';
import type { Plan, PlanOp } from './types';

// Synthetic city: 420 × 358 = 150,360 label points over ≈13.2 km × 11.1 km, in 16 × 16 chunks.
const W = -122.51,
  E = -122.36,
  S = 37.71,
  N = 37.81;
const COLS = 420,
  ROWS = 358,
  CELLS = 16;

function buildIndex(): { index: ParcelIndex; eligible: number } {
  const chunks = new Map<string, ParcelRecord[]>();
  let eligible = 0;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const n = j * COLS + i;
      const ok = n % 7 !== 0;
      if (ok) eligible++;
      const cell = `${Math.floor((i * CELLS) / COLS)}-${Math.floor((j * CELLS) / ROWS)}`;
      const rec: ParcelRecord = {
        id: String(1000000 + n),
        polygon: [],
        labelPoint: [W + ((i + 0.5) * (E - W)) / COLS, S + ((j + 0.5) * (N - S)) / ROWS],
        areaM2: 100,
        existingUnits: 1,
        existingFloorAreaM2: 100,
        existingHeightM: 6,
        landUse: 'RESIDENT',
        eligible: ok,
        neighborhood: 'Synthetic'
      };
      (chunks.get(cell) ?? chunks.set(cell, []).get(cell)!).push(rec);
    }
  }
  const index = createParcelIndex();
  for (const [cellId, records] of chunks) index.addChunk(cellId, records);
  return { index, eligible };
}

function wholeCityPlan(): Plan {
  const ops: PlanOp[] = [];
  for (let k = 0; k < 40; k++) {
    const lat = quantize(S + ((k + 0.5) * (N - S)) / 40);
    const path: [number, number][] = [];
    for (let p = 0; p < 14; p++) path.push([quantize(W + (p * (E - W)) / 13), lat]);
    ops.push({ kind: 'paint', id: `s${k}`, stories: 1 + (k % 80), radiusM: 500, path });
  }
  return { schema: 1, datasetVersion: 'fixture-0', ops };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe('performance budgets (spec §4.4)', () => {
  const { index, eligible } = buildIndex();
  const plan = wholeCityPlan();

  it('resolveEnvelopes: 150k parcels, 40 radius-500 m strokes, ≤ 1,000 ms', () => {
    expect(index.size).toBe(COLS * ROWS);
    const times: number[] = [];
    let size = 0;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      size = resolveEnvelopes(plan, index).size;
      times.push(performance.now() - t0);
    }
    expect(size).toBe(eligible); // every eligible parcel is covered
    expect(median(times)).toBeLessThanOrEqual(1000);
  });

  it('appending one ≈500-parcel op takes ≤ 10 ms', () => {
    const committed = resolveEnvelopes(plan, index);
    const op: PlanOp = {
      kind: 'paint',
      id: 'add',
      stories: 7,
      radiusM: 394,
      path: [[-122.435, 37.76]]
    };
    const n = index.covered(op).length;
    expect(n).toBeGreaterThanOrEqual(450);
    expect(n).toBeLessThanOrEqual(550);
    const times: number[] = [];
    for (let run = 0; run < 7; run++) {
      const state = new Map(committed);
      const t0 = performance.now();
      applyOp(state, op, index);
      times.push(performance.now() - t0);
    }
    expect(median(times)).toBeLessThanOrEqual(10);
  });
});
