import { describe, expect, it } from 'vitest';
import type { Provenance } from '$lib/timelapse/types';
import {
  BENCHMARK_PERMIT_DAYS,
  CEQA_FILED_RATIO,
  NO_DISCRETIONARY_BASIS,
  SB423_DEADLINE_DAYS,
  SB423_DEADLINE_QUANTILE,
  SB423_ROUTE_SHIFT,
  SB423_SMALL_SHARE,
  STAGE_FLOORS,
  type Evidence
} from './timing-sources';

const EDITABLE = ['preApplication', 'filed', 'permitFiled', 'permitIssued'];

const scalars: [string, Evidence<unknown>][] = [
  ['BENCHMARK_PERMIT_DAYS.sf', BENCHMARK_PERMIT_DAYS.sf],
  ['BENCHMARK_PERMIT_DAYS.sanDiego', BENCHMARK_PERMIT_DAYS.sanDiego],
  ['SB423_DEADLINE_DAYS', SB423_DEADLINE_DAYS],
  ['SB423_SMALL_SHARE', SB423_SMALL_SHARE],
  ['SB423_ROUTE_SHIFT', SB423_ROUTE_SHIFT],
  ['SB423_DEADLINE_QUANTILE', SB423_DEADLINE_QUANTILE],
  ['CEQA_FILED_RATIO', CEQA_FILED_RATIO],
  ['NO_DISCRETIONARY_BASIS', NO_DISCRETIONARY_BASIS]
];
const floors: [string, Evidence<number>][] = Object.entries(STAGE_FLOORS).flatMap(
  ([pathway, stages]) =>
    Object.entries(stages).map(([stage, e]): [string, Evidence<number>] => [
      `STAGE_FLOORS.${pathway}.${stage}`,
      e as Evidence<number>
    ])
);
const all = [...scalars, ...floors];

const isSourced = (e: Evidence<unknown>): e is { value: unknown; provenance: Provenance } =>
  'provenance' in e;

describe('timing sources', () => {
  it('every sourced value has an https source, a tier in 0..4, a label and a method', () => {
    for (const [name, e] of all.filter(([, e]) => isSourced(e))) {
      if (!isSourced(e)) continue;
      const p = e.provenance;
      expect(p.sources.length, name).toBeGreaterThanOrEqual(1);
      for (const s of p.sources) {
        expect(s.url, name).toMatch(/^https:\/\//);
        expect(s.label.length, name).toBeGreaterThan(0);
      }
      expect([0, 1, 2, 3, 4], name).toContain(p.tier);
      expect(p.label.length, name).toBeGreaterThan(0);
      expect(p.method, name).toMatch(/accessed 2026-10-30|asOf/);
    }
  });

  it('every unsourced value is null with a reason', () => {
    for (const [name, e] of all.filter(([, e]) => !isSourced(e))) {
      expect(e.value, name).toBeNull();
      expect('reason' in e && e.reason.length > 20, name).toBe(true);
    }
  });

  it('the 90% deadline quantile is a tier-4 parameter', () => {
    expect(SB423_DEADLINE_QUANTILE.value).toBe(0.9);
    expect(SB423_DEADLINE_QUANTILE.provenance.tier).toBe(4);
  });

  it('preset values that ship are tier 0 to 3', () => {
    const presetValues: [string, Evidence<unknown>][] = [
      ['BENCHMARK_PERMIT_DAYS.sf', BENCHMARK_PERMIT_DAYS.sf],
      ['BENCHMARK_PERMIT_DAYS.sanDiego', BENCHMARK_PERMIT_DAYS.sanDiego],
      ['SB423_DEADLINE_DAYS', SB423_DEADLINE_DAYS],
      ['SB423_SMALL_SHARE', SB423_SMALL_SHARE],
      ['SB423_ROUTE_SHIFT', SB423_ROUTE_SHIFT],
      ['CEQA_FILED_RATIO', CEQA_FILED_RATIO],
      ['NO_DISCRETIONARY_BASIS', NO_DISCRETIONARY_BASIS]
    ];
    for (const [name, e] of presetValues) {
      if (isSourced(e)) expect(e.provenance.tier, name).toBeLessThanOrEqual(3);
      else expect(e.value, name).toBeNull();
    }
  });

  it('every floor value is positive and finite, on an editable stage', () => {
    expect(floors.length).toBeGreaterThan(0);
    for (const [name, e] of floors) {
      expect(EDITABLE, name).toContain(name.split('.')[2]);
      if (e.value === null) continue;
      expect(Number.isFinite(e.value), name).toBe(true);
      expect(e.value, name).toBeGreaterThan(0);
    }
  });

  it('with the issued-in-window SF median (280 days), San Diego permits faster: ratio in (0, 1)', () => {
    // The direction depends on the SF figure: 280 days gives 0.48, PermitSF's 177 gives 0.76, and
    // the filed-and-issued-since-2024 114 gives 1.18. 280 is used because it, like San Diego's
    // 134, counts permits issued in a window whatever their filing date, which matches the
    // model's pooled permitFiled stage. The caveats travel in both values' provenance.
    expect(BENCHMARK_PERMIT_DAYS.sf.provenance.method).toContain('not an exact comparison');
    expect(BENCHMARK_PERMIT_DAYS.sanDiego.provenance.method).toContain('1.18');
    const ratio = BENCHMARK_PERMIT_DAYS.sanDiego.value / BENCHMARK_PERMIT_DAYS.sf.value;
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('the SB 423 clock is shorter for small projects, and the small share is a share', () => {
    const d = SB423_DEADLINE_DAYS.value;
    expect(d.small).toBeLessThan(d.large);
    expect(d.unitsCutoff).toBe(150);
    if (SB423_SMALL_SHARE.value !== null) {
      expect(SB423_SMALL_SHARE.value).toBeGreaterThanOrEqual(0);
      expect(SB423_SMALL_SHARE.value).toBeLessThanOrEqual(1);
    }
  });
});
