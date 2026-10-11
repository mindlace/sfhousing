import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PLAN_BYTES, OPS_MAX, SF_BBOX } from './constants';
import {
  FUTURE_SCHEMA_MESSAGE,
  MIGRATIONS,
  emptyPlan,
  parsePlan,
  planByteSize,
  quantize,
  rebasePlan,
  runMigrations,
  serializePlan,
  validatePlan,
  type PlanErrorCode
} from './schema';
import type { Plan } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const DIR = join(process.cwd(), 'src/lib/plan/fixtures/plans');
const text = (name: string) => readFileSync(join(DIR, `${name}.json`), 'utf8');
const PT: [number, number] = [-122.418319, 37.760754];
const base = () => ({
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [{ id: 'a', kind: 'paint', stories: 5, radiusM: 25, path: [PT] }] as unknown[]
});

function errorsOf(raw: unknown): [string, PlanErrorCode][] {
  const r = validatePlan(raw);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
}
function withOp(patch: Record<string, unknown>, drop: string[] = []) {
  const op: Record<string, unknown> = {
    id: 'a',
    kind: 'paint',
    stories: 5,
    radiusM: 25,
    path: [PT],
    ...patch
  };
  for (const k of drop) delete op[k];
  return { ...base(), ops: [op] };
}

describe('quantize', () => {
  it('rounds to 1e-6 and is idempotent', () => {
    expect(quantize(-122.41831949)).toBe(-122.418319);
    expect(quantize(37.7607535)).toBe(37.760754);
    expect(quantize(quantize(37.12345678))).toBe(quantize(37.12345678));
  });
});

describe('validatePlan: one test per §4.6 row', () => {
  it('root must be a plain object', () => {
    for (const raw of [null, [], 'str', 3, true])
      expect(errorsOf(raw)).toEqual([['', 'not-object']]);
  });

  it('schema: missing → unknown-schema; future → future-schema; non-1 after migration → unknown-schema', () => {
    const noSchema: Record<string, unknown> = base();
    delete noSchema.schema;
    expect(errorsOf(noSchema)).toEqual([['/schema', 'unknown-schema']]);
    expect(errorsOf({ ...base(), schema: 2 })).toEqual([['/schema', 'future-schema']]);
    for (const s of [0, '1', 1.5, null])
      expect(errorsOf({ ...base(), schema: s })).toEqual([['/schema', 'unknown-schema']]);
  });

  it('datasetVersion must match DATASET_VERSION_RE', () => {
    for (const v of ['', 'latest', '2026-10-01-XYZ', 7, undefined])
      expect(errorsOf({ ...base(), datasetVersion: v })).toEqual([
        ['/datasetVersion', 'bad-field']
      ]);
    expect(validatePlan({ ...base(), datasetVersion: '2026-10-01-0a1b2c3d' }).ok).toBe(true);
  });

  it('title: trimmed, ≤ 120 chars, empty dropped, non-string rejected', () => {
    const ok = validatePlan({ ...base(), title: '  hi  ' });
    expect(ok.ok && ok.value.title).toBe('hi');
    const blank = validatePlan({ ...base(), title: '   ' });
    expect(blank.ok && 'title' in blank.value).toBe(false);
    expect(validatePlan({ ...base(), title: 'x'.repeat(120) }).ok).toBe(true);
    expect(errorsOf({ ...base(), title: 'x'.repeat(121) })).toEqual([['/title', 'bad-field']]);
    expect(errorsOf({ ...base(), title: null })).toEqual([['/title', 'bad-field']]);
  });

  it('ops: must be an array of ≤ OPS_MAX, and a huge array is rejected without per-op work', () => {
    expect(errorsOf({ ...base(), ops: 'x' })).toEqual([['/ops', 'bad-field']]);
    const huge = new Array(1_000_000).fill(null);
    const t0 = performance.now();
    expect(errorsOf({ ...base(), ops: huge })).toEqual([['/ops', 'too-many-ops']]);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(errorsOf({ ...base(), ops: new Array(OPS_MAX + 1).fill(null) })).toEqual([
      ['/ops', 'too-many-ops']
    ]);
  });

  it('op must be an object; op.kind must be paint or erase', () => {
    expect(errorsOf({ ...base(), ops: [null] })).toEqual([['/ops/0', 'bad-field']]);
    expect(errorsOf(withOp({ kind: 'area' }))).toEqual([['/ops/0/kind', 'bad-field']]);
  });

  it('op.id: 1–32 chars of [A-Za-z0-9_-], unique', () => {
    for (const id of ['', 'x'.repeat(33), 'a b', 'é', 5])
      expect(errorsOf(withOp({ id }))).toEqual([['/ops/0/id', 'bad-field']]);
    expect(validatePlan(withOp({ id: 'A-z_09'.padEnd(32, 'x') })).ok).toBe(true);
    const dup = { ...base(), ops: [base().ops[0], base().ops[0]] };
    expect(errorsOf(dup)).toEqual([['/ops/1/id', 'duplicate-id']]);
  });

  it('op.stories: paint needs an integer 1–80; erase drops it', () => {
    expect(errorsOf(withOp({}, ['stories']))).toEqual([['/ops/0/stories', 'bad-field']]);
    expect(errorsOf(withOp({ stories: '5' }))).toEqual([['/ops/0/stories', 'bad-field']]);
    for (const s of [0, 81, 2.5, Number.NaN])
      expect(errorsOf(withOp({ stories: s }))).toEqual([['/ops/0/stories', 'out-of-bounds']]);
    for (const s of [1, 80]) expect(validatePlan(withOp({ stories: s })).ok).toBe(true);
    const e = validatePlan(withOp({ kind: 'erase', stories: 999 }));
    expect(e.ok && 'stories' in e.value.ops[0]).toBe(false);
  });

  it('op.radiusM: integer 5–500', () => {
    for (const r of [4, 501, 10.5])
      expect(errorsOf(withOp({ radiusM: r }))).toEqual([['/ops/0/radiusM', 'out-of-bounds']]);
    expect(errorsOf(withOp({}, ['radiusM']))).toEqual([['/ops/0/radiusM', 'bad-field']]);
    for (const r of [5, 500]) expect(validatePlan(withOp({ radiusM: r })).ok).toBe(true);
  });

  it('op.path: 1–2000 finite [lng, lat] points inside SF_BBOX', () => {
    expect(errorsOf(withOp({ path: 'x' }))).toEqual([['/ops/0/path', 'bad-field']]);
    expect(errorsOf(withOp({ path: [] }))).toEqual([['/ops/0/path', 'bad-field']]);
    expect(errorsOf(withOp({ path: new Array(2001).fill(PT) }))).toEqual([
      ['/ops/0/path', 'too-many-points']
    ]);
    expect(validatePlan(withOp({ path: new Array(2000).fill(PT) })).ok).toBe(true);
    expect(errorsOf(withOp({ path: [PT, [1]] }))).toEqual([['/ops/0/path/1', 'bad-field']]);
    expect(errorsOf(withOp({ path: [['a', 37.7]] }))).toEqual([['/ops/0/path/0', 'bad-field']]);
    expect(errorsOf(withOp({ path: [[Infinity, 37.7]] }))).toEqual([
      ['/ops/0/path/0', 'out-of-bounds']
    ]);
    expect(errorsOf(withOp({ path: [[-122.0, 37.7]] }))).toEqual([
      ['/ops/0/path/0', 'out-of-bounds']
    ]);
    expect(
      validatePlan(
        withOp({
          path: [
            [SF_BBOX[0], SF_BBOX[1]],
            [SF_BBOX[2], SF_BBOX[3]]
          ]
        })
      ).ok
    ).toBe(true);
  });

  it('whole plan: planByteSize ≤ MAX_PLAN_BYTES (too-large generated in the test)', () => {
    const path = new Array(5).fill(PT);
    const ops = Array.from({ length: 3000 }, (_, k) => ({
      id: `o${k}`,
      kind: 'paint',
      stories: 5,
      radiusM: 25,
      path
    }));
    expect(errorsOf({ ...base(), ops })).toEqual([['', 'too-large']]);
  });

  it('reports every failure, with JSON-pointer paths, all-or-nothing', () => {
    const raw = {
      schema: 1,
      datasetVersion: 'bad',
      title: 3,
      ops: [
        { id: 'a', kind: 'paint', stories: 99, radiusM: 1, path: [[0, 0]] },
        { id: 'a', kind: 'erase', radiusM: 10, path: [PT] }
      ]
    };
    expect(errorsOf(raw)).toEqual([
      ['/datasetVersion', 'bad-field'],
      ['/title', 'bad-field'],
      ['/ops/0/stories', 'out-of-bounds'],
      ['/ops/0/radiusM', 'out-of-bounds'],
      ['/ops/0/path/0', 'out-of-bounds'],
      ['/ops/1/id', 'duplicate-id']
    ]);
  });
});

describe('parsePlan', () => {
  it('rejects non-JSON', () => {
    for (const s of ['', '{', 'undefined']) {
      const r = parsePlan(s);
      expect(r.ok === false && r.errors[0].code).toBe('not-json');
    }
  });

  it('future-schema carries the default copy', () => {
    const r = parsePlan(text('future-schema'));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        { path: '/schema', code: 'future-schema', message: FUTURE_SCHEMA_MESSAGE }
      ]);
    expect(FUTURE_SCHEMA_MESSAGE).toBe(
      'This plan was made with a newer version of SF Housing Simulator. Reload the page to get the latest version.'
    );
  });

  it('accepts every valid fixture, and they round-trip canonically', () => {
    for (const name of ['empty', 'single-stamp', 'paint-then-erase', 'overlap-lower-wins']) {
      const compact = JSON.stringify(JSON.parse(text(name)));
      const r = parsePlan(compact);
      expect(r.ok).toBe(true);
      if (r.ok) expect(serializePlan(r.value)).toBe(compact);
    }
  });

  it('quantises unquantised input and trims the title', () => {
    const r = parsePlan(text('unquantised'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Mission upzone');
    expect(r.value.ops[0].path).toEqual([
      [-122.418319, 37.760754],
      [-122.418, 37.761]
    ]);
  });

  it('drops unknown fields, including stories on an erase op', () => {
    const r = parsePlan(text('unknown-fields'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializePlan(r.value)).toBe(
      '{"schema":1,"datasetVersion":"fixture-0","ops":[' +
        '{"id":"e1","kind":"erase","radiusM":10,"path":[[-122.418319,37.760754]]},' +
        '{"id":"p1","kind":"paint","stories":2,"radiusM":10,"path":[[-122.418319,37.760754]]}]}'
    );
  });
});

describe('serializePlan', () => {
  it('emits fixed key order with title between datasetVersion and ops', () => {
    const p: Plan = {
      ops: [{ path: [PT], radiusM: 9, kind: 'paint', stories: 3, id: 'z' }],
      title: 'T',
      datasetVersion: 'fixture-1',
      schema: 1
    };
    expect(serializePlan(p)).toBe(
      '{"schema":1,"datasetVersion":"fixture-1","title":"T","ops":[{"id":"z","kind":"paint","stories":3,"radiusM":9,"path":[[-122.418319,37.760754]]}]}'
    );
  });

  it('planByteSize counts UTF-8 bytes', () => {
    const p: Plan = { ...emptyPlan('fixture-0'), title: 'é' };
    expect(planByteSize(p)).toBe(new TextEncoder().encode(serializePlan(p)).byteLength);
    expect(planByteSize(p)).toBe(serializePlan(p).length + 1);
    expect(MAX_PLAN_BYTES).toBe(262_144);
  });

  it('P4: parse(serialize(p)) ≡ p for arbitrary valid plans', () => {
    const micro = (min: number, max: number) =>
      fc.integer({ min: Math.round(min * 1e6), max: Math.round(max * 1e6) }).map((k) => k / 1e6);
    const point = fc.tuple(micro(SF_BBOX[0], SF_BBOX[2]), micro(SF_BBOX[1], SF_BBOX[3]));
    const path = fc.array(point, { minLength: 1, maxLength: 20 });
    const radiusM = fc.integer({ min: 5, max: 500 });
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('paint' as const),
        stories: fc.integer({ min: 1, max: 80 }),
        radiusM,
        path
      }),
      fc.record({ kind: fc.constant('erase' as const), radiusM, path })
    );
    const arbPlan = fc.record(
      {
        schema: fc.constant(1 as const),
        datasetVersion: fc.oneof(
          fc.nat(99).map((n) => `fixture-${n}`),
          fc.constant('2026-10-01-0a1b2c3d')
        ),
        title: fc
          .string({ minLength: 1, maxLength: 120 })
          .filter((s) => s.trim() === s && s.length > 0),
        ops: fc
          .array(op, { maxLength: 30 })
          .map((ops) => ops.map((o, k) => ({ ...o, id: `id_${k}` })))
      },
      { requiredKeys: ['schema', 'datasetVersion', 'ops'] }
    );
    fc.assert(
      fc.property(arbPlan, (p) => {
        const r = parsePlan(serializePlan(p as Plan));
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value).toEqual(p);
          expect(serializePlan(r.value)).toBe(serializePlan(p as Plan));
        }
      }),
      FC
    );
  });
});

describe('migration', () => {
  it('MIGRATIONS is empty in M1', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('MIGRATIONS is frozen', () => {
    expect(Object.isFrozen(MIGRATIONS)).toBe(true);
  });

  it('runMigrations chains a registry up to the target', () => {
    const registry = {
      1: (r: Record<string, unknown>) => ({ ...r, schema: 2, a: true }),
      2: (r: Record<string, unknown>) => ({ ...r, schema: 3, b: true })
    };
    expect(runMigrations({ schema: 1 }, registry, 3)).toEqual({ schema: 3, a: true, b: true });
    expect(runMigrations({ schema: 2 }, registry, 3)).toEqual({ schema: 3, b: true });
    expect(() => runMigrations({ schema: 1 }, { 1: (r) => r }, 2)).toThrow(/schema 2/);
  });
});

describe('rebasePlan / emptyPlan', () => {
  it('rebasePlan returns a copy with the new version and the same ops, leaving the input alone', () => {
    const p: Plan = {
      ...emptyPlan('fixture-0'),
      ops: [{ id: 'a', kind: 'erase', radiusM: 5, path: [PT] }]
    };
    const before = serializePlan(p);
    const q = rebasePlan(p, '2026-10-01-0a1b2c3d');
    expect(q).not.toBe(p);
    expect(q.datasetVersion).toBe('2026-10-01-0a1b2c3d');
    expect(q.ops).toEqual(p.ops);
    expect(serializePlan(p)).toBe(before);
  });

  it('rebasePlan does not share the ops array with its input', () => {
    const p: Plan = emptyPlan('fixture-0');
    const q = rebasePlan(p, '2026-10-01-0a1b2c3d');
    q.ops.push({ id: 'x', kind: 'erase', radiusM: 5, path: [PT] });
    expect(p.ops).toHaveLength(0);
  });

  it('emptyPlan, and both reject a bad version', () => {
    expect(emptyPlan('fixture-3')).toEqual({ schema: 1, datasetVersion: 'fixture-3', ops: [] });
    expect(() => emptyPlan('latest')).toThrow(TypeError);
    expect(() => rebasePlan(emptyPlan('fixture-0'), 'latest')).toThrow(TypeError);
  });
});

describe('validatePlan is total on hostile JSON', () => {
  const deep = (n = 8000) => JSON.parse('['.repeat(n) + ']'.repeat(n)) as unknown;
  const codes = (r: ReturnType<typeof validatePlan>) => (r.ok ? [] : r.errors.map((e) => e.code));

  it('does not throw on a deeply nested schema', () => {
    const r = parsePlan('{"schema":' + '['.repeat(8000) + ']'.repeat(8000) + '}');
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.map((e) => [e.path, e.code])).toEqual([
      ['/schema', 'unknown-schema']
    ]);
  });

  it('does not throw on deep values in title, op fields and path points', () => {
    expect(validatePlan({ ...base(), title: deep() }).ok).toBe(false);
    expect(validatePlan(withOp({ stories: deep() })).ok).toBe(false);
    expect(validatePlan(withOp({ path: [deep()] })).ok).toBe(false);
    expect(codes(validatePlan({ ...base(), schema: Number.POSITIVE_INFINITY }))).toEqual([
      'unknown-schema'
    ]);
  });

  it('never throws for arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const r = validatePlan(v);
        expect(typeof r.ok).toBe('boolean');
      }),
      FC
    );
  });

  it('never throws when one field of a valid plan is overwritten with arbitrary JSON', () => {
    const fields = ['schema', 'datasetVersion', 'title', 'ops'] as const;
    const opFields = ['id', 'kind', 'stories', 'radiusM', 'path'] as const;
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.boolean(),
        fc.nat(fields.length - 1),
        fc.nat(opFields.length - 1),
        (v, atRoot, fi, oi) => {
          const plan = base() as Record<string, unknown>;
          if (atRoot) plan[fields[fi]] = v;
          else (plan.ops as Record<string, unknown>[])[0][opFields[oi]] = v;
          expect(typeof validatePlan(plan).ok).toBe('boolean');
        }
      ),
      FC
    );
  });
});
