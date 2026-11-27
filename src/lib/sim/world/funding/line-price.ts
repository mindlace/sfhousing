// The price of a funding-line row (building-choice Task 10): its option's construction type,
// stories and homes priced by `optionPrototype` on the price step in force at the cost step its
// size was drawn at (the frame's `choiceStep`, else the dataset date's), never the binning.
import type { ChoiceCtx } from '$lib/sim/choice/choose';
import { optionPrototype, type PriceKey } from '$lib/sim/choice/pricing';
import { BUILDING_TYPES, stepAt } from '$lib/sim/choice/types';
import type { Prototype } from '$lib/sim/finance';
import type { PolicyTimeline } from '../policy/frame';
import type { FundLine } from './columns';

/** A prototype priced from an option: A to E, or a Type I one keyed by its stories. */
export type PricedPrototype = Prototype & { id: PriceKey };

/** The index into `choice.m.prices` of the price step in force at cost step `cstep`. */
export function priceStepOf(choice: ChoiceCtx, cstep: number): number {
  return stepAt(choice.m.prices, choice.from[cstep]).index;
}

/** An option of type code `btype`, `stories` and `homes` (after the cap) priced at `cstep`. */
export function sizedPrototype(
  choice: ChoiceCtx,
  btype: number,
  stories: number,
  homes: number,
  cstep: number
): PricedPrototype {
  const step = choice.m.prices[priceStepOf(choice, cstep)].value;
  return optionPrototype({ type: BUILDING_TYPES[btype], stories, homes }, step);
}

/**
 * The line's price tag of a market row: its PriceKey and price step index. Rows with one tag are
 * priced alike, so the line index groups by it. One choice model per run gives one meaning per
 * index.
 */
export function priceTag(choice: ChoiceCtx, proto: PricedPrototype, cstep: number): string {
  return `${proto.id}@${priceStepOf(choice, cstep)}`;
}

/** Line row `i`'s prototype: its option priced at its own cost step, in its view's choice. */
export function linePrototype(
  timeline: PolicyTimeline,
  line: FundLine,
  i: number
): PricedPrototype {
  const choice = timeline.frameAt(line.viewMonth[i]).view.pre.choice;
  return sizedPrototype(choice, line.btype[i], line.stories[i], line.units[i], line.cstep[i]);
}
