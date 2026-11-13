/**
 * Which policy sets each lot's story limit in a compiled frame (policy-timeline spec S13, Task 16):
 * today's `limitSources` + `ownerOf` over the zoning in force in the frame, with the painted
 * policy that wins a painted lot. Keyed on the frame object, filled by `compileTimeline`.
 * Pure TS, worker-safe.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { LayerCtx } from '$lib/sim/levers/layers';
import { protectedRows } from '$lib/sim/levers/resolve';
import { limitSources, ownerOf, SRC_PAINT, type LimitSources } from '$lib/sim/levers/source';
import {
  compileLevers,
  DEFAULT_POLICY,
  paintedLots,
  type Lots,
  type ZoningRule
} from '$lib/sim-page/policy';
import type { Day } from '$lib/timelapse/time';
import { zoningLevers, type Active } from './combine';
import type { PolicyFrame } from './frame';

export type PolicyLimitOwner =
  | { kind: 'fzp' }
  /** The painted policy whose stroke wins (rule 11: lower in the list wins). */
  | { kind: 'paint'; policy: string }
  /** A transit policy is one rule: `ruleId === policy`. */
  | { kind: 'rule'; ruleId: string; policy: string };

export interface FrameLimits {
  owner: PolicyLimitOwner;
  protected: boolean;
}

/** Owners and the protected mask of one zoning state, once computed. */
interface Resolved {
  sources: LimitSources;
  /** Per row: the index in `paintOwners` of the painted policy that wins it, or -1. */
  paintBy: Int32Array;
  paintOwners: PolicyLimitOwner[];
  ruleOwners: Map<string, PolicyLimitOwner>;
  mask: Uint8Array;
}

/**
 * The attribution of one zoning state in one compile: the zoning policies in force, resolved on
 * the first `limitsAt` and memoised. Months that share the state share the object.
 */
export interface Attribution {
  readonly layers: LayerCtx;
  readonly asOf: Day;
  readonly zoning: readonly Active[];
  readonly lots: Record<string, ParcelId[]>;
  resolved: Resolved | null;
}

/** Frame object to its attribution; a frame holds it, the module does not. */
const ATTRIBUTION = new WeakMap<PolicyFrame, Attribution>();

const FZP: PolicyLimitOwner = Object.freeze({ kind: 'fzp' });

/** An attribution for the zoning policies `zoning` in force (compiler use). */
export function createAttribution(
  layers: LayerCtx,
  asOf: Day,
  zoning: readonly Active[],
  lots: Record<string, ParcelId[]>
): Attribution {
  return { layers, asOf, zoning, lots, resolved: null };
}

/** Records that `frame`, handed out by a compile, has attribution `a` (compiler use). */
export function attachAttribution(frame: PolicyFrame, a: Attribution): void {
  ATTRIBUTION.set(frame, a);
}

function resolve(a: Attribution): Resolved {
  const { layers, lots } = a;
  const lookup: Lots = (key) => lots[key];
  // Paint union and protections exactly as the view's levers (rules 11, 12).
  const z = zoningLevers({ zoning: [...a.zoning], permitting: [], money: [] }, lots, true);
  // Rules with their policy id as the edit source; list order, so the first maximum wins.
  const rules: ZoningRule[] = [];
  for (const x of a.zoning) {
    const w = x.policy.where;
    const what = x.span.what;
    if (w.tag === 'transit' && what.tag === 'bands')
      rules.push({ id: x.policy.id, kind: 'transit', stopTypes: w.stopTypes, bands: what.bands });
  }
  const levers = compileLevers({ ...DEFAULT_POLICY, rules }, lookup)!;
  levers.paint = z.paint;
  const rows = protectedRows(layers, z.protect, a.asOf);
  const sources = limitSources(layers, levers, rows);

  const index = layers.parcels.index;
  const paintBy = new Int32Array(layers.parcels.count).fill(-1);
  const paintOwners: PolicyLimitOwner[] = [];
  for (const x of a.zoning) {
    const what = x.span.what;
    if (x.policy.where.tag !== 'painted' || what.tag !== 'brushes') continue;
    const k = paintOwners.length;
    paintOwners.push(Object.freeze({ kind: 'paint', policy: x.policy.id }));
    // the lower policy in the list overwrites the upper (rule 11)
    for (const lot of paintedLots({ ...DEFAULT_POLICY, custom: what.brushes }, lookup)!.keys()) {
      const i = index.get(lot);
      if (i !== undefined) paintBy[i] = k;
    }
  }
  const ruleOwners = new Map<string, PolicyLimitOwner>(
    sources.ruleIds.map((id) => [id, Object.freeze({ kind: 'rule', ruleId: id, policy: id })])
  );
  const mask = new Uint8Array(layers.parcels.count);
  for (const r of rows) mask[r] = 1;
  return { sources, paintBy, paintOwners, ruleOwners, mask };
}

function attributionOf(frame: PolicyFrame, what: string): Attribution {
  const a = ATTRIBUTION.get(frame);
  if (a === undefined) throw new RangeError(`${what}: the frame is not from a live compile`);
  return a;
}

function at(a: Attribution, row: number): FrameLimits {
  const r = (a.resolved ??= resolve(a));
  let owner: PolicyLimitOwner = FZP;
  if (r.sources.source[row] === SRC_PAINT) owner = r.paintOwners[r.paintBy[row]];
  else {
    const o = ownerOf(r.sources, row);
    if (o.kind === 'rule') owner = r.ruleOwners.get(o.ruleId)!;
  }
  return { owner, protected: r.mask[row] === 1 };
}

/**
 * Which policy sets lot `row`'s story limit in `frame`, as today's `limitSources` + `ownerOf`:
 * a rule strictly above FZP (the first maximum in list order), else paint (the lower painted
 * policy in the list), else FZP; a protected lot reads FZP with `protected: true`.
 *
 * Pass `timeline.frameAt(month)` of the timeline in use, never a frame held from an older
 * timeline: content-equal frames of two compiles share an id and a view but not their owners
 * (a kept world resumed on a new timeline reads the new timeline's frames). Throws `RangeError`
 * for a row outside the lot table or a frame no live compile handed out.
 */
export function limitsAt(frame: PolicyFrame, row: number): FrameLimits {
  const a = attributionOf(frame, 'limitsAt');
  if (!Number.isInteger(row) || row < 0 || row >= a.layers.parcels.count)
    throw new RangeError(`limitsAt: row ${row} is outside 0..${a.layers.parcels.count - 1}`);
  return at(a, row);
}

/**
 * `limitsAt` by parcel id; null when the lot table has no row for it. The same caller rule
 * applies: pass a frame of the timeline in use.
 */
export function limitsOf(frame: PolicyFrame, parcelId: ParcelId): FrameLimits | null {
  const a = attributionOf(frame, 'limitsOf');
  const row = a.layers.parcels.index.get(parcelId);
  return row === undefined ? null : at(a, row);
}
