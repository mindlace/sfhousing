import { describe, expect, it } from 'vitest';
import { FZP_COMPAT_LEVERS } from '$lib/sim/levers/types';
import { FUTURE_SCHEMA_MESSAGE } from '$lib/plan';
import {
  DEFAULT_POLICY,
  SIM_CODEC,
  isDefaultPolicy,
  parseSimDoc,
  serializeSimDoc,
  type SimDoc
} from './sim-doc';
import {
  defaultEffect,
  policyFromLevers,
  type SimPolicy,
  type Stroke,
  type ZoningBrush
} from './policy';
import type { TimingSet } from './timing';

const V = 'fixture-0';
const doc = (policy: SimPolicy = DEFAULT_POLICY, extra: Partial<SimDoc> = {}): SimDoc => ({
  schema: 1,
  kind: 'sim',
  datasetVersion: V,
  policy,
  ...extra
});
const stroke = (n = 2, radiusM = 50): Stroke => ({
  path: Array.from({ length: n }, (_, i) => [-122.4 + i * 1e-5, 37.7] as [number, number]),
  radiusM
});
const freehand = (id: string, strokes: Stroke[]): ZoningBrush => ({
  id,
  kind: 'freehand',
  strokes,
  effect: defaultEffect('raise', 6)
});
const withBrushes = (brushes: ZoningBrush[]): SimPolicy => ({ ...DEFAULT_POLICY, brushes });

const CUSTOM: TimingSet = {
  preset: 'benchmarkPermits',
  presetTimers: [
    { pathway: 'discretionary', stage: 'permitFiled', scale: 0.4786, reach: 'all' },
    { pathway: 'streamlined', stage: 'permitFiled', scale: 0.4786, reach: 'all' },
    { pathway: 'permitOnly', stage: 'permitFiled', scale: 0.4786, reach: 'all' }
  ],
  presetRouteShares: null,
  edits: [{ pathway: 'discretionary', stage: 'filed', scale: 0.8, reach: 'all' }],
  routeShares: { discretionary: 10, streamlined: 60, permitOnly: 30 },
  localProgramStreamlined: true
};
const timingHeavy = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  timing: { current: CUSTOM, saved: { label: 'Mine', set: CUSTOM } }
});
const brushHeavy = (): SimPolicy =>
  withBrushes([
    freehand('a', [stroke(40), stroke(10, 120)]),
    { id: 'e', kind: 'erase', strokes: [stroke(5)] },
    {
      id: 't',
      kind: 'transit',
      stopTypes: ['metro'],
      bands: [{ maxM: 402, stories: 6 }],
      mode: 'raise',
      densityLimits: false
    }
  ]);

const codesOf = (text: string) => {
  const r = parseSimDoc(text, 'strict');
  return r.ok ? [] : r.errors.map((e) => e.code);
};
const raw = (policy: SimPolicy, over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...doc(policy), ...over });

describe('serializeSimDoc', () => {
  it('serialize round-trips', () => {
    const docs = [
      doc(),
      doc(policyFromLevers(FZP_COMPAT_LEVERS)),
      doc(timingHeavy(), { title: 'Heavy' }),
      doc(brushHeavy())
    ];
    for (const d of docs) {
      const text = serializeSimDoc(d);
      const r = parseSimDoc(text, 'strict');
      expect(r.ok).toBe(true);
      if (r.ok) expect(serializeSimDoc(r.value)).toBe(text);
    }
  });

  it('coordinates are quantized', () => {
    const p = withBrushes([freehand('a', [{ path: [[-122.41941649, 37.7749291]], radiusM: 50 }])]);
    expect(serializeSimDoc(doc(p))).toContain('[-122.419416,37.774929]');
  });

  it('the measured sizes hold', () => {
    const bytes = (d: SimDoc) => new TextEncoder().encode(serializeSimDoc(d)).byteLength;
    expect(bytes(doc())).toBeLessThanOrEqual(512);
    expect(bytes(doc(timingHeavy()))).toBeLessThanOrEqual(2048);
  });
});

describe('SIM_CODEC', () => {
  it('names its storage and api', () => {
    expect(SIM_CODEC.kind).toBe('sim');
    expect(SIM_CODEC.api).toBe('/api/policies');
    expect(SIM_CODEC.path('abc')).toBe('/s/abc');
    expect(SIM_CODEC.storageKey).toBe('sfhousing:sim:v1');
    expect(SIM_CODEC.corruptKey('2026-01-01')).toBe('sfhousing:sim:corrupt:2026-01-01');
  });

  it('publishable strips the snapshot and serialize is stable', () => {
    const a = doc(timingHeavy());
    const b = doc({ ...timingHeavy(), timing: { current: CUSTOM, saved: null } });
    expect(SIM_CODEC.serialize(SIM_CODEC.publishable(a))).toBe(
      SIM_CODEC.serialize(SIM_CODEC.publishable(b))
    );
  });

  it('the default policy is empty, FZP compat is not', () => {
    expect(SIM_CODEC.isEmpty(doc())).toBe(true);
    const withSnapshot = {
      ...DEFAULT_POLICY,
      timing: { current: DEFAULT_POLICY.timing.current, saved: { label: 'x', set: CUSTOM } }
    };
    expect(SIM_CODEC.isEmpty(doc(withSnapshot))).toBe(true);
    expect(isDefaultPolicy(policyFromLevers(FZP_COMPAT_LEVERS))).toBe(false);
    expect(SIM_CODEC.isEmpty(doc(policyFromLevers(FZP_COMPAT_LEVERS)))).toBe(false);
  });

  it('counts brushes and protect strokes, rebases and makes an empty doc', () => {
    const p: SimPolicy = {
      ...brushHeavy(),
      protect: { ...DEFAULT_POLICY.protect, strokes: [{ ...stroke(), kind: 'protect' }] }
    };
    expect(SIM_CODEC.opCount(doc(p))).toBe(4);
    expect(SIM_CODEC.rebase(doc(p), 'fixture-1').datasetVersion).toBe('fixture-1');
    expect(SIM_CODEC.empty('fixture-2')).toEqual(
      doc(DEFAULT_POLICY, { datasetVersion: 'fixture-2' })
    );
    expect(SIM_CODEC.schema(doc())).toBe(1);
  });

  it('titles are normalized', () => {
    expect(SIM_CODEC.title(SIM_CODEC.withTitle(doc(), '  Hi  '))).toBe('Hi');
    expect('title' in SIM_CODEC.withTitle(doc(undefined, { title: 'x' }), ' ')).toBe(false);
  });
});

describe('limits', () => {
  it('5,001 one-point strokes: too-many-ops', () => {
    const p = withBrushes([
      freehand(
        'a',
        Array.from({ length: 5001 }, () => stroke(1))
      )
    ]);
    expect(codesOf(raw(p))).toEqual(['too-many-ops']);
  });
  it('a 2,001-point path: too-many-points', () => {
    expect(codesOf(raw(withBrushes([freehand('a', [stroke(2001)])])))).toEqual(['too-many-points']);
  });
  it('an empty path: bad-field', () => {
    const p = withBrushes([freehand('a', [{ path: [], radiusM: 50 }])]);
    expect(codesOf(raw(p))).toEqual(['bad-field']);
  });
  it('a point outside San Francisco: out-of-bounds', () => {
    const p = withBrushes([freehand('a', [{ path: [[0, 0]], radiusM: 50 }])]);
    expect(codesOf(raw(p))).toEqual(['out-of-bounds']);
  });
  it('radius 4, 501 and 30.5: out-of-bounds', () => {
    for (const r of [4, 501, 30.5])
      expect(codesOf(raw(withBrushes([freehand('a', [stroke(1, r)])])))).toEqual(['out-of-bounds']);
  });
  it('protect strokes obey the same limits', () => {
    const p: SimPolicy = {
      ...DEFAULT_POLICY,
      protect: { ...DEFAULT_POLICY.protect, strokes: [{ ...stroke(1, 4), kind: 'unprotect' }] }
    };
    expect(codesOf(raw(p))).toEqual(['out-of-bounds']);
  });
  it('a 121-character title: bad-field', () => {
    expect(codesOf(raw(DEFAULT_POLICY, { title: 'x'.repeat(121) }))).toEqual(['bad-field']);
    expect(codesOf(raw(DEFAULT_POLICY, { title: 'x'.repeat(120) }))).toEqual([]);
  });
  it('a bad datasetVersion: bad-field', () => {
    expect(codesOf(raw(DEFAULT_POLICY, { datasetVersion: 'nope' }))).toEqual(['bad-field']);
  });
  it('a document over 262,144 bytes: too-large', () => {
    const big = Array.from({ length: 100 }, (_, i) => freehand(`b${i}`, [stroke(2000)]));
    expect(codesOf(raw(withBrushes(big)))).toEqual(['too-large']);
  });
  it('schema 2: future-schema, in both modes', () => {
    for (const mode of ['strict', 'reconcile'] as const) {
      const r = parseSimDoc(raw(DEFAULT_POLICY, { schema: 2 }), mode);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0].code).toBe('future-schema');
        expect(r.errors[0].message).toBe(FUTURE_SCHEMA_MESSAGE);
      }
    }
    expect(SIM_CODEC.load(raw(DEFAULT_POLICY, { schema: 2 }))).toMatchObject({ ok: false });
  });
  it("kind 'plan' or a missing schema: unknown-schema", () => {
    expect(codesOf(raw(DEFAULT_POLICY, { kind: 'plan' }))).toEqual(['unknown-schema']);
    expect(codesOf(raw(DEFAULT_POLICY, { schema: undefined }))).toEqual(['unknown-schema']);
  });
  it('not JSON and not an object', () => {
    expect(codesOf('{')).toEqual(['not-json']);
    expect(codesOf('[]')).toEqual(['not-object']);
    expect(codesOf('null')).toEqual(['not-object']);
  });
  it('a policy format error is bad-field at /policy/<path>', () => {
    const p = JSON.parse(raw(DEFAULT_POLICY));
    p.policy.timing.current.preset = 'nope';
    const r = parseSimDoc(JSON.stringify(p), 'strict');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].code).toBe('bad-field');
      expect(r.errors[0].path).toBe('/policy/timing/current/preset');
    }
  });
});

describe('lenient parse', () => {
  const retired = () => {
    const p = JSON.parse(raw(DEFAULT_POLICY));
    p.policy.timing.current.preset = 'ceqaInfill';
    return JSON.stringify(p);
  };
  it('accepts a retired preset that strict rejects', () => {
    expect(parseSimDoc(retired(), 'reconcile').ok).toBe(true);
    expect(SIM_CODEC.load(retired()).ok).toBe(true);
    expect(SIM_CODEC.parse(retired()).ok).toBe(false);
  });
  it('still applies the size limits', () => {
    const p = withBrushes([freehand('a', [stroke(2001)])]);
    expect(parseSimDoc(raw(p), 'reconcile').ok).toBe(false);
  });
});
