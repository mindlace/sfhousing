import { canonicalJson, type CustomBrush } from '$lib/sim-page/policy';
import type { Effect, Policy, PolicyKind, SimPolicy4, Span } from '$lib/timeline/policy4';
import {
  NAME_KEY,
  isStrokeKeyOf,
  listKey,
  policyKey,
  spanKey,
  strokeKeys,
  type StrokeFields
} from './keys';
import type { Fields } from './shapes';
import { LogError, type RulesetContent } from './types';

export interface Item {
  shape: string;
  fields: Fields;
}
export interface Flat {
  items: Map<string, Item>;
  lists: Map<string, string[]>;
}

const KINDS: readonly PolicyKind[] = ['zoning', 'permitting', 'money'];

/** Items of a log-form ruleset; throws RangeError on an empty brush. The sim item included. */
export function flatten(r: RulesetContent): Flat {
  const items = new Map<string, Item>();
  const lists = new Map<string, string[]>();
  items.set(NAME_KEY, { shape: 'sim', fields: { name: r.name } });
  for (const kind of KINDS) {
    const keys: string[] = [];
    for (const p of r.policy.kinds[kind]) {
      const pk = policyKey(p.id);
      keys.push(pk);
      items.set(pk, {
        shape: `policy.${p.where.tag}`,
        fields: {
          id: p.id,
          kind,
          where: structuredClone(p.where),
          label: p.label,
          preset: p.preset,
          on: p.on
        }
      });
      for (const s of p.spans) flattenSpan(p, s, items, lists);
    }
    if (keys.length > 0) lists.set(listKey(kind), keys);
  }
  return { items, lists };
}

function flattenSpan(p: Policy, s: Span, items: Map<string, Item>, lists: Map<string, string[]>) {
  const sk = spanKey(p.id, s.from);
  const what: Effect = s.what;
  items.set(sk, {
    shape: `span.${p.where.tag}`,
    fields: {
      policy: p.id,
      from: s.from,
      to: s.to,
      what: what.tag === 'brushes' ? { tag: 'brushes' } : structuredClone(what)
    }
  });
  if (what.tag !== 'brushes') return;
  const strokes: StrokeFields[] = [];
  for (const b of what.brushes) {
    if (b.strokes.length === 0) throw new RangeError(`brush ${b.id} has no strokes`);
    for (const st of b.strokes)
      strokes.push({
        span: sk,
        brush: b.id,
        kind: b.kind,
        stories: b.kind === 'paint' ? b.stories : null,
        path: structuredClone(st.path),
        radiusM: st.radiusM
      });
  }
  if (strokes.length === 0) return;
  const keys = strokeKeys(strokes);
  keys.forEach((k, i) => items.set(k, { shape: 'stroke', fields: { ...strokes[i] } }));
  lists.set(listKey(sk), keys);
}

function bad(message: string): never {
  throw new LogError('invalid-change', message);
}

function assembleBrushes(
  sk: string,
  items: ReadonlyMap<string, Item>,
  lists: ReadonlyMap<string, readonly string[]>
): CustomBrush[] {
  const byId = new Map<string, StrokeFields[]>();
  for (const k of lists.get(listKey(sk)) ?? []) {
    const it = items.get(k);
    if (!it || it.shape !== 'stroke') bad(`${listKey(sk)} lists ${k}, which is not a stroke`);
    const f = it.fields as unknown as StrokeFields;
    let group = byId.get(f.brush);
    if (!group) {
      group = [];
      byId.set(f.brush, group);
    }
    const first = group[0];
    if (first && (first.kind !== f.kind || first.stories !== f.stories))
      bad(`brush ${f.brush} has strokes that disagree on kind or stories`);
    group.push(f);
  }
  return [...byId.values()].map((group): CustomBrush => {
    const out = group.map((f) => ({ path: f.path, radiusM: f.radiusM }));
    const head = group[0];
    return head.kind === 'paint'
      ? { id: head.brush, kind: 'paint', strokes: out, stories: head.stories as number }
      : { id: head.brush, kind: 'erase', strokes: out };
  });
}

/** The ruleset the items describe; throws LogError('invalid-change') on a brush whose strokes disagree on kind or stories. */
export function assemble(
  items: ReadonlyMap<string, Item>,
  lists: ReadonlyMap<string, readonly string[]>
): RulesetContent {
  const spansOf = new Map<string, [string, Item][]>();
  for (const [k, it] of items) {
    if (!it.shape.startsWith('span.')) continue;
    const pid = it.fields.policy as string;
    let g = spansOf.get(pid);
    if (!g) spansOf.set(pid, (g = []));
    g.push([k, it]);
  }
  const kinds = { zoning: [], permitting: [], money: [] } as SimPolicy4['kinds'];
  for (const kind of KINDS) {
    for (const pk of lists.get(listKey(kind)) ?? []) {
      const it = items.get(pk);
      if (!it || !it.shape.startsWith('policy.')) bad(`${listKey(kind)} lists ${pk}, not a policy`);
      const f = it.fields;
      const spans = (spansOf.get(f.id as string) ?? [])
        .sort((a, b) => (a[1].fields.from as number) - (b[1].fields.from as number))
        .map(([sk, s]): Span => {
          const what = s.fields.what as Effect;
          return {
            from: s.fields.from as number,
            to: s.fields.to as number | null,
            what:
              what.tag === 'brushes'
                ? { tag: 'brushes', brushes: assembleBrushes(sk, items, lists) }
                : structuredClone(what)
          };
        });
      kinds[kind].push({
        id: f.id as string,
        label: f.label as string,
        preset: f.preset as string | null,
        on: f.on as boolean,
        where: structuredClone(f.where) as Policy['where'],
        spans
      });
    }
  }
  return { name: items.get(NAME_KEY)?.fields.name as string, policy: { schema: 4, kinds } };
}

/** Structural roles by shape name (decision 16). */
export function parentOf(item: Item): string | null {
  if (item.shape.startsWith('span.')) return policyKey(item.fields.policy as string);
  if (item.shape === 'stroke') return item.fields.span as string;
  return null;
}
export function listOf(item: Item): string | null {
  if (item.shape.startsWith('policy.')) return listKey(item.fields.kind as string);
  if (item.shape === 'stroke') return listKey(item.fields.span as string);
  return null;
}
export function isEndable(shape: string): boolean {
  return shape.startsWith('span.');
}
export function keyFits(key: string, item: Item): boolean {
  const f = item.fields;
  if (item.shape === 'sim') return key === NAME_KEY;
  if (item.shape.startsWith('policy.')) return key === policyKey(f.id as string);
  if (item.shape.startsWith('span.')) return key === spanKey(f.policy as string, f.from as number);
  if (item.shape === 'stroke') return isStrokeKeyOf(key, f as unknown as StrokeFields);
  return false;
}

/** Drops brushes with no strokes: the log has no empty brush. */
export function toLogForm(p: SimPolicy4): SimPolicy4 {
  const out = structuredClone(p);
  for (const kind of KINDS)
    for (const pol of out.kinds[kind])
      for (const s of pol.spans)
        if (s.what.tag === 'brushes')
          s.what = { tag: 'brushes', brushes: s.what.brushes.filter((b) => b.strokes.length > 0) };
  return out;
}

export function rulesetText(r: RulesetContent): string {
  return canonicalJson({ name: r.name, policy: r.policy });
}
