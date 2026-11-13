import { describe, expect, it } from 'vitest';
import { FIXTURE_AS_OF, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import { PolicyFormatError } from '$lib/sim-page/policy';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
import { parsePolicy4 } from './parse4';

const AS_OF = FIXTURE_AS_OF;
const first = (m: number) => monthFirstDay(AS_OF, m);
const last = (m: number) => monthLastDay(AS_OF, m);
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const span = (from: number, to: number | null, what: J): J => ({ from, to, what });
const open = (what: J, m = 1): J => span(first(m), null, what);

const stroke = { path: [[-122.4, 37.7]], radiusM: 50 };
const bandsW = (stories = 6): J => ({ tag: 'bands', bands: [{ maxM: 402, stories }] });
const brushesW = (): J => ({
  tag: 'brushes',
  brushes: [{ id: 'b1', kind: 'paint', strokes: [stroke], stories: 5 }]
});
const timingSet = (): J => structuredClone(OBSERVED_TIMING.current);
const timingW = (): J => ({ tag: 'timing', set: timingSet() });
const fundF = fundingOnly();
const poolOf = (id: string): J => ({ ...structuredClone(fundF.pools[0]), id });
const progOf = (id: string, pool: string): J => ({
  ...structuredClone(fundF.programmes[0]),
  id,
  pool
});
const fundW = (pool: string, programmes: string[] = ['u-prog-1']): J => ({
  tag: 'fund',
  pool: poolOf(pool),
  programmes: programmes.map((g) => progOf(g, pool))
});
const scaleEntry = (pool: string, from: number, scale = 1): J => ({ pool, from, scale });

const pol = (id: string, where: J, spans: J[], over: J = {}): J => ({
  id,
  label: id,
  preset: null,
  on: true,
  where,
  spans,
  ...over
});
const transit = (id = 'z1', spans: J[] = [open(bandsW())]): J =>
  pol(id, { tag: 'transit', stopTypes: ['metro'] }, spans);
const painted = (id = 'z2', spans: J[] = [open(brushesW())]): J =>
  pol(id, { tag: 'painted' }, spans);
const category = (id: string, c: string, years: number | null): J =>
  pol(id, { tag: 'category', category: c }, [open({ tag: 'protect', years })]);
const routes = (id = 'p1', spans: J[] = [open(timingW())]): J =>
  pol(id, { tag: 'routes' }, spans, { preset: 'observed' });
const baseline = (id = 'm1', entries: J[] = [scaleEntry('state', AS_OF + 400, 2)]): J =>
  pol(id, { tag: 'baseline' }, [open({ tag: 'scales', entries })]);
const fund = (id: string, pool: string, spans?: J[]): J =>
  pol(
    id,
    { tag: 'fund', pool },
    spans ?? [open(fundW(pool, [`${pool}-g`.replace('u-pool', 'u-prog')]))]
  );
const terms = (id = 'm3'): J =>
  pol(id, { tag: 'terms' }, [open({ tag: 'terms', terms: { constructionYears: 2 } })]);

const doc = (z: J[] = [], p: J[] = [], m: J[] = []): J => ({
  schema: 4,
  kinds: { zoning: z, permitting: p, money: m }
});

const rejects = (
  d: unknown,
  path: string,
  message?: string,
  opts: Parameters<typeof parsePolicy4>[1] = { asOf: AS_OF }
) => {
  try {
    parsePolicy4(d, opts);
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyFormatError);
    expect((e as PolicyFormatError).path).toBe(path);
    if (message !== undefined) expect((e as PolicyFormatError).message).toContain(message);
    return;
  }
  expect.unreachable('should have thrown');
};
const parses = (d: unknown, opts: Parameters<typeof parsePolicy4>[1] = { asOf: AS_OF }) =>
  expect(() => parsePolicy4(d, opts)).not.toThrow();

describe('shape', () => {
  it('parses the empty document', () => {
    expect(parsePolicy4(doc(), { asOf: AS_OF })).toEqual(doc());
  });
  it('rejects unknown and missing keys at every level', () => {
    rejects({ ...doc(), extra: 1 }, 'extra', 'unknown key');
    rejects({ schema: 4 }, 'kinds', 'missing');
    rejects({ schema: 4, kinds: { zoning: [], permitting: [] } }, 'kinds.money', 'missing');
    rejects({ schema: 4, kinds: { ...doc().kinds, x: [] } }, 'kinds.x', 'unknown key');
    rejects(doc([{ ...transit(), extra: 1 }]), 'kinds.zoning[0].extra', 'unknown key');
    const noLabel = transit();
    delete noLabel.label;
    rejects(doc([noLabel]), 'kinds.zoning[0].label', 'missing');
    rejects(
      doc([transit('z1', [{ from: 1, to: null }])]),
      'kinds.zoning[0].spans[0].what',
      'missing'
    );
    rejects(
      doc([transit('z1', [{ ...open(bandsW()), extra: 1 }])]),
      'kinds.zoning[0].spans[0].extra',
      'unknown key'
    );
    rejects(
      doc([transit('z1', [open({ ...bandsW(), extra: 1 })])]),
      'kinds.zoning[0].spans[0].what.extra',
      'unknown key'
    );
    const w = transit();
    w.where = { tag: 'transit', stopTypes: [], extra: 1 };
    rejects(doc([w]), 'kinds.zoning[0].where.extra', 'unknown key');
    rejects(doc([{ ...transit(), on: 1 }]), 'kinds.zoning[0].on', 'boolean');
    rejects(null, '$', 'expected an object');
  });
  it('rejects a schema that is not 4', () => {
    rejects({ ...doc(), schema: 3 }, 'schema', 'expected 4');
    rejects({ kinds: doc().kinds }, 'schema', 'expected 4');
  });
  it('rejects a where.tag not of its kind', () => {
    rejects(
      doc([pol('z', { tag: 'routes' }, [])]),
      'kinds.zoning[0].where.tag',
      'expected one of transit, painted, category'
    );
    rejects(
      doc([], [pol('p', { tag: 'transit', stopTypes: [] }, [], { preset: 'observed' })]),
      'kinds.permitting[0].where.tag'
    );
    rejects(doc([], [], [pol('m', { tag: 'painted' }, [])]), 'kinds.money[0].where.tag');
  });
  it('rejects a what.tag that does not pair with the where.tag', () => {
    rejects(doc([transit('z1', [open(brushesW())])]), 'kinds.zoning[0].spans[0].what.tag');
    rejects(
      doc([painted('z2', [span(first(1), last(1), brushesW()), open(bandsW(), 2)])]),
      'kinds.zoning[0].spans[1].what.tag'
    );
    rejects(doc([], [routes('p1', [open(bandsW())])]), 'kinds.permitting[0].spans[0].what.tag');
    rejects(
      doc(
        [],
        [],
        [baseline('m', [])].map((p) => ({ ...p, spans: [open(timingW())] }))
      ),
      'kinds.money[0].spans[0].what.tag'
    );
    rejects(
      doc(
        [],
        [],
        [terms('t')].map((p) => ({ ...p, spans: [open({ tag: 'scales', entries: [] })] }))
      ),
      'kinds.money[0].spans[0].what.tag'
    );
  });
});

describe('rule 1: preset', () => {
  it('a permitting policy names a preset every span carries', () => {
    rejects(doc([], [{ ...routes(), preset: null }]), 'kinds.permitting[0].preset');
    rejects(doc([], [{ ...routes(), preset: 'noDiscretionary' }]), 'kinds.permitting[0].preset');
    const second = timingW();
    second.set = {
      ...second.set,
      preset: 'noDiscretionary',
      presetRouteShares: { discretionary: 0, streamlined: 50, permitOnly: 50 }
    };
    rejects(
      doc([], [routes('p1', [span(first(1), last(1), timingW()), span(first(2), null, second)])]),
      'kinds.permitting[0].preset'
    );
  });
  it('a zoning or money policy has a null preset', () => {
    rejects(doc([{ ...transit(), preset: 'observed' }]), 'kinds.zoning[0].preset');
    rejects(doc([], [], [{ ...terms(), preset: 'observed' }]), 'kinds.money[0].preset');
  });
});

describe('rule 3: ids and label', () => {
  it('rejects a duplicate policy id across kinds', () => {
    rejects(doc([transit('x')], [routes('x')]), 'kinds.permitting[0].id', 'duplicate id');
    rejects(doc([transit('x'), painted('x')]), 'kinds.zoning[1].id', 'duplicate id');
  });
  it('bounds a policy id and a label', () => {
    rejects(doc([transit('')]), 'kinds.zoning[0].id');
    rejects(doc([transit('x'.repeat(81))]), 'kinds.zoning[0].id');
    parses(doc([transit('x'.repeat(80))]));
    rejects(doc([{ ...transit(), label: 'x'.repeat(81) }]), 'kinds.zoning[0].label', '80');
    parses(doc([{ ...transit(), label: ' ' + 'x'.repeat(79) + ' '.repeat(0) }]));
    expect(
      parsePolicy4(doc([{ ...transit(), label: '  padded  ' }]), { asOf: AS_OF }).kinds.zoning[0]
        .label
    ).toBe('  padded  ');
    parses(doc([{ ...transit(), label: '' }]));
  });
  it('rejects an added pool id or a programme id in two fund policies', () => {
    rejects(
      doc([], [], [fund('f1', 'u-pool-1'), fund('f2', 'u-pool-1')]),
      'kinds.money[1].spans[0].what.pool.id',
      'duplicate id'
    );
    const g2 = fund('f2', 'u-pool-2', [open(fundW('u-pool-2', ['u-prog-1']))]);
    rejects(
      doc([], [], [fund('f1', 'u-pool-1', [open(fundW('u-pool-1', ['u-prog-1']))]), g2]),
      'kinds.money[1].spans[0].what.programmes[0].id',
      'duplicate id'
    );
  });
  it('keeps one pool and one set of programme ids over the spans', () => {
    const w1 = fundW('u-pool-1', ['u-prog-1']);
    const settings = fundW('u-pool-1', ['u-prog-1']);
    settings.programmes[0].minHomes = 7;
    parses(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'u-pool-1' }, [
            span(first(1), last(2), w1),
            span(first(3), null, settings)
          ])
        ]
      )
    );
    const other = fundW('u-pool-1', ['u-prog-2']);
    rejects(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'u-pool-1' }, [
            span(first(1), last(2), w1),
            span(first(3), null, other)
          ])
        ]
      ),
      'kinds.money[0].spans[1].what.programmes'
    );
    const more = fundW('u-pool-1', ['u-prog-1', 'u-prog-2']);
    rejects(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'u-pool-1' }, [
            span(first(1), last(2), w1),
            span(first(3), null, more)
          ])
        ]
      ),
      'kinds.money[0].spans[1].what.programmes'
    );
    const wBase = fundW('u-pool-1');
    wBase.pool = null;
    wBase.programmes = [progOf('u-prog-1', 'city-a')];
    rejects(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'city-a' }, [
            span(first(1), last(2), wBase),
            span(first(3), null, { ...fundW('city-a'), pool: poolOf('city-a') })
          ])
        ]
      ),
      'kinds.money[0].spans[1].what.pool.id'
    );
  });
  it('a fund with no added pool draws every programme on its where.pool', () => {
    const w = {
      tag: 'fund',
      pool: null,
      programmes: [progOf('u-prog-1', 'city-a'), progOf('u-prog-2', 'city-b')]
    };
    rejects(
      doc([], [], [pol('f', { tag: 'fund', pool: 'city-a' }, [open(w)])]),
      'kinds.money[0].spans[0].what.programmes[1].pool'
    );
  });
  it('a fund with no spans still registers its added pool id', () => {
    const empty = (id: string, pool: string) => pol(id, { tag: 'fund', pool }, []);
    rejects(
      doc([], [], [empty('f1', 'u-pool-1'), empty('f2', 'u-pool-1')]),
      'kinds.money[1].where.pool',
      'duplicate id'
    );
    rejects(
      doc([], [], [empty('f1', 'u-pool-1'), fund('f2', 'u-pool-1')]),
      'kinds.money[1].spans[0].what.pool.id',
      'duplicate id'
    );
    const many = Array.from({ length: FINANCE_LIMITS.pools + 1 }, (_, i) =>
      empty(`f${i}`, `u-pool-${i}`)
    );
    rejects(doc([], [], many), 'kinds.money', 'pools');
  });
  it('ties a fund policy to its pool', () => {
    rejects(
      doc([], [], [pol('f', { tag: 'fund', pool: 'u-pool-2' }, [open(fundW('u-pool-1'))])]),
      'kinds.money[0].spans[0].what.pool.id',
      'u-pool-2'
    );
    rejects(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'u-pool-1' }, [
            open({ tag: 'fund', pool: null, programmes: [] })
          ])
        ]
      ),
      'kinds.money[0].where.pool',
      'baseline'
    );
    parses(
      doc(
        [],
        [],
        [
          pol('f', { tag: 'fund', pool: 'city-a' }, [
            open({ tag: 'fund', pool: null, programmes: [progOf('u-prog-1', 'city-a')] })
          ])
        ]
      )
    );
  });
});

describe('rule 4: days', () => {
  const z = (spans: J[]) => doc([transit('z1', spans)]);
  const b = bandsW;
  it('rejects a from off a month start and a to off a month end', () => {
    rejects(z([span(first(1) + 1, null, b())]), 'kinds.zoning[0].spans[0].from', 'first day');
    rejects(z([span(first(2) - 1, null, b())]), 'kinds.zoning[0].spans[0].from');
    rejects(z([span(first(1), last(1) - 1, b())]), 'kinds.zoning[0].spans[0].to', 'last day');
    rejects(z([span(first(1), last(1) + 1, b())]), 'kinds.zoning[0].spans[0].to');
    parses(z([span(first(1), last(1), b()), span(first(7), last(9), b(5))]));
  });
  it('rejects a from on or before the dataset date', () => {
    rejects(z([span(AS_OF, null, b())]), 'kinds.zoning[0].spans[0].from', 'after the dataset date');
    rejects(z([span(AS_OF - 100, null, b())]), 'kinds.zoning[0].spans[0].from');
    parses(z([span(AS_OF + 1, null, b())]));
  });
  it('rejects a to before its from', () => {
    rejects(z([span(first(3), last(2), b())]), 'kinds.zoning[0].spans[0].to');
  });
  it('rejects overlap, disorder and a span after an open one', () => {
    rejects(
      z([span(first(1), last(3), b()), span(first(3), null, b())]),
      'kinds.zoning[0].spans[1].from',
      'overlap'
    );
    rejects(
      z([span(first(5), last(6), b()), span(first(1), last(2), b())]),
      'kinds.zoning[0].spans[1].from',
      'ascending'
    );
    rejects(
      z([span(first(1), null, b()), span(first(5), null, b())]),
      'kinds.zoning[0].spans[1].from',
      'no end'
    );
  });
  it('asOf null skips only the alignment checks', () => {
    const none = { asOf: null };
    parses(z([span(first(1) + 1, last(1) - 1, b())]), none);
    parses(z([span(AS_OF, null, b())]), none);
    rejects(
      z([span(first(1) + 1, first(1) + 10, b()), span(first(1) + 5, null, b())]),
      'kinds.zoning[0].spans[1].from',
      'overlap',
      none
    );
    rejects(z([span(first(3), first(2), b())]), 'kinds.zoning[0].spans[0].to', undefined, none);
  });
  it('allows empty spans', () => {
    parses(doc([transit('z1', [])]));
  });
});

describe('rule 5: each what through its schema 3 parser', () => {
  const W = 'kinds.zoning[0].spans[0].what';
  it('bands', () => {
    rejects(
      doc([
        transit('z1', [
          open({
            tag: 'bands',
            bands: [
              { maxM: 402, stories: 4 },
              { maxM: 805, stories: 6 }
            ]
          })
        ])
      ]),
      `${W}.bands`,
      'taller'
    );
    rejects(doc([transit('z1', [open({ tag: 'bands', bands: [] })])]), `${W}.bands`);
    rejects(
      doc([transit('z1', [open({ tag: 'bands', bands: [{ maxM: 0, stories: 4 }] })])]),
      `${W}.bands[0].maxM`
    );
  });
  it('stop types, even for a policy with no spans', () => {
    rejects(
      doc([pol('z', { tag: 'transit', stopTypes: ['metro', 'tram'] }, [])]),
      'kinds.zoning[0].where.stopTypes[1]'
    );
    rejects(
      doc([pol('z', { tag: 'transit', stopTypes: ['tram'] }, [open(bandsW())])]),
      'kinds.zoning[0].where.stopTypes[0]'
    );
  });
  it('brushes', () => {
    const w = {
      tag: 'brushes',
      brushes: [{ id: 'b', kind: 'paint', strokes: [{ ...stroke, radiusM: 0 }], stories: 5 }]
    };
    rejects(doc([painted('z', [open(w)])]), `${W}.brushes[0].strokes[0].radiusM`);
    const dup = {
      tag: 'brushes',
      brushes: [
        { id: 'b', kind: 'erase', strokes: [stroke] },
        { id: 'b', kind: 'erase', strokes: [stroke] }
      ]
    };
    rejects(doc([painted('z', [open(dup)])]), `${W}.brushes[1].id`, 'duplicate id');
  });
  it('protect years', () => {
    parses(doc([category('c1', 'newerThan', 30), category('c2', 'historic', null)]));
    rejects(doc([category('c1', 'newerThan', null)]), `${W}.years`);
    rejects(doc([category('c1', 'newerThan', 0)]), `${W}.years`);
    rejects(doc([category('c1', 'historic', 30)]), `${W}.years`);
    rejects(doc([category('c1', 'rentControl', 30)]), `${W}.years`);
    rejects(
      doc([pol('c', { tag: 'category', category: 'wealth' }, [])]),
      'kinds.zoning[0].where.category'
    );
  });
  it('timing', () => {
    const w = timingW();
    w.set.edits = [{ pathway: 'discretionary', stage: 'filed', scale: 0.8, reach: 'new' }];
    rejects(
      doc([], [routes('p', [open(w)])]),
      'kinds.permitting[0].spans[0].what.set.edits[0].reach'
    );
  });
  it('scales', () => {
    rejects(
      doc([], [], [baseline('m', [scaleEntry('state', AS_OF + 1, 11)])]),
      'kinds.money[0].spans[0].what.entries[0].scale'
    );
    rejects(
      doc([], [], [baseline('m', [scaleEntry('u-x', AS_OF + 1)])]),
      'kinds.money[0].spans[0].what.entries[0].pool'
    );
  });
  it('pool and programmes', () => {
    const w = fundW('u-pool-1');
    w.pool.inflows[0].day = 47483;
    rejects(
      doc([], [], [fund('f', 'u-pool-1', [open(w)])]),
      'kinds.money[0].spans[0].what.pool.inflows[0].day'
    );
    const g = fundW('u-pool-1', ['u-prog-1', 'u-prog-2', 'u-prog-3']);
    g.programmes[2].pool = 'u-missing';
    rejects(
      doc([], [], [fund('f', 'u-pool-1', [open(g)])]),
      'kinds.money[0].spans[0].what.programmes[2].pool'
    );
    const dup = fundW('u-pool-1', ['u-prog-1', 'u-prog-1']);
    rejects(
      doc([], [], [fund('f', 'u-pool-1', [open(dup)])]),
      'kinds.money[0].spans[0].what.programmes[1].id',
      'duplicate id'
    );
  });
  it('terms', () => {
    rejects(
      doc([], [], [pol('t', { tag: 'terms' }, [open({ tag: 'terms', terms: { x: 1 } })])]),
      'kinds.money[0].spans[0].what.terms.x'
    );
    rejects(
      doc(
        [],
        [],
        [pol('t', { tag: 'terms' }, [open({ tag: 'terms', terms: { constructionYears: 'a' } })])]
      ),
      'kinds.money[0].spans[0].what.terms.constructionYears'
    );
  });
});

describe('rule 5: limits over the whole document', () => {
  it('added pools: 12 parse, 13 do not', () => {
    const pools = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        pol(`f${i}`, { tag: 'fund', pool: `u-pool-${i}` }, [
          open({ tag: 'fund', pool: poolOf(`u-pool-${i}`), programmes: [] })
        ])
      );
    parses(doc([], [], pools(FINANCE_LIMITS.pools)));
    rejects(doc([], [], pools(FINANCE_LIMITS.pools + 1)), 'kinds.money', 'pools');
  });
  it('programme ids: 24 parse, 25 do not', () => {
    const progs = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        pol(`f${i}`, { tag: 'fund', pool: 'city-a' }, [
          open({ tag: 'fund', pool: null, programmes: [progOf(`u-prog-${i}`, 'city-a')] })
        ])
      );
    parses(doc([], [], progs(FINANCE_LIMITS.programmes)));
    rejects(doc([], [], progs(FINANCE_LIMITS.programmes + 1)), 'kinds.money', 'programmes');
  });
  it('scale entries: 24 distinct (pool, from) pairs parse, 25 do not', () => {
    const scales = (n: number) =>
      Array.from({ length: n }, (_, i) => baseline(`m${i}`, [scaleEntry('state', AS_OF + 1 + i)]));
    parses(doc([], [], scales(FINANCE_LIMITS.baselineScale)));
    rejects(doc([], [], scales(FINANCE_LIMITS.baselineScale + 1)), 'kinds.money', 'scale');
  });
  it('counts a pair repeated over spans once', () => {
    const e = [scaleEntry('state', AS_OF + 1)];
    const rep = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        span(first(1 + 2 * i), last(2 + 2 * i), { tag: 'scales', entries: e })
      );
    const many = Array.from({ length: 24 }, (_, i) =>
      baseline(`m${i}`, [scaleEntry('state', AS_OF + 1 + i)])
    );
    many[0] = pol('m0', { tag: 'baseline' }, rep(5));
    parses(doc([], [], many));
  });
});

describe('round trip and preset layer', () => {
  const full = (): J =>
    doc(
      [
        transit('z1', [span(first(1), last(5), bandsW(6)), open(bandsW(4), 6)]),
        painted('z2', [span(first(1), last(5), brushesW()), open(brushesW(), 6)]),
        category('z3', 'newerThan', 20),
        category('z4', 'historic', null)
      ],
      [routes('p1', [span(first(1), last(5), timingW()), open(timingW(), 6)])],
      [
        baseline('m1', [scaleEntry('state', AS_OF + 400, 2)]),
        fund('m2', 'u-pool-1', [
          span(first(1), last(5), fundW('u-pool-1')),
          open(
            {
              ...fundW('u-pool-1'),
              programmes: [{ ...progOf('u-prog-1', 'u-pool-1'), minHomes: 9 }]
            },
            6
          )
        ]),
        pol('m3', { tag: 'fund', pool: 'city-a' }, [
          open({ tag: 'fund', pool: null, programmes: [progOf('u-prog-2', 'city-a')] })
        ]),
        terms('m4')
      ]
    );
  it('parses one policy of every pair with two spans each to a deep-equal value', () => {
    const d = full();
    const out = parsePolicy4(structuredClone(d), { asOf: AS_OF });
    expect(out).toEqual(d);
    expect(out).not.toBe(d);
  });
  it('reconcile accepts a retired preset id that strict rejects', () => {
    const w = timingW();
    w.set.preset = 'ceqaInfill';
    const d = doc([], [{ ...routes('p', [open(w)]), preset: 'ceqaInfill' }]);
    rejects(d, 'kinds.permitting[0].spans[0].what.set.preset', undefined, { asOf: AS_OF });
    rejects(d, 'kinds.permitting[0].spans[0].what.set.preset', undefined, {
      asOf: AS_OF,
      presetLayer: 'strict'
    });
    parses(d, { asOf: AS_OF, presetLayer: 'reconcile' });
  });
});
