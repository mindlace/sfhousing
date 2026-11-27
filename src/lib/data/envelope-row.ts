// One envelope row, shared by the pipeline's layers (parcels.bin, policy.bin): a lot's story limit,
// its unit cap and whether it may host a new project. A lot's homes at any envelope are its
// building options' (options.bin, src/lib/sim/choice): those at or below the story limit, each
// clipped by the cap.
import { capHomes } from '../sim/choice/choose';

export interface EnvelopeRow {
  stories: number;
  cap: number | null;
  hostable: boolean;
}

/** One building option as the envelope reads it: its stories and homes. */
export interface OptionSize {
  stories: number;
  homes: number;
}

/** Per-row options in CSR form (an OptionTable, or the pipeline's candidates). */
export interface OptionTops {
  offset: ArrayLike<number>;
  stories: ArrayLike<number>;
  homes: ArrayLike<number>;
}

/** Row `i`'s options as OptionSize values. */
export function optionsOfRow(t: OptionTops, i: number): OptionSize[] {
  const out: OptionSize[] = [];
  for (let j = t.offset[i]; j < t.offset[i + 1]; j++)
    out.push({ stories: t.stories[j], homes: t.homes[j] });
  return out;
}

/**
 * The most homes after `cap` (`capHomes`) among `options` at or below `stories`, whether or not
 * they gain a home over `existingUnits`; 0 when none is allowed. Rule A's capacity of the lot is
 * this less its existing homes (never below 0).
 */
export function topHomesAt(
  options: readonly OptionSize[],
  stories: number,
  cap: number | null,
  existingUnits: number
): number {
  let top = 0;
  for (const o of options) {
    if (o.stories > stories) continue;
    top = Math.max(top, capHomes(o.homes, cap, existingUnits));
  }
  return top;
}

/**
 * One envelope as parcels.bin computes FZP's: `top` is `topHomesAt` its stories and cap (0 with
 * no envelope), and the lot hosts when it is eligible, has at least one story and some allowed
 * option has more homes than it has now, before the cap (the cap shapes the homes, never the
 * at-risk set: partner ruling, option c; the run time's view applies it, rule A).
 */
export function envelopeRow(a: {
  stories: number;
  cap: number | null;
  eligible: boolean;
  existingUnits: number;
  options: readonly OptionSize[];
}): EnvelopeRow & { top: number } {
  const top = a.stories === 0 ? 0 : topHomesAt(a.options, a.stories, a.cap, a.existingUnits);
  const gains = a.stories >= 1 && topHomesAt(a.options, a.stories, null, 0) > a.existingUnits;
  return { stories: a.stories, cap: a.cap, hostable: a.eligible && gains, top };
}
