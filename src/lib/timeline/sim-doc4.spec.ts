import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUTURE_SCHEMA_MESSAGE, MAX_PLAN_BYTES, OPS_MAX } from '$lib/plan';
import { baselineFixture, FIXTURE_AS_OF, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { readRecord, type LocalPlanRecord } from '$lib/sharing/storage';
import { paintedText, simDoc } from '$lib/server/test/sim-docs';
import { CODECS } from '$lib/server/sharing/codecs';
import { DEFAULT_POLICY, SCHEMA2_PUBLISH_MESSAGE, SIM_CODEC, SIM_KEY } from '$lib/sim-page/sim-doc';
import { serializeSimDoc } from '$lib/sim-page/sim-doc';
import type { CustomBrush, SimPolicy, Stroke } from '$lib/sim-page/policy';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Programme } from '$lib/timelapse/types';
import { DEFAULT_POLICY4, nothingInForce, type Effect, type Policy } from './policy4';
import type { SimPolicy4 } from './policy4';
import { reconcilePolicy4 } from './reconcile4';
import { upgradePolicy } from './upgrade';
import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
import {
  SIM_DOC4_SCHEMA,
  SIM_KEY4,
  createSimCodec4,
  migrateSimAutosave,
  openSimDoc4,
  parseSimDoc4,
  serializeSimDoc4,
  simDoc4Problems,
  type OpenDataset,
  type SimDoc4
} from './sim-doc4';

const AS_OF = FIXTURE_AS_OF;
const FROM = monthFirstDay(AS_OF, 1);
const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const ds: OpenDataset = { asOf: AS_OF, calibration: cal };

const stored = (name: string) =>
  readFileSync(new URL(`../sim-page/fixtures/schema2/${name}`, import.meta.url), 'utf8');

const stroke = (n = 2): Stroke => ({
  path: Array.from({ length: n }, (_, i) => [-122.4 + i * 1e-5, 37.7] as [number, number]),
  radiusM: 50
});
const brush = (id: string, strokes: Stroke[]): CustomBrush => ({
  id,
  kind: 'paint',
  strokes,
  stories: 6
});
const pol = (
  id: string,
  where: Policy['where'],
  what: Effect,
  over: Partial<Policy> = {}
): Policy => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans: [{ from: FROM, to: null, what }],
  ...over
});
const painted4 = (...strokeCounts: number[]): SimPolicy4 => ({
  schema: 4,
  kinds: {
    ...DEFAULT_POLICY4.kinds,
    zoning: strokeCounts.map((n, i) =>
      pol(`p${i}`, { tag: 'painted' }, { tag: 'brushes', brushes: [brush(`b${i}`, [stroke(n)])] })
    )
  }
});
const doc4 = (policy: SimPolicy4 = painted4(3), extra: Partial<SimDoc4> = {}): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy,
  ...extra
});
const raw4 = (d: SimDoc4) => JSON.stringify(d);

/** A schema 3 policy with paint, timing and funding. */
const F = fundingOnly();
const BENCH = {
  preset: 'benchmarkPermits' as const,
  presetTimers: [
    {
      pathway: 'discretionary' as const,
      stage: 'permitFiled' as const,
      scale: 0.4786,
      reach: 'all' as const
    }
  ],
  presetRouteShares: null,
  edits: [],
  routeShares: null,
  localProgramStreamlined: true
};
const policy3 = (): SimPolicy => ({
  ...DEFAULT_POLICY,
  custom: [brush('a', [stroke(3)])],
  timing: { current: BENCH, saved: null },
  funding: F
});
const text3 = (p: SimPolicy = policy3()) => serializeSimDoc(simDoc(p));

describe('strict parseSimDoc4', () => {
  it('refuses schema 3 and 2 with the publish message and schema 5 as future', () => {
    const r3 = parseSimDoc4(text3(), AS_OF);
    expect(r3).toEqual({
      ok: false,
      errors: [{ path: '/schema', code: 'unknown-schema', message: SCHEMA2_PUBLISH_MESSAGE }]
    });
    const r2 = parseSimDoc4(stored('painted.json'), AS_OF);
    expect(r2).toEqual(r3);
    const r5 = parseSimDoc4(JSON.stringify({ ...doc4(), schema: 5 }), AS_OF);
    expect(r5).toEqual({
      ok: false,
      errors: [{ path: '/schema', code: 'future-schema', message: FUTURE_SCHEMA_MESSAGE }]
    });
  });

  it('reports shape errors with the usual codes', () => {
    expect(parseSimDoc4('nope', AS_OF)).toMatchObject({ errors: [{ code: 'not-json' }] });
    expect(parseSimDoc4('[]', AS_OF)).toMatchObject({ errors: [{ code: 'not-object' }] });
    expect(parseSimDoc4(raw4({ ...doc4(), kind: 'plan' as 'sim' }), AS_OF)).toMatchObject({
      errors: [{ path: '/kind', code: 'unknown-schema' }]
    });
    expect(parseSimDoc4(raw4(doc4(undefined, { datasetVersion: '!' })), AS_OF)).toMatchObject({
      errors: [{ path: '/datasetVersion', code: 'bad-field' }]
    });
    expect(parseSimDoc4(raw4(doc4(undefined, { title: 'x'.repeat(500) })), AS_OF)).toMatchObject({
      errors: [{ path: '/title', code: 'bad-field' }]
    });
  });

  it('accepts a good document, trims the title and drops an empty one', () => {
    const r = parseSimDoc4(raw4(doc4(undefined, { title: '  Mine  ' })), null);
    expect(r.ok && r.value.title).toBe('Mine');
    const e = parseSimDoc4(raw4(doc4(undefined, { title: '   ' })), null);
    expect(e.ok && 'title' in e.value).toBe(false);
  });

  it('maps a policy error to a JSON pointer', () => {
    const d = doc4(painted4(2));
    const bad = JSON.parse(raw4(d));
    bad.policy.kinds.zoning[0].spans.push({ ...bad.policy.kinds.zoning[0].spans[0], from: 'x' });
    bad.policy.kinds.zoning[0].spans[0].to = FROM + 40;
    const r = parseSimDoc4(JSON.stringify(bad), null);
    expect(r).toMatchObject({
      ok: false,
      errors: [{ path: '/policy/kinds/zoning/0/spans/1/from', code: 'bad-field' }]
    });
  });

  it('refuses a programme with a term gap at its pointer', () => {
    const prog: Programme = { ...F.programmes[0], pool: 'u-pool-1' };
    const gap = {
      ...prog,
      instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 }
    } as Programme;
    const money = pol(
      'fund-u-pool-1',
      { tag: 'fund', pool: 'u-pool-1' },
      { tag: 'fund', pool: F.pools[0], programmes: [gap] }
    );
    const d = doc4({ schema: 4, kinds: { zoning: [], permitting: [], money: [money] } });
    const r = parseSimDoc4(raw4(d), null);
    expect(r).toMatchObject({ ok: false, errors: [{ code: 'bad-field' }] });
    if (!r.ok) {
      expect(r.errors[0].path).toBe('/policy/kinds/money/0/spans/0/what/programmes/0');
    }
  });

  it('refuses too many strokes across all painted spans', () => {
    const policy = painted4(1, 1);
    const many = Array.from({ length: OPS_MAX }, () => stroke(1));
    const b = policy.kinds.zoning[0].spans[0].what;
    if (b.tag !== 'brushes') throw new Error('fixture');
    b.brushes[0].strokes = many;
    const r = parseSimDoc4(raw4(doc4(policy)), null);
    expect(r).toMatchObject({ ok: false, errors: [{ path: '/policy', code: 'too-many-ops' }] });
  });

  it('refuses a stroke radius out of range', () => {
    const policy = painted4(2);
    const w = policy.kinds.zoning[0].spans[0].what;
    if (w.tag !== 'brushes') throw new Error('fixture');
    w.brushes[0].strokes[0].radiusM = 1;
    const problems = simDoc4Problems(doc4(policy));
    expect(problems).toMatchObject([
      {
        path: '/policy/kinds/zoning/0/spans/0/what/brushes/0/strokes/0/radiusM',
        code: 'out-of-bounds'
      }
    ]);
  });

  it('refuses a document over MAX_PLAN_BYTES as too-large', () => {
    const policy = painted4(1);
    const w = policy.kinds.zoning[0].spans[0].what;
    if (w.tag !== 'brushes') throw new Error('fixture');
    const long = 'x'.repeat(MAX_PLAN_BYTES);
    policy.kinds.zoning[0].label = long;
    expect(w.tag).toBe('brushes');
    const problems = simDoc4Problems(doc4(policy));
    expect(problems).toMatchObject([{ path: '', code: 'too-large' }]);
  });

  it('serializes stably under key order and round-trips', () => {
    const d = doc4(painted4(3), { title: 'T' });
    const text = serializeSimDoc4(d);
    const shuffled = JSON.stringify({
      policy: d.policy,
      title: d.title,
      datasetVersion: d.datasetVersion,
      kind: d.kind,
      schema: d.schema
    });
    const a = parseSimDoc4(shuffled, null);
    expect(a.ok && serializeSimDoc4(a.value)).toBe(text);
    const b = parseSimDoc4(text, null);
    expect(b.ok && b.value).toEqual(d);
    expect(SIM_DOC4_SCHEMA).toBe(4);
  });

  it('quantizes strokes on serialize', () => {
    const policy = painted4(1);
    const w = policy.kinds.zoning[0].spans[0].what;
    if (w.tag !== 'brushes') throw new Error('fixture');
    w.brushes[0].strokes[0].path = [[-122.4000001234, 37.7000004321]];
    const text = serializeSimDoc4(doc4(policy));
    expect(text).toContain('[[-122.4,37.7]]');
  });
});

describe('openSimDoc4', () => {
  it('upgrades and reconciles a schema 3 body', () => {
    const p = policy3();
    const r = openSimDoc4(text3(p), ds);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.upgradedFrom).toBe(3);
    const want = reconcilePolicy4(upgradePolicy(p, AS_OF), cal, AS_OF);
    expect(r.value.doc.policy).toEqual(want.doc);
    expect(r.value.report).toEqual(want.report);
    expect(r.value.doc.schema).toBe(4);
    expect(r.value.doc.datasetVersion).toBe('fixture-0');
  });

  it('opens schema 2 bodies as upgradedFrom 2', () => {
    const r = openSimDoc4(stored('painted.json'), ds);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.upgradedFrom).toBe(2);
    expect(nothingInForce(r.value.doc.policy)).toBe(false);
  });

  it('opens a schema 4 body without upgradedFrom', () => {
    const r = openSimDoc4(raw4(doc4()), ds);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.upgradedFrom).toBeUndefined();
    expect(r.value.doc.policy).toEqual(reconcilePolicy4(doc4().policy, cal, AS_OF).doc);
  });

  it('opens a schema 4 body saved on an earlier dataset, re-aligned, and strict refuses it', () => {
    const early = AS_OF - 400;
    const p = painted4(3);
    p.kinds.zoning[0].spans = [
      {
        from: monthFirstDay(early, 1),
        to: monthLastDay(early, 6),
        what: p.kinds.zoning[0].spans[0].what
      },
      { from: monthFirstDay(early, 25), to: null, what: p.kinds.zoning[0].spans[0].what }
    ];
    const body = raw4(doc4(p));
    const r = openSimDoc4(body, ds);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const spans = r.value.doc.policy.kinds.zoning[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].from).toBe(
      monthFirstDay(AS_OF, monthOfDay(AS_OF, p.kinds.zoning[0].spans[1].from))
    );
    expect(r.value.report.spans.map((x) => [x.index, x.change])).toEqual([
      [1, 'moved'],
      [0, 'dropped']
    ]);
    const strict = parseSimDoc4(body, AS_OF);
    expect(strict).toMatchObject({
      ok: false,
      errors: [{ path: '/policy/kinds/zoning/0/spans/0/from' }]
    });
  });

  it('drops a programme on an unknown pool and reports it', () => {
    const prog: Programme = { ...F.programmes[0], id: 'u-orphan', pool: 'no-such-pool' };
    const money = pol(
      'fund-no-such-pool',
      { tag: 'fund', pool: 'no-such-pool' },
      { tag: 'fund', pool: null, programmes: [prog] }
    );
    const d = doc4({ schema: 4, kinds: { zoning: [], permitting: [], money: [money] } });
    const r = openSimDoc4(raw4(d), ds);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.report.funding.droppedProgrammes.map((x) => x.id)).toEqual(['u-orphan']);
  });

  it('fails a future schema and bad bodies', () => {
    expect(openSimDoc4(JSON.stringify({ ...doc4(), schema: 5 }), ds)).toMatchObject({
      ok: false,
      errors: [{ code: 'future-schema' }]
    });
    expect(openSimDoc4('nope', ds)).toMatchObject({ ok: false });
    expect(openSimDoc4(JSON.stringify({ schema: 1 }), ds)).toMatchObject({ ok: false });
  });
});

describe('createSimCodec4', () => {
  const codec = createSimCodec4(ds);

  it('describes the document', () => {
    expect(codec.kind).toBe('sim');
    expect(codec.storageKey).toBe(SIM_KEY4);
    expect(SIM_KEY4).toBe('sfhousing:sim:v2');
    expect(codec.api).toBe('/api/policies');
    expect(codec.path('Abc')).toBe('/s/Abc');
    expect(codec.empty('fixture-0')).toEqual({
      schema: 4,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: DEFAULT_POLICY4
    });
    expect(codec.isEmpty(codec.empty('fixture-0'))).toBe(true);
    expect(codec.isEmpty(doc4())).toBe(false);
    const d = doc4();
    expect(codec.publishable(d)).toEqual(d);
    expect(codec.schema(d)).toBe(4);
    expect(codec.datasetVersion(d)).toBe('fixture-0');
    expect(codec.rebase(d, 'fixture-1').datasetVersion).toBe('fixture-1');
    expect(codec.withTitle(d, ' Hi ').title).toBe('Hi');
    expect('title' in codec.withTitle(codec.withTitle(d, 'Hi'), undefined)).toBe(false);
    expect(codec.title(codec.withTitle(d, 'Hi'))).toBe('Hi');
    expect(codec.opCount(d)).toBeGreaterThan(0);
    expect(codec.corruptKey('t')).toBe('sfhousing:sim:corrupt:t');
  });

  it('parse is strict and load opens', () => {
    expect(codec.parse(text3()).ok).toBe(false);
    expect(codec.parse(raw4(doc4())).ok).toBe(true);
    expect(codec.load(text3()).ok).toBe(true);
    expect(codec.load(paintedText()).ok).toBe(true);
  });

  it('a stored schema 3 body loads from the v2 key', () => {
    const s = new MemoryStorage();
    const rec: LocalPlanRecord = { v: 1, savedAt: '2026-11-01T00:00:00.000Z', plan: text3() };
    s.setItem(SIM_KEY4, JSON.stringify(rec));
    const r = readRecord(s, codec);
    expect(r).toMatchObject({ kind: 'ok', upgradedFrom: 3 });
  });
});

describe('migrateSimAutosave', () => {
  const rec = (plan: string, extra: Partial<LocalPlanRecord> = {}): string =>
    JSON.stringify({ v: 1, savedAt: '2026-11-01T00:00:00.000Z', plan, ...extra });

  it('migrates v1 to v2 carrying savedAt and lastPublished, leaving v1', () => {
    const s = new MemoryStorage();
    const lp = { id: 'Abcdefg2', hash: 'h' };
    const v1 = rec(text3(), { lastPublished: lp });
    s.setItem(SIM_KEY, v1);
    expect(migrateSimAutosave(s, ds)).toBe('migrated');
    expect(s.getItem(SIM_KEY)).toBe(v1);
    const v2 = JSON.parse(s.getItem(SIM_KEY4) as string);
    expect(v2.v).toBe(1);
    expect(v2.savedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(v2.lastPublished).toEqual(lp);
    const opened = openSimDoc4(text3(), ds);
    if (!opened.ok) throw new Error('fixture');
    expect(v2.plan).toBe(serializeSimDoc4(opened.value.doc));
    expect(JSON.parse(v2.plan).schema).toBe(4);
  });

  it('keeps a v2 record already present', () => {
    const s = new MemoryStorage();
    s.setItem(SIM_KEY, rec(text3()));
    const v2 = rec(raw4(doc4()));
    s.setItem(SIM_KEY4, v2);
    expect(migrateSimAutosave(s, ds)).toBe('kept');
    expect(s.getItem(SIM_KEY4)).toBe(v2);
  });

  it('does nothing with neither key', () => {
    const s = new MemoryStorage();
    expect(migrateSimAutosave(s, ds)).toBe('none');
    expect(s.getItem(SIM_KEY4)).toBeNull();
  });

  it('writes nothing for a corrupt v1', () => {
    const s = new MemoryStorage();
    s.setItem(SIM_KEY, 'not json');
    expect(migrateSimAutosave(s, ds)).toBe('none');
    s.setItem(SIM_KEY, rec('{"schema":3}'));
    expect(migrateSimAutosave(s, ds)).toBe('none');
    expect(s.getItem(SIM_KEY4)).toBeNull();
  });

  it('migrates the stored schema 2 default record', () => {
    const s = new MemoryStorage();
    s.setItem(SIM_KEY, stored('default-record.json'));
    expect(migrateSimAutosave(s, ds)).toBe('migrated');
    expect(readRecord(s, createSimCodec4(ds)).kind).toBe('ok');
  });
});

describe('nothing is switched on', () => {
  it('keeps the v1 codec in place', () => {
    expect(SIM_CODEC.storageKey).toBe('sfhousing:sim:v1');
    expect(CODECS.sim).toBe(SIM_CODEC);
  });
});
