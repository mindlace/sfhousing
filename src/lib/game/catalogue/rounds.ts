import {
  BOND_PRINCIPAL,
  FEDERAL_SUPPORT_AMOUNT_PROVENANCE,
  GENERAL_FUND_FY25,
  PUBLIC_BANK_HOUSING,
  REVOLVING_FUND_SIZE,
  STATE_DOUBLE_TERM_YEARS
} from '$lib/sim-page/funding-sources';
import { bandsInnermostFirst, type TransitBand } from '$lib/sim-page/policy';
import { PRESETS, type PresetId } from '$lib/sim-page/timing';
import type { StopType } from '$lib/sim/levers/brushes';
import type { Provenance } from '$lib/timelapse/types';
import type { Policy } from '$lib/timeline/policy4';

export type PolicyKey =
  | 'transit-rail'
  | 'transit-metro'
  | 'transit-bus'
  | 'sb423-clock'
  | 'benchmark-permits'
  | 'no-discretionary'
  | 'housing-bond'
  | 'general-revenue'
  | 'revolving-fund'
  | 'federal-support'
  | 'public-bank'
  | 'state-double';

export const ROUNDS = 4;

export interface FixedBand {
  maxM: number;
  ft: number;
  stories: number;
}

interface EntryBase {
  key: PolicyKey;
  round: 1 | 2 | 3 | 4;
  label: string;
  /** One line: what the policy is (the explainer's first paragraph). */
  line: string;
  source: { text: string; href: string | null } | null;
}

export type RoundEntry =
  | (EntryBase & { kind: 'zoning'; stopTypes: StopType[]; bands: FixedBand[] })
  | (EntryBase & { kind: 'permitting'; preset: PresetId })
  | (EntryBase & { kind: 'money'; preset: string });

const SB79_URL =
  'https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB79';

const source = (p: Provenance): EntryBase['source'] => ({
  text: p.label,
  href: p.sources[0]?.url ?? null
});

const presetSource = (id: PresetId, which: 'first' | 'last'): EntryBase['source'] => {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined || !p.available) throw new Error(`preset ${id} is not available`);
  return source(which === 'first' ? p.provenance[0] : p.provenance[p.provenance.length - 1]);
};

function zoning(
  key: PolicyKey,
  round: 1 | 2 | 3 | 4,
  label: string,
  line: string,
  stopTypes: StopType[],
  bands: FixedBand[],
  src: EntryBase['source']
): RoundEntry {
  return { key, round, kind: 'zoning', label, line, source: src, stopTypes, bands };
}

function permitting(
  key: PolicyKey,
  round: 1 | 2 | 3 | 4,
  label: string,
  line: string,
  preset: PresetId,
  which: 'first' | 'last'
): RoundEntry {
  return {
    key,
    round,
    kind: 'permitting',
    label,
    line,
    preset,
    source: presetSource(preset, which)
  };
}

function money(
  key: PolicyKey,
  round: 1 | 2 | 3 | 4,
  label: string,
  line: string,
  preset: string,
  p: Provenance
): RoundEntry {
  return { key, round, kind: 'money', label, line, preset, source: source(p) };
}

/** The twelve, by round, then zoning, permitting, money. */
export const CATALOGUE: readonly RoundEntry[] = [
  zoning(
    'transit-rail',
    1,
    'Taller near BART and Caltrain',
    "What if SB 79's default tiers applied near BART and Caltrain: Tier 1 heights.",
    ['regionalRail'],
    [
      { maxM: 402, ft: 75, stories: 7 },
      { maxM: 805, ft: 65, stories: 6 }
    ],
    { text: 'SB 79 (2025), Tier 1', href: SB79_URL }
  ),
  permitting(
    'sb423-clock',
    1,
    'SB 423 clock',
    'Streamlined approvals meet the state deadline.',
    'sb423Clock',
    'first'
  ),
  money(
    'housing-bond',
    1,
    'Housing bond',
    'A City bond for affordable homes, repaid over 20 years.',
    'housing-bond',
    BOND_PRINCIPAL.provenance
  ),
  zoning(
    'transit-metro',
    2,
    'Taller near Muni Metro',
    "What if SB 79's default tiers applied near Muni Metro: Tier 2 heights.",
    ['metro'],
    [
      { maxM: 402, ft: 65, stories: 6 },
      { maxM: 805, ft: 55, stories: 5 }
    ],
    { text: 'SB 79 (2025), Tier 2', href: SB79_URL }
  ),
  permitting(
    'benchmark-permits',
    2,
    'Benchmark permits',
    'Permit review takes 134 days, not 280.',
    'benchmarkPermits',
    'last'
  ),
  money(
    'general-revenue',
    2,
    'General revenue',
    'More City money for affordable homes each year for 30 years.',
    'general-revenue',
    GENERAL_FUND_FY25.provenance
  ),
  zoning(
    'transit-bus',
    3,
    'Taller near bus',
    "What if SB 79's default tiers applied at rapid and frequent bus stops, one step below Tier 2.",
    ['rapidBus', 'frequentBus'],
    [
      { maxM: 300, ft: 55, stories: 5 },
      { maxM: 600, ft: 45, stories: 4 }
    ],
    null
  ),
  money(
    'revolving-fund',
    3,
    'Revolving fund',
    'A $100 million fund that lends to private builders.',
    'revolving-fund',
    REVOLVING_FUND_SIZE.provenance
  ),
  money(
    'federal-support',
    3,
    'Federal support',
    'A yearly federal grant for ten years.',
    'federal-support',
    FEDERAL_SUPPORT_AMOUNT_PROVENANCE
  ),
  permitting(
    'no-discretionary',
    4,
    'No discretionary review',
    'Projects that meet the code skip hearings.',
    'noDiscretionary',
    'first'
  ),
  money(
    'public-bank',
    4,
    'Public bank',
    'Public bank loans to affordable housing.',
    'public-bank',
    PUBLIC_BANK_HOUSING.provenance
  ),
  money(
    'state-double',
    4,
    'State money doubled',
    "Twice today's state money for ten years.",
    'state-double',
    STATE_DOUBLE_TERM_YEARS.provenance
  )
];

export const POLICY_KEYS: readonly PolicyKey[] = CATALOGUE.map((e) => e.key);

export function isPolicyKey(x: string): x is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(x);
}

export function roundEntries(round: number): RoundEntry[] {
  return CATALOGUE.filter((e) => e.round === round);
}

export function entryOf(key: string): RoundEntry | undefined {
  return CATALOGUE.find((e) => e.key === key);
}

/**
 * A transit policy whose id is a transit key; a routes policy whose preset is a permitting
 * entry's; a fund, baseline or terms policy whose string preset is a money entry's; else null.
 */
export function keyOf(p: Policy): PolicyKey | null {
  const w = p.where.tag;
  if (w === 'transit') {
    const e = entryOf(p.id);
    return e !== undefined && e.kind === 'zoning' ? e.key : null;
  }
  if (p.preset === null) return null;
  const kind =
    w === 'routes'
      ? 'permitting'
      : w === 'fund' || w === 'baseline' || w === 'terms'
        ? 'money'
        : null;
  if (kind === null) return null;
  const e = CATALOGUE.find((x) => x.kind === kind && 'preset' in x && x.preset === p.preset);
  return e === undefined ? null : e.key;
}

const metres = (m: number): string => m.toLocaleString('en-US');

/**
 * "75 ft within 402 m, 65 ft from 402 to 805 m" when `bands` equal `entry`'s fixed bands (maxM and
 * stories), else "7 stories within 402 m, 6 stories from 402 to 805 m".
 */
export function bandsText(bands: readonly TransitBand[], entry?: RoundEntry): string {
  const sorted = bandsInnermostFirst(bands);
  const fixed = entry?.kind === 'zoning' ? entry.bands : null;
  const same =
    fixed !== null &&
    fixed.length === sorted.length &&
    fixed.every((f, i) => f.maxM === sorted[i].maxM && f.stories === sorted[i].stories);
  return sorted
    .map((b, i) => {
      const what = same
        ? `${fixed[i].ft} ft`
        : `${b.stories} ${b.stories === 1 ? 'story' : 'stories'}`;
      return i === 0
        ? `${what} within ${metres(b.maxM)} m`
        : `${what} from ${metres(sorted[i - 1].maxM)} to ${metres(b.maxM)} m`;
    })
    .join(', ');
}

/**
 * Zoning: bandsText of `p`'s first bands span (entry's bands without `p`). Others: `line` with its
 * first letter lowered and its final period dropped.
 */
export function rulesText(entry: RoundEntry, p?: Policy): string {
  if (entry.kind === 'zoning') {
    const span = p?.spans.find((s) => s.what.tag === 'bands');
    const bands = span !== undefined && span.what.tag === 'bands' ? span.what.bands : entry.bands;
    return bandsText(bands, entry);
  }
  const line = entry.line.replace(/\.$/, '');
  return line.charAt(0).toLowerCase() + line.slice(1);
}
