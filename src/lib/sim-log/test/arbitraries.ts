/**
 * Arbitrary rulesets from one small universe, so two draws share keys. Every draw is valid under
 * `parsePolicy4(…, { asOf: null, presetLayer: 'reconcile' })` and in log form.
 */
import fc from 'fast-check';
import type { CustomBrush } from '$lib/sim-page/policy';
import { monthOfDay } from '$lib/sim/world/months';
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

/**
 * One small edit, by picks: `op` chooses the edit, `a`, `b`, `c` where it lands. The picks are
 * small so that two edits of one base often land on the same items, and the stroke edits (2, 3,
 * 7, 8) are drawn more often than the rest.
 */
interface Edit {
  op: number;
  a: number;
  b: number;
  c: number;
}
const small = fc.nat({ max: 5 });
const editArb: fc.Arbitrary<Edit> = fc.record({
  op: fc.constantFrom(0, 1, 2, 2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 9),
  a: small,
  b: small,
  c: small
});

const KIND_NAMES = ['zoning', 'permitting', 'money'] as const;
const pick = <T>(xs: readonly T[], n: number): T | undefined =>
  xs.length === 0 ? undefined : xs[n % xs.length];
const moveTo = <T>(xs: T[], from: number, to: number): void => {
  const [x] = xs.splice(from % xs.length, 1);
  xs.splice(to % (xs.length + 1), 0, x);
};

/** Applies one edit in place; an edit with nothing to land on does nothing. */
function applyEdit(r: RulesetContent, { op, a, b, c }: Edit): void {
  const kinds = r.policy.kinds as unknown as Record<string, J[]>;
  const all = KIND_NAMES.flatMap((k) => kinds[k]);
  const spans = all.flatMap((p) => (p.spans as J[]).map((s) => ({ p, s })));
  const brushSpans = spans.filter(({ s }) => s.what.tag === 'brushes');
  const brushesAt = (n: number) => pick(brushSpans, n)?.s.what.brushes as CustomBrush[] | undefined;
  const stroke = () => ({
    path: structuredClone(PATHS[c % PATHS.length]),
    radiusM: c % 2 === 0 ? 10 : 50
  });
  switch (op % 10) {
    case 0: {
      // delete a policy
      const list = kinds[KIND_NAMES[a % 3]];
      if (list.length > 0) list.splice(b % list.length, 1);
      return;
    }
    case 1: {
      // delete a span
      const at = pick(spans, a);
      if (at) at.p.spans.splice(at.p.spans.indexOf(at.s), 1);
      return;
    }
    case 2: {
      // add a stroke to a brush or as a new brush; a painted policy when no span has brushes
      const brushes = brushesAt(a);
      if (!brushes) {
        if (!all.some((p) => p.id === 'z9')) kinds.zoning.push(painted('z9'));
        return;
      }
      const i = b % (brushes.length + 1);
      if (i < brushes.length) {
        brushes[i].strokes.splice(c % (brushes[i].strokes.length + 1), 0, stroke());
        return;
      }
      const id = ['b1', 'b2', 'b3', 'b4'].find((x) => !brushes.some((y) => y.id === x));
      if (id) brushes.push({ id, kind: 'paint', strokes: [stroke()], stories: 4 });
      return;
    }
    case 3: {
      // delete a stroke, and its brush when it empties
      const brushes = brushesAt(a);
      const brush = brushes && pick(brushes, b);
      if (!brushes || !brush) return;
      brush.strokes.splice(c % brush.strokes.length, 1);
      if (brush.strokes.length === 0) brushes.splice(brushes.indexOf(brush), 1);
      return;
    }
    case 4: {
      // truncate a span to its first month
      const at = pick(spans, a);
      if (!at) return;
      const to = last(monthOfDay(AS_OF, at.s.from));
      if (at.s.to === null || at.s.to > to) at.s.to = to;
      return;
    }
    case 5: {
      // end an open span and start a later one with the same effect
      const at = pick(
        spans.filter(({ s }) => s.to === null),
        a
      );
      if (!at) return;
      const m = monthOfDay(AS_OF, at.s.from) + 1 + (b % 3);
      at.s.to = last(m);
      at.p.spans.push(span(first(m + 1), null, structuredClone(at.s.what)));
      return;
    }
    case 6: {
      // reorder a kind's policies
      const list = kinds[KIND_NAMES[a % 3]];
      if (list.length > 1) moveTo(list, b, c);
      return;
    }
    case 7: {
      // reorder a span's brushes, or a brush's strokes
      const brushes = brushesAt(a);
      if (!brushes || brushes.length === 0) return;
      if (b % 2 === 0) moveTo(brushes, b >> 1, c);
      else moveTo(brushes[c % brushes.length].strokes, b >> 1, c >> 1);
      return;
    }
    case 8: {
      // repeat a stroke right after itself
      const brush = pick(brushesAt(a) ?? [], b);
      if (!brush) return;
      const i = c % brush.strokes.length;
      brush.strokes.splice(i + 1, 0, structuredClone(brush.strokes[i]));
      return;
    }
    default: {
      // rename the sim, or relabel or switch a policy
      const p = pick(all, b);
      if (a % 3 === 0 || !p) r.name = pick(['Mission', 'Outer Sunset', DEFAULT_SIM_NAME], c)!;
      else if (a % 3 === 1) p.label = `l${c % 3}`;
      else p.on = !p.on;
    }
  }
}

/** `base` after one to three small edits; valid and in log form when `base` is. */
export const arbEdited = (base: RulesetContent): fc.Arbitrary<RulesetContent> =>
  fc.array(editArb, { minLength: 1, maxLength: 3 }).map((edits) => {
    const out = structuredClone(base);
    for (const e of edits) applyEdit(out, e);
    return out;
  });

/** A ruleset with a painted policy z9 whose one span holds two brushes, three strokes in all. */
const withPainted = (r: RulesetContent): RulesetContent => {
  const out = structuredClone(r);
  const brushes: CustomBrush[] = [
    {
      id: 'b1',
      kind: 'paint',
      strokes: [0, 1].map((i) => ({ path: PATHS[i], radiusM: 50 })),
      stories: 4
    },
    { id: 'b2', kind: 'erase', strokes: [{ path: PATHS[2], radiusM: 10 }] }
  ];
  out.policy.kinds.zoning.push(
    painted('z9', [span(first(1), null, { tag: 'brushes', brushes })]) as never
  );
  return out;
};

/**
 * A base and two edits of it, theirs then mine, made apart from each other so they collide. Half
 * the bases carry a painted policy with strokes, for the stroke edits to land on.
 */
export const arbCollision: fc.Arbitrary<[RulesetContent, RulesetContent, RulesetContent]> = fc
  .oneof(arbRuleset, arbRuleset.map(withPainted))
  .chain((base) => fc.tuple(fc.constant(base), arbEdited(base), arbEdited(base)));
