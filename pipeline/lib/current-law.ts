// Current law per lot (ruling 1): the FZP envelope, raised by Planning Code §207.11 (Ord. 082-26
// §5) where it applies, with the City's exemption tables. Pure; every parameter is in
// pipeline/sb79-config.ts (S207) with its cite. The step is writePolicy, the invariant V33.
import type { S207Status } from '../../src/lib/data/policy-codec';
import { envelopeRow, type EnvelopeRow } from '../../src/lib/data/envelope-row';
import { mostPermissive } from '../../src/lib/data/stock-layers';
import { S207, STANDARDS, type Sb79Tier, type TodBand } from '../sb79-config';
import { storiesFromFt } from './heights';
import { unitsFor } from './sb79';

export { envelopeRow, type EnvelopeRow };

/** The §207.11 status of a lot, in precedence order (§207.11(b); docs/dev/pipeline.md). */
export function s207Status(a: {
  best: { tier: Sb79Tier; band: TodBand } | null;
  eligible: boolean;
  principallyResidential: boolean;
  r4: boolean;
  historic: string;
  exempt: boolean;
  fzpHeightFt: number | null;
  fzpCap: number | null;
  lotAreaM2: number;
}): S207Status {
  if (a.best === null) return 'outside'; // (b)(1)
  if (!a.eligible) return 'not-eligible';
  if (a.exempt) return 'exempt'; // (b)(6)
  if (!a.principallyResidential) return 'not-residential'; // (b)(2)
  // fzpHeightFt is the height limit of the envelope the project uses: lpFt on a Local Program
  // lot, else baseFt ((c)(2) "the applicable height limit", UNSOURCED). No height district (null)
  // counts as not under 40 ft: tier 4, invented (UNSOURCED).
  const under40 = a.fzpHeightFt !== null && a.fzpHeightFt < S207.heightFloorFt;
  if (a.fzpCap === null && !under40) return 'no-limit'; // (b)(3)
  if (a.r4) return 'r4'; // (b)(4)
  if (S207.historicCodes.includes(a.historic)) return 'historic'; // (b)(7)
  // (b)(8): "The permitted density ... does not meet the minimum density". An uncapped lot
  // permits unlimited density, so it meets any minimum and never qualifies.
  if (a.fzpCap === null) return 'meets-minimum';
  const { tier, band } = a.best;
  const min = unitsFor(S207.minDensityDuPerAcre(tier, band), a.lotAreaM2, 1, S207.rounding);
  if (a.fzpCap >= min) return 'meets-minimum';
  return 'applies';
}

/** §207.11(c): the stories and cap of a lot where §207.11 applies. */
export function s207Envelope(a: {
  tier: Sb79Tier;
  band: TodBand;
  fzpStories: number;
  fzpHeightFt: number | null;
  fzpCap: number;
  lotAreaM2: number;
}): { stories: number; cap: number } {
  // (c)(2); no height district counts as not under 40 ft (tier 4, invented; UNSOURCED).
  const floor = a.fzpHeightFt !== null && a.fzpHeightFt < S207.heightFloorFt;
  const density = STANDARDS[a.tier][a.band].duPerAcre;
  return {
    stories: floor ? Math.max(a.fzpStories, storiesFromFt(S207.heightFloorFt)) : a.fzpStories,
    // (c)(1), combined with a larger existing cap (UNSOURCED).
    cap: Math.max(a.fzpCap, unitsFor(density, a.lotAreaM2, S207.densityShare, S207.rounding))
  };
}

/**
 * One lot under §207.11. `applies` gets the s207Envelope stories and cap with their yields;
 * every other status returns the FZP row (`fzpStories`, `fzpCap`). The SB 79 rent-control rule
 * does not apply here.
 */
export function s207Row(a: {
  best: { tier: Sb79Tier; band: TodBand } | null;
  eligible: boolean;
  principallyResidential: boolean;
  r4: boolean;
  historic: string;
  exempt: boolean;
  fzpStories: number;
  fzpHeightFt: number | null;
  fzpCap: number | null;
  lotAreaM2: number;
  existingUnits: number;
  grossAt: (stories: number) => number;
}): EnvelopeRow & { status: S207Status } {
  const status = s207Status(a);
  if (status === 'applies' && a.fzpCap === null)
    throw new Error('s207Row: applies with a null cap');
  const env =
    status === 'applies' && a.best !== null && a.fzpCap !== null
      ? s207Envelope({ ...a, fzpCap: a.fzpCap, tier: a.best.tier, band: a.best.band })
      : { stories: a.fzpStories, cap: a.fzpCap };
  const { eligible, existingUnits, grossAt } = a;
  return { status, ...envelopeRow({ ...env, eligible, existingUnits, grossAt }) };
}

const top = (r: EnvelopeRow) => ({ yieldTop: r.yield[r.yield.length - 1], hostable: r.hostable });

/**
 * Current law: §207.11 where it applies and is the more permissive layer (`mostPermissive`, a
 * tie keeps FZP); otherwise FZP. Stories, cap and yields come from one layer.
 */
export function currentLawRow(
  fzp: EnvelopeRow,
  s207: EnvelopeRow & { status: S207Status }
): EnvelopeRow & { fromS207: boolean } {
  const take = s207.status === 'applies' && mostPermissive(top(fzp), top(s207)) === 'b';
  const r = take ? s207 : fzp;
  return { stories: r.stories, cap: r.cap, yield: r.yield, hostable: r.hostable, fromS207: take };
}
