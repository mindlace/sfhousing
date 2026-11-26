// What an option costs and is worth per home, from one resolved price step. Dollars come from the
// step, never from PROTOTYPES, except that A to E are returned as PROTOTYPES' own objects when
// the step's anchor is the shipped one.
import type { Dollars } from '../../timelapse/types';
import { PROTOTYPES, type Prototype, type PrototypeId } from '../finance/prototypes';
import type { HeightTimeModel, HeightTimeStep, Option, PriceStep } from './types';

export type PriceKey = PrototypeId | `I${number}`;
type Sized = Pick<Option, 'type' | 'stories' | 'homes'>;
type Anchor = PriceStep['anchors'][PrototypeId];

/** Type V under this many homes is priced as prototype E; other types keep their own anchor. */
const SMALL = 25;

/** Anchor a non-interpolated option is priced as, or null when Type I interpolates. */
function fixedAnchor(o: Sized, p: PriceStep): PrototypeId | null {
  if (o.type === 'V') return o.homes < SMALL ? 'E' : 'A';
  if (o.type === 'III') return 'B';
  return o.stories <= p.anchors.C.stories ? 'C' : null;
}

/** Fraction of the way from C to D, for Type I between them. */
function along(o: Sized, p: PriceStep): number {
  const { C, D } = p.anchors;
  return (o.stories - C.stories) / (D.stories - C.stories);
}

function between(o: Sized, p: PriceStep, pick: (a: Anchor) => number): number {
  const { C, D } = p.anchors;
  if (o.stories >= D.stories) return pick(D);
  return pick(C) + along(o, p) * (pick(D) - pick(C));
}

export function costPerHome(o: Sized, p: PriceStep): Dollars {
  const id = fixedAnchor(o, p);
  if (id) return p.anchors[id].costPerHome;
  if (o.stories > p.anchors.D.stories) return p.anchors.D.costPerHome * p.aboveTopCostRatio;
  return between(o, p, (a) => a.costPerHome);
}

/** Cost less the shortfall. Above the top anchor the cost scales and the value does not. */
export function valuePerHome(o: Sized, p: PriceStep): Dollars {
  const id = fixedAnchor(o, p);
  if (id) return p.anchors[id].valuePerHome;
  return between(o, p, (a) => a.valuePerHome);
}

/** The band of `stories`: the first edge at or above it. */
export function bandOf(ht: Pick<HeightTimeModel, 'upTo'>, stories: number): number {
  const i = ht.upTo.findIndex((edge) => stories <= edge);
  return i < 0 ? ht.upTo.length - 1 : i;
}

/** The story count of the anchor an option's cost is read from (its lower anchor on the slope). */
function referenceStories(o: Sized, p: PriceStep): number {
  const id = fixedAnchor(o, p);
  if (id) return p.anchors[id].stories;
  return o.stories >= p.anchors.D.stories ? p.anchors.D.stories : p.anchors.C.stories;
}

/**
 * Interest on the extra months a taller option spends under construction beyond the anchor it is
 * priced from. The anchors' own costs already carry their band's months, so an option in its
 * anchor's band, or a shorter one, carries nothing.
 */
export function carryPerHome(
  o: Sized,
  p: PriceStep,
  time: HeightTimeStep,
  upTo: number[]
): Dollars {
  const own = time.constructionMonths[bandOf({ upTo }, o.stories)];
  const ref = time.constructionMonths[bandOf({ upTo }, referenceStories(o, p))];
  const extra = Math.max(0, own - ref);
  return (p.carrying.rate * p.carrying.drawn * costPerHome(o, p) * extra) / 12;
}

const synthetic = new WeakMap<PriceStep, Map<number, Prototype & { id: PriceKey }>>();

function sameAsShipped(id: PrototypeId, p: PriceStep): boolean {
  const shipped = PROTOTYPES.find((q) => q.id === id)!;
  const a = p.anchors[id];
  return (
    a.stories === shipped.stories &&
    a.homes === shipped.homes &&
    a.costPerHome === shipped.costPerHome &&
    a.valuePerHome === shipped.costPerHome - shipped.shortfallPerHome
  );
}

/** PROTOTYPES' own object for A to E; a frozen synthetic prototype keyed by stories for Type I. */
export function optionPrototype(o: Sized, p: PriceStep): Prototype & { id: PriceKey } {
  const id = fixedAnchor(o, p);
  if (id && sameAsShipped(id, p))
    return PROTOTYPES.find((q) => q.id === id)! as Prototype & { id: PriceKey };
  const key = id ? p.anchors[id].stories * 1000 + (id === 'E' ? 1 : 0) : o.stories;
  let byStories = synthetic.get(p);
  if (!byStories) synthetic.set(p, (byStories = new Map()));
  const hit = byStories.get(key);
  if (hit) return hit;
  const base = PROTOTYPES.find((q) => q.id === (id ?? 'C'))!;
  const cost = costPerHome(o, p);
  const made = Object.freeze({
    id: (id ?? `I${o.stories}`) as PriceKey,
    stories: id ? p.anchors[id].stories : o.stories,
    homes: id ? p.anchors[id].homes : Math.round(between(o, p, (a) => a.homes)),
    costPerHome: cost,
    shortfallPerHome: cost - valuePerHome(o, p),
    provenance: base.provenance
  }) as Prototype & { id: PriceKey };
  byStories.set(key, made);
  return made;
}
