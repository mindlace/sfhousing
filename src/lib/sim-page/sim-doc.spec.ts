import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FUTURE_SCHEMA_MESSAGE } from '$lib/plan';
import { fundingOnly, maxFunding } from '$lib/sim/levers/fixtures/finance';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { readRecord } from '$lib/sharing/storage';
import {
  DEFAULT_POLICY,
  SCHEMA2_PUBLISH_MESSAGE,
  SIM_CODEC,
  simDocProblems,
  SIM_KEY,
  isDefaultPolicy,
  parseSimDoc,
  serializeSimDoc,
  type SimDoc
} from './sim-doc';
import type { CustomBrush, SimPolicy, Stroke } from './policy';
import type { TimingSet } from './timing';

const V = 'fixture-0';
const doc = (policy: SimPolicy = DEFAULT_POLICY, extra: Partial<SimDoc> = {}): SimDoc => ({
  schema: 3,
  kind: 'sim',
  datasetVersion: V,
  policy,
  ...extra
});
const stroke = (n = 2, radiusM = 50): Stroke => ({
  path: Array.from({ length: n }, (_, i) => [-122.4 + i * 1e-5, 37.7] as [number, number]),
  radiusM
});
const freehand = (id: string, strokes: Stroke[]): CustomBrush => ({
  id,
  kind: 'paint',
  strokes,
  stories: 6
});
const withBrushes = (custom: CustomBrush[]): SimPolicy => ({ ...DEFAULT_POLICY, custom });

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
const brushHeavy = (): SimPolicy => ({
  ...withBrushes([
    freehand('a', [stroke(40), stroke(10, 120)]),
    { id: 'e', kind: 'erase', strokes: [stroke(5)] }
  ]),
  rules: [{ id: 't', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 6 }] }]
});

const codesOf = (text: string) => {
  const r = parseSimDoc(text, 'strict');
  return r.ok ? [] : r.errors.map((e) => e.code);
};
/** A policy with one transit rule and nothing else. */
const RULE_ONLY: SimPolicy = {
  ...DEFAULT_POLICY,
  rules: [{ id: 'r', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 6 }] }]
};
/** A rule as an older version stored it: street rules are dropped on load. */
const STREET_RAW = {
  id: 's',
  kind: 'street',
  classes: ['arterial'],
  names: [],
  depth: 0,
  ncOnly: true,
  stories: 6
};
const raw = (policy: SimPolicy, over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...doc(policy), ...over });

describe('serializeSimDoc', () => {
  it('serialize round-trips', () => {
    const docs = [doc(), doc(RULE_ONLY), doc(timingHeavy(), { title: 'Heavy' }), doc(brushHeavy())];
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
  it('load drops a stored street rule; parse rejects it with bad-field', () => {
    const TRANSIT_RULE = RULE_ONLY.rules[0];
    const text = JSON.stringify({
      ...doc(),
      policy: { ...doc().policy, rules: [TRANSIT_RULE, STREET_RAW] }
    });
    const loaded = SIM_CODEC.load(text);
    expect(loaded.ok && loaded.value.policy.rules).toEqual([TRANSIT_RULE]);
    const parsed = SIM_CODEC.parse(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.errors[0]).toMatchObject({ code: 'bad-field', path: '/policy/rules/1/kind' });
  });

  it('an autosave with transit, street and paint restores all but the street rule', () => {
    const policy = {
      ...brushHeavy(),
      protect: { rentControl: true, historic: true, newerThanYears: 20 }
    };
    const stored = { ...doc(policy), policy: { ...policy, rules: [STREET_RAW, ...policy.rules] } };
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, JSON.stringify({ v: 1, savedAt: 'x', plan: JSON.stringify(stored) }));
    const r = readRecord(mem, SIM_CODEC);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.plan.policy).toEqual(policy);
  });

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

  it('the default policy is empty, a policy with a rule is not', () => {
    expect(SIM_CODEC.isEmpty(doc())).toBe(true);
    const withSnapshot = {
      ...DEFAULT_POLICY,
      timing: { current: DEFAULT_POLICY.timing.current, saved: { label: 'x', set: CUSTOM } }
    };
    expect(SIM_CODEC.isEmpty(doc(withSnapshot))).toBe(true);
    expect(isDefaultPolicy(RULE_ONLY)).toBe(false);
    expect(SIM_CODEC.isEmpty(doc(RULE_ONLY))).toBe(false);
  });

  it('counts rules plus custom brushes, rebases and makes an empty doc', () => {
    const p = brushHeavy();
    expect(SIM_CODEC.opCount(doc(p))).toBe(3);
    expect(SIM_CODEC.rebase(doc(p), 'fixture-1').datasetVersion).toBe('fixture-1');
    expect(SIM_CODEC.empty('fixture-2')).toEqual(
      doc(DEFAULT_POLICY, { datasetVersion: 'fixture-2' })
    );
    expect(SIM_CODEC.schema(doc())).toBe(3);
  });

  it('round-trips schema 2 and counts rules plus custom brushes as ops', () => {
    const d: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: {
        ...DEFAULT_POLICY,
        custom: [
          {
            id: '1',
            kind: 'paint',
            strokes: [{ path: [[-122.4, 37.77]], radiusM: 20 }],
            stories: 8
          }
        ]
      }
    };
    expect(SIM_CODEC.load(SIM_CODEC.serialize(d))).toEqual({ ok: true, value: d });
    expect(SIM_CODEC.opCount(d)).toBe(1);
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
  it('erase strokes obey the same limits', () => {
    const p = withBrushes([{ id: 'e', kind: 'erase', strokes: [stroke(1, 4)] }]);
    expect(codesOf(raw(p))).toEqual(['out-of-bounds']);
  });
  it('the stroke limit counts custom strokes only, across brushes', () => {
    const half = () => Array.from({ length: 2500 }, () => stroke(1));
    const p = withBrushes([freehand('a', half()), { id: 'e', kind: 'erase', strokes: half() }]);
    expect(codesOf(raw(p))).toEqual([]);
    const over = withBrushes([freehand('a', half()), freehand('b', [...half(), stroke(1)])]);
    expect(codesOf(raw(over))).toEqual(['too-many-ops']);
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
  it('schema 4: future-schema, in both modes', () => {
    for (const mode of ['strict', 'reconcile'] as const) {
      const r = parseSimDoc(raw(DEFAULT_POLICY, { schema: 4 }), mode);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0].code).toBe('future-schema');
        expect(r.errors[0].message).toBe(FUTURE_SCHEMA_MESSAGE);
      }
    }
    expect(SIM_CODEC.load(raw(DEFAULT_POLICY, { schema: 4 }))).toMatchObject({ ok: false });
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

describe('schema 3 documents and the schema-2 loader', () => {
  const stored = (name: string) =>
    readFileSync(new URL(`./fixtures/schema2/${name}`, import.meta.url), 'utf8');
  const withoutKeys = (p: object, ...keys: string[]) => {
    const o = { ...p } as Record<string, unknown>;
    for (const k of keys) delete o[k];
    return o;
  };

  const texts: [string, string][] = [
    ['painted.json', stored('painted.json')],
    ['profile.json', stored('profile.json')],
    ['tampered.json', stored('tampered.json')],
    ['default-record.json (plan)', JSON.parse(stored('default-record.json')).plan]
  ];

  it.each(texts)('%s loads in reconcile as schema 3 with default funding', (_n, text) => {
    const r = parseSimDoc(text, 'reconcile');
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.schema).toBe(3);
    expect(r.value.policy.schema).toBe(3);
    expect(r.value.policy.funding).toEqual(DEFAULT_POLICY.funding);
    expect(r.value.policy.funding).not.toBe(DEFAULT_POLICY.funding);
    const storedPolicy = JSON.parse(text).policy;
    // Reconcile keeps the stored fields except the preset layer it re-derives (tampered.json),
    // so compare the parts reconcile leaves alone.
    expect(withoutKeys(r.value.policy, 'schema', 'funding', 'timing')).toEqual(
      withoutKeys(storedPolicy, 'schema', 'timing')
    );
  });

  it.each(texts)('%s in strict is unknown-schema with the publish message', (_n, text) => {
    expect(parseSimDoc(text, 'strict')).toEqual({
      ok: false,
      errors: [{ path: '/schema', code: 'unknown-schema', message: SCHEMA2_PUBLISH_MESSAGE }]
    });
  });

  it('a schema-2 document whose policy has funding is bad-field at /policy/funding', () => {
    const d = JSON.parse(stored('painted.json'));
    d.policy.funding = DEFAULT_POLICY.funding;
    const r = parseSimDoc(JSON.stringify(d), 'reconcile');
    expect(r).toMatchObject({
      ok: false,
      errors: [{ path: '/policy/funding', code: 'bad-field', message: 'funding: unknown key' }]
    });
  });

  it('a schema-3 document whose policy is schema 2 is bad-field at /policy/schema', () => {
    const d = JSON.parse(serializeSimDoc(doc()));
    d.policy.schema = 2;
    for (const mode of ['strict', 'reconcile'] as const)
      expect(parseSimDoc(JSON.stringify(d), mode)).toMatchObject({
        ok: false,
        errors: [
          { path: '/policy/schema', code: 'bad-field', message: 'schema: expected 3, got 2' }
        ]
      });
  });

  it('schema 4 is future-schema in both modes', () => {
    const d = { ...JSON.parse(serializeSimDoc(doc())), schema: 4 };
    for (const mode of ['strict', 'reconcile'] as const)
      expect(parseSimDoc(JSON.stringify(d), mode)).toMatchObject({
        ok: false,
        errors: [{ path: '/schema', code: 'future-schema' }]
      });
  });

  it('serialize then load round-trips funding', () => {
    const d = doc({ ...DEFAULT_POLICY, funding: fundingOnly() });
    const r = parseSimDoc(serializeSimDoc(d), 'reconcile');
    expect(r).toEqual({ ok: true, value: d });
  });

  it('a funding error has a full pointer; a term out of range too, in both modes', () => {
    const d = JSON.parse(serializeSimDoc(doc({ ...DEFAULT_POLICY, funding: fundingOnly() })));
    d.policy.funding.pools[0].id = 'Bad Id';
    expect(parseSimDoc(JSON.stringify(d), 'strict')).toMatchObject({
      ok: false,
      errors: [{ path: '/policy/funding/pools/0/id', code: 'bad-field' }]
    });
    const t = JSON.parse(serializeSimDoc(doc()));
    t.policy.funding.terms = { lossOnExit: 5 };
    for (const mode of ['strict', 'reconcile'] as const)
      expect(parseSimDoc(JSON.stringify(t), mode)).toMatchObject({
        ok: false,
        errors: [{ path: '/policy/funding/terms/lossOnExit', code: 'bad-field' }]
      });
  });

  it('a guarantee without a typed cut is bad-field in strict and parses in reconcile', () => {
    const f = fundingOnly();
    f.programmes[0].instrument = { kind: 'guarantee', costShare: 0.6, reserve: 0.1 };
    const text = serializeSimDoc(doc({ ...DEFAULT_POLICY, funding: f }));
    expect(parseSimDoc(text, 'strict')).toEqual({
      ok: false,
      errors: [
        {
          path: '/policy/funding/programmes/0/instrument',
          code: 'bad-field',
          message: 'guarantee needs guaranteeRateCut, which is not sourced'
        }
      ]
    });
    expect(parseSimDoc(text, 'reconcile').ok).toBe(true);
    f.terms = { guaranteeRateCut: 0.01 };
    expect(parseSimDoc(serializeSimDoc(doc({ ...DEFAULT_POLICY, funding: f })), 'strict').ok).toBe(
      true
    );
  });

  it('opCount counts funding', () => {
    const p: SimPolicy = {
      ...withBrushes([freehand('a', [stroke()])]),
      rules: [
        { id: 't', kind: 'transit', stopTypes: ['metro'], bands: [{ maxM: 402, stories: 6 }] }
      ],
      funding: fundingOnly()
    };
    expect(SIM_CODEC.opCount(doc(p))).toBe(5);
    expect(
      SIM_CODEC.opCount(
        doc({ ...DEFAULT_POLICY, funding: { ...fundingOnly(), terms: { lossOnExit: 0.1 } } })
      )
    ).toBe(4);
  });

  it('maxFunding with no strokes passes the limits and serialises under 32,768 bytes', () => {
    const d = doc({ ...DEFAULT_POLICY, funding: maxFunding() });
    expect(simDocProblems(d)).toEqual([]);
    expect(new TextEncoder().encode(serializeSimDoc(d)).byteLength).toBeLessThan(32_768);
  });
});
