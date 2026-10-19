// Spec §6 `initiation.property.spec.ts`: first-initiation months follow the geometric
// distribution P(T = t) = (1 − h)^(t−1) h within 4·SE, through the whole engine. One hostable
// mini parcel is replicated across 20,000 synthetic parcel ids (a bench-style ScenarioParcels
// built here), with a constant hazard h and no pipeline projects.
import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { exp, log } from '$lib/timelapse/math';
import { parseCalibration } from '$lib/timelapse/model';
import { MONTH_DAYS } from '$lib/timelapse/time';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { MINI_AS_OF } from './fixtures/mini-projects';
import { precomputeOf } from './input';
import { simulate } from './simulate';
import type { SimInput } from './types';

const N = 20000;
const AS_OF = MINI_AS_OF;
const HORIZON = AS_OF + 60 * 365; // P(T > 720 months) is about 1e-33 at h = 0.1
const TEMPLATE = '3512002'; // hostable, not Local Program, no in-flight project
const H_TARGET = 0.1;

type Typed = Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array;

/** `n` copies of row `i` of `src`, with ids `SYN0…`, in one cell. */
function replicate(src: ScenarioParcels, i: number, n: number): ScenarioParcels {
  const rows = <A extends Typed>(a: A): A => {
    const stride = a.length / src.count;
    const b = new (a.constructor as new (len: number) => A)(n * stride);
    const row = a.subarray(i * stride, (i + 1) * stride);
    for (let r = 0; r < n; r++) b.set(row, r * stride);
    return b;
  };
  const out: Record<string, unknown> = { ...src };
  for (const [key, v] of Object.entries(src))
    if (ArrayBuffer.isView(v)) out[key] = rows(v as Typed);
  const id = Array.from({ length: n }, (_, r) => `SYN${r}`);
  return {
    ...(out as unknown as ScenarioParcels),
    count: n,
    cells: [{ cellId: src.cells[src.cell[i]].cellId, start: 0, count: n }],
    cell: new Uint16Array(n),
    id,
    index: new Map(id.map((x, r) => [x, r])),
    potentialRatio: { fzp: rows(src.potentialRatio.fzp), base: rows(src.potentialRatio.base) },
    storiesGap: { fzp: rows(src.storiesGap.fzp), base: rows(src.storiesGap.base) }
  };
}

describe('simulated initiation (§4.4.4)', () => {
  it('first-initiation months of 20,000 parcels are geometric at the parcel hazard', () => {
    const src = miniCity().parcels;
    const parcels = replicate(src, src.index.get(TEMPLATE)!, N);
    const cal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
    cal.initiation = { ...cal.initiation, intercept: log(H_TARGET / (1 - H_TARGET)), terms: [] };
    const input: SimInput = { parcels, projects: [], calibration: cal, asOf: AS_OF };
    const pre = precomputeOf(input);
    const h = pre.hazard[0];
    expect(h).toBeCloseTo(H_TARGET, 12);
    expect(pre.hazard.every((x) => x === h)).toBe(true);

    const first = new Map<string, number>();
    for (const s of simulate(input, 20261018, HORIZON)) {
      const m = /^sim:(SYN\d+):(\d+)$/.exec(s.projectId);
      expect(m).not.toBeNull();
      if (m![2] === '0') first.set(m![1], s.revisions[0].day);
    }
    expect(first.size).toBe(N);

    // Day placement: D = day − (asOf + 1) = floor((T − 1 + v)·M), v uniform. Day bin t holds
    // D in [a_t, a_{t+1}) with a_t = ceil((t − 1)·M). It receives all of month T = t except the
    // fraction δ_t = (a_t − (t − 1)·M)/M before a_t, plus that fraction δ_{t+1} of month t + 1.
    const M = MONTH_DAYS;
    const a = (t: number) => Math.ceil((t - 1) * M);
    const delta = (t: number) => (a(t) - (t - 1) * M) / M;
    const g = (t: number) => exp((t - 1) * log(1 - h)) * h; // P(T = t)
    const counts = new Array<number>(14).fill(0);
    for (const day of first.values()) {
      const D = day - (AS_OF + 1);
      expect(D).toBeGreaterThanOrEqual(0);
      let t = 1;
      while (t <= 12 && D >= a(t + 1)) t++;
      counts[t]++; // t = 13: the tail, D ≥ a_13
    }
    const bad: string[] = [];
    const check = (label: string, got: number, expected: number) => {
      const se = Math.sqrt((expected * (1 - expected)) / N);
      if (Math.abs(got - expected) > 4 * se) bad.push(`${label}: ${got} vs ${expected}`);
    };
    for (let t = 1; t <= 12; t++) {
      const exact = g(t) * (1 - delta(t)) + g(t + 1) * delta(t + 1);
      check(`month ${t}`, counts[t] / N, exact);
      // the plain geometric P(T = t), which the boundary-day shift moves by under 1/30 of itself
      check(`geometric month ${t}`, counts[t] / N, g(t));
      expect(Math.abs(exact - g(t))).toBeLessThan(g(t) / 30);
    }
    check('T > 12', counts[13] / N, exp(12 * log(1 - h)) - g(13) * delta(13));
    check('geometric T > 12', counts[13] / N, exp(12 * log(1 - h)));
    expect(bad).toEqual([]);
  });
});
