/**
 * Arbitrary rulesets from one small universe, so two draws share keys. Every draw is valid under
 * `parsePolicy4(…, { asOf: null, presetLayer: 'reconcile' })` and in log form.
 */
import fc from 'fast-check';
import type { CustomBrush } from '$lib/sim-page/policy';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { DEFAULT_SIM_NAME } from '../shapes';
import type { RulesetContent } from '../types';
import {
  baseline,
  bandsW,
  category,
  doc,
  first,
  fund,
  fundW,
  last,
  painted,
  routes,
  scaleEntry,
  span,
  terms,
  timingW,
  transit,
  AS_OF,
  type J
} from './fixtures';

const MONTHS = [1, 3, 6, 12, 24];
const PATHS: [number, number][][] = [
  [[-122.4, 37.7]],
  [[-122.41, 37.71]],
  [[-122.45, 37.76]],
  [
    [-122.43, 37.75],
    [-122.42, 37.77]
  ]
];

const name = fc.constantFrom(DEFAULT_SIM_NAME, 'Mission', 'Outer Sunset');

/** Spans' starts (months), each with the month its span ends in, or null for open-ended. */
const plan = fc
  .tuple(
    fc.subarray(MONTHS, { minLength: 0, maxLength: 3 }),
    fc.option(fc.integer({ min: 0, max: 3 }))
  )
  .map(([starts, tail]) =>
    starts.map((m, i) => ({
      m,
      end: i + 1 < starts.length ? starts[i + 1] - 1 : tail === null ? null : m + tail
    }))
  );
type Plan = { m: number; end: number | null }[];

const spansOf = (p: Plan, whats: J[]): J[] =>
  p.map(({ m, end }, i) => span(first(m), end === null ? null : last(end), whats[i]));

/** A policy's spans from its plan, each `what` drawn from `what`. */
const withWhats = (what: fc.Arbitrary<J>) =>
  plan.chain((p) => fc.tuple(...p.map(() => what)).map((whats) => spansOf(p, whats as J[])));
/** A policy whose spans all hold the same `what`. */
const withSame = (what: () => J) => plan.map((p) => spansOf(p, p.map(what)));

const bandsArb = fc.constantFrom(6, 8).map((s) => bandsW(s));
const timingArb = fc.constant(null).map(() => timingW());
const scalesArb = fc
  .constantFrom(2, 3)
  .map((scale) => ({ tag: 'scales', entries: [scaleEntry('state', AS_OF + 400, scale)] }));
const termsArb = fc
  .constantFrom(2, 3)
  .map((years) => ({ tag: 'terms', terms: { constructionYears: years } }));

const brushArb = (id: string): fc.Arbitrary<CustomBrush> => {
  const strokes = fc.array(
    fc.record({ path: fc.constantFrom(...PATHS), radiusM: fc.constantFrom(10, 50) }),
    { minLength: 1, maxLength: 3 }
  );
  return fc.oneof(
    fc.tuple(strokes, fc.constantFrom(4, 8)).map(([s, stories]): CustomBrush => ({
      id,
      kind: 'paint',
      strokes: structuredClone(s),
      stories
    })),
    strokes.map((s): CustomBrush => ({ id, kind: 'erase', strokes: structuredClone(s) }))
  );
};
const brushesArb: fc.Arbitrary<J> = fc.integer({ min: 0, max: 3 }).chain((n) =>
  fc.tuple(...['b1', 'b2', 'b3'].slice(0, n).map(brushArb)).map((brushes) => ({
    tag: 'brushes',
    brushes
  }))
);

type Meta = { label: string; on: boolean };
const meta: fc.Arbitrary<Meta> = fc.record({
  label: fc.string({ maxLength: 12 }),
  on: fc.boolean()
});
const dress = (p: J, m: Meta): J => ({ ...p, label: m.label, on: m.on });

const zoningPolicy = (id: string): fc.Arbitrary<J> =>
  fc.tuple(meta, fc.constantFrom('transit', 'painted', 'category')).chain(([m, row]) => {
    if (row === 'transit') return withWhats(bandsArb).map((s) => dress(transit(id, s), m));
    if (row === 'painted') return withWhats(brushesArb).map((s) => dress(painted(id, s), m));
    return fc
      .constantFrom('rentControl', 'historic', 'newerThan')
      .chain((c) =>
        c === 'newerThan'
          ? withWhats(fc.constantFrom(10, 20).map((years) => ({ tag: 'protect', years }))).map(
              (s) => ({ ...category(id, c, 10), spans: s })
            )
          : withSame(() => ({ tag: 'protect', years: null })).map((s) => ({
              ...category(id, c, null),
              spans: s
            }))
      )
      .map((p) => dress(p, m));
  });

const permittingPolicy = (id: string): fc.Arbitrary<J> =>
  fc.tuple(meta, withWhats(timingArb)).map(([m, s]) => dress(routes(id, s), m));

const moneyPolicy = (id: string): fc.Arbitrary<J> => {
  const n = id.slice(1);
  if (id === 'm1')
    return fc
      .tuple(meta, withWhats(scalesArb))
      .map(([m, s]) => dress({ ...baseline(id), spans: s }, m));
  if (id === 'm2')
    return fc
      .tuple(meta, withWhats(termsArb))
      .map(([m, s]) => dress({ ...terms(id), spans: s }, m));
  const pool = `u-pool-${n}`;
  return fc
    .tuple(
      meta,
      withSame(() => fundW(pool, [`u-prog-${n}`]))
    )
    .map(([m, s]) => dress(fund(id, pool, s), m));
};

const subset = (ids: string[]) => fc.shuffledSubarray(ids, { minLength: 0, maxLength: ids.length });
const policies = (ids: string[], make: (id: string) => fc.Arbitrary<J>) =>
  subset(ids).chain((chosen) => fc.tuple(...chosen.map(make)));

export const arbRuleset: fc.Arbitrary<RulesetContent> = fc
  .tuple(
    name,
    policies(['z1', 'z2', 'z3', 'z4', 'z5'], zoningPolicy),
    policies(['p1', 'p2'], permittingPolicy),
    policies(['m1', 'm2', 'f1', 'f2'], moneyPolicy)
  )
  .map(([n, z, p, m]) => ({ name: n, policy: doc(z, p, m) as SimPolicy4 }));

export const arbPair: fc.Arbitrary<[RulesetContent, RulesetContent]> = fc.tuple(
  arbRuleset,
  arbRuleset
);
