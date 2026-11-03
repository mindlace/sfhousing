// Legacy MapLibre filters to expressions. The /lesscars basemap hide wraps each road clone's own
// filter in an expression `all`; MapLibre reads a filter as legacy or expression by its shape
// (isExpressionFilter in @maplibre/maplibre-gl-style-spec), so a legacy filter mixed into an
// expression silently misreads it (`['==', 'kind', 'highway']` would compare two strings).
import type { ExpressionSpecification } from 'maplibre-gl';

type F = unknown[];

const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>=']);
/** Expression operators a filter may start with; others (`within`, `distance`, …) throw. */
const EXPRESSION_OPS = new Set([
  '!',
  'case',
  'match',
  'coalesce',
  'get',
  'has',
  'in',
  'literal',
  'boolean',
  'to-boolean',
  'typeof',
  'geometry-type',
  'id',
  'zoom',
  'step',
  'interpolate',
  'let',
  'var',
  'at',
  'index-of',
  'length',
  'slice'
]);

function getter(key: unknown): unknown[] {
  if (key === '$type') return ['geometry-type'];
  if (key === '$id') return ['id'];
  return ['get', key];
}

/** Legacy `$type` values match the multi-part geometries as well. */
function typeValues(v: unknown): unknown[] {
  return typeof v === 'string' ? [v, `Multi${v}`] : [v];
}

function compare(op: string, key: unknown, value: unknown): unknown[] {
  if (key === '$type') {
    const inTypes = ['in', ['geometry-type'], ['literal', typeValues(value)]];
    if (op === '==') return inTypes;
    if (op === '!=') return ['!', inTypes];
  }
  const get = getter(key);
  // A legacy comparison with null (MapLibre's convertFilter).
  if (op === '==' && key !== '$id' && value === null)
    return ['all', ['has', key], ['==', get, null]];
  if (op === '!=' && key !== '$id' && value === null)
    return ['any', ['!', ['has', key]], ['!=', get, null]];
  if (op === '==' || op === '!=') return [op, get, value];
  // Legacy ordering is false across types; an expression would error, so test the type first.
  return ['all', ['==', ['typeof', get], typeof value], [op, get, value]];
}

function inOp(key: unknown, values: unknown[], negate: boolean): unknown[] {
  if (values.length === 0) return ['boolean', negate];
  const vals = key === '$type' ? values.flatMap(typeValues) : values;
  const uniform =
    vals.every((v) => typeof v === 'string') || vals.every((v) => typeof v === 'number');
  const test = uniform
    ? ['match', getter(key), [...new Set<unknown>(vals)], true, false]
    : ['any', ...vals.map((v) => ['==', getter(key), v])];
  return negate ? ['!', test] : test;
}

function hasOp(key: unknown): unknown[] {
  if (key === '$type') return ['boolean', true];
  if (key === '$id') return ['!=', ['id'], null];
  return ['has', key];
}

function convert(f: unknown): unknown {
  if (f === true || f === false) return f;
  if (!Array.isArray(f) || f.length === 0 || typeof f[0] !== 'string')
    throw new Error(`filter: not a filter: ${JSON.stringify(f)}`);
  const a = f as F;
  const op = a[0] as string;
  switch (op) {
    case 'all':
    case 'any':
      return [op, ...a.slice(1).map(convert)];
    case 'none':
      return ['all', ...a.slice(1).map((c) => ['!', convert(c)])];
    case '!has':
      return ['!', hasOp(a[1])];
    case '!in':
      return inOp(a[1], a.slice(2), true);
    case 'has':
      // `['has', key]` reads the same either way, but `$id` / `$type` keys are legacy only
      return a.length >= 2 && a[1] !== '$id' && a[1] !== '$type' ? a : hasOp(a[1]);
    case 'in':
      return a.length >= 3 && (typeof a[1] !== 'string' || Array.isArray(a[2]))
        ? a
        : inOp(a[1], a.slice(2), false);
  }
  if (COMPARE.has(op))
    return a.length !== 3 || Array.isArray(a[1]) || Array.isArray(a[2])
      ? a
      : compare(op, a[1], a[2]);
  if (EXPRESSION_OPS.has(op)) return a;
  throw new Error(`filter: unknown operator ${op}`);
}

/**
 * A MapLibre filter as an expression; legacy filters (==, !=, <, <=, >, >=, in, !in, has, !has,
 * all, any, none, with $type / $id keys) are converted; an expression is returned as is.
 * No filter selects every feature. Throws on an operator it does not know.
 */
export function toExpressionFilter(f: unknown): ExpressionSpecification {
  if (f === undefined || f === null) return ['boolean', true] as ExpressionSpecification;
  const e = convert(f);
  return (typeof e === 'boolean' ? ['boolean', e] : e) as ExpressionSpecification;
}
