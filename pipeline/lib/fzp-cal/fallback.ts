/**
 * Rung 3 of the fallback ladder (stage-calibration spec §4.5): a literature synthetic, a
 * constant-hazard table with `months = 1` built from published figures (tier 1/3) and, where no
 * figure exists, made-up values (tier 4), named as such in `method`.
 */
import { REPO_URL } from '../../../src/lib/config';
import { exp, log } from '../../../src/lib/timelapse/math';
import {
  EXIT_ORDER,
  type ExitReason,
  type Pathway,
  type Provenance,
  type Transition
} from '../../../src/lib/timelapse/types';
import {
  EYE_ON_HOUSING_2026_09,
  HCD_POLICY_REVIEW,
  HOUSING_ELEMENT_APPENDIX_B,
  HOUSING_INVENTORY_2025,
  KQED_PERMIT_TIMES,
  datasf
} from './provenance';
import { CalibrationError, type CalStage } from './types';

type Source = { label: string; url: string };
type LitTier = 1 | 2 | 3 | 4;

/** The research doc: the source of the tier-3 "0–12 mo" PPA range, which cites no URL itself. */
const LITERATURE_SURVEY: Source = {
  label: 'FZP calibration literature survey (2026-10-16)',
  url: `${REPO_URL}/blob/main/docs/superpowers/research/2026-10-16-fzp-calibration-literature.md`
};

/** Where a made-up (tier 4) value is stated. */
const SPEC_FALLBACK: Source = {
  label: 'stage-calibration spec §4.5, fallback ladder (made-up values, tier 4)',
  url: `${REPO_URL}/blob/main/docs/superpowers/specs/2026-10-16-stage-calibration-design.md`
};

/** One rung-3 figure: `source` is the evidence as `method` names it, `ref` its citable source. */
interface LitFigure {
  tier: LitTier;
  source: string;
  ref: Source;
}

export interface LiteratureRow {
  /** D, the median months in the stage; per pathway where the figure is, else under 'all' */
  D: Partial<Record<Pathway | 'all', LitFigure & { months: number }>>;
  /** A, the share of leavers who advance */
  A: LitFigure & { value: number };
  /** where the exit mass goes when no exit is observed (tier 4) */
  primary: ExitReason;
}

/** Exactly the §4.5 rung-3 table. permitOnly never enters `filed`, so it has no filed D. */
export const LITERATURE: Record<CalStage, LiteratureRow> = {
  preApplication: {
    D: {
      all: { months: 6, tier: 3, source: 'literature "0–12 mo" midpoint', ref: LITERATURE_SURVEY }
    },
    A: {
      value: 0.862,
      tier: 2,
      source: '650 of 754 PPAs have a parent PRJ (probe)',
      ref: datasf('planningRecords')
    },
    primary: 'withdrawn'
  },
  filed: {
    D: {
      discretionary: {
        months: 17.2,
        tier: 1,
        source: '523-day average, 2022 APR, HCD review',
        ref: HCD_POLICY_REVIEW
      },
      streamlined: { months: 3.42, tier: 1, source: 'SB 35 median, HCD', ref: HCD_POLICY_REVIEW }
    },
    A: {
      value: 0.82,
      tier: 1,
      source: 'Housing Element conversion "PL filed"',
      ref: HOUSING_ELEMENT_APPENDIX_B
    },
    primary: 'withdrawn'
  },
  entitled: {
    D: { all: { months: 12, tier: 4, source: 'made up', ref: SPEC_FALLBACK } },
    A: {
      value: 0.66,
      tier: 1,
      source: 'Housing Element conversion "PL approved"',
      ref: HOUSING_ELEMENT_APPENDIX_B
    },
    primary: 'expired'
  },
  permitFiled: {
    D: {
      all: { months: 19.9, tier: 1, source: '605-day average, 2022 APR', ref: KQED_PERMIT_TIMES }
    },
    A: {
      value: 0.7,
      tier: 1,
      source: 'Housing Element conversion "BP filed"',
      ref: HOUSING_ELEMENT_APPENDIX_B
    },
    primary: 'expired'
  },
  permitIssued: {
    D: {
      all: {
        months: 3,
        tier: 1,
        source: '"usually within 90 days", 2025 Housing Inventory',
        ref: HOUSING_INVENTORY_2025
      }
    },
    A: { value: 0.74, tier: 2, source: 'probe cohort 196 of 266', ref: datasf('permits') },
    primary: 'expired'
  },
  construction: {
    D: {
      all: {
        months: 21.7,
        tier: 3,
        source: 'US 20+ units, Census/NAHB 2025',
        ref: EYE_ON_HOUSING_2026_09
      }
    },
    A: { value: 0.98, tier: 4, source: 'made up', ref: SPEC_FALLBACK },
    primary: 'cancelled'
  }
};

/** The DataSF dataset whose spells give a stage's observed exit shares. */
const STAGE_DATASET: Record<CalStage, Source> = {
  preApplication: datasf('planningRecords'),
  filed: datasf('planningProjects'),
  entitled: datasf('planningReview'),
  permitFiled: datasf('permits'),
  permitIssued: datasf('permits'),
  construction: datasf('permits')
};

/**
 * Rounds up to 1e-6. Rung 3 rounds up (not down, as AJ tables do) so that the synthetic median
 * is never later than D: with every value rounded up, C(k) >= 1 − 2^(−k/D). A one-month table is
 * trivially monotone, and q <= 0.5 for D >= 1 keeps the sum far below 1. A value on the 1e-6 grid
 * also has at most 6 significant digits, so the tail repeats the table value unchanged.
 */
const ceil6 = (v: number): number => Math.ceil(v * 1e6) / 1e6;

const tierText = (f: LitFigure): string =>
  f.tier === 4 ? `tier 4, made up` : `tier ${f.tier}, ${f.source}`;

/**
 * The §4.5 rung-3 table of `stage` for `pathway`: q = 1 − 2^(−1/D) = 1 − exp(−log(2)/D) through
 * `math.ts`; `advance[0]` = tail.advance = A·q; exit_j = E_j·q with E_j = (1 − A) × the stage's
 * observed exit-reason shares across all spells in the window (tier 2), or all on the primary
 * reason when `observedExitShares` is null or has no positive share (tier 4). The tier is the worst
 * of D, A and E; `tailProvenance` copies it and the sources (spec §4.4: the tail is the table).
 * `context` gives `n` (the stage's spells in the window) and `window`; a Transition of tier 0–2
 * needs it.
 */
export function rung3(
  stage: CalStage,
  pathway: Pathway,
  observedExitShares: Partial<Record<ExitReason, number>> | null,
  context?: { n: number; window: [string, string] }
): Transition {
  const row = LITERATURE[stage];
  const D = row.D[pathway] ?? row.D.all;
  if (D === undefined) {
    throw new CalibrationError(`no rung-3 duration for ${pathway} ${stage}`);
  }
  const A = row.A;
  const q = 1 - exp(-log(2) / D.months);

  let total = 0;
  for (const r of EXIT_ORDER) total += Math.max(0, observedExitShares?.[r] ?? 0);
  const observed = total > 0;
  const shares: Partial<Record<ExitReason, number>> = {};
  if (observed) {
    for (const r of EXIT_ORDER) {
      const s = observedExitShares?.[r] ?? 0;
      if (s > 0) shares[r] = s / total;
    }
  } else {
    shares[row.primary] = 1;
  }
  const eTier: LitTier = observed ? 2 : 4;
  const tier = Math.max(D.tier, A.tier, eTier) as LitTier;

  const advance = ceil6(A.value * q);
  const exit: Partial<Record<ExitReason, number[]>> = {};
  const tailExit: Partial<Record<ExitReason, number>> = {};
  for (const r of EXIT_ORDER) {
    const s = shares[r];
    if (s === undefined) continue;
    const v = ceil6((1 - A.value) * s * q);
    exit[r] = [v];
    tailExit[r] = v;
  }

  const sources: Source[] = [];
  for (const s of [D.ref, A.ref, ...(observed ? [STAGE_DATASET[stage]] : [])]) {
    if (!sources.some((t) => t.url === s.url)) sources.push(s);
  }
  if (tier <= 2 && context === undefined) {
    throw new CalibrationError(`rung 3 ${pathway} ${stage} is tier ${tier}: n and window needed`);
  }
  const exitText = observed
    ? `exits (1 − A) split by the observed exit-reason shares of every ${stage} spell in the window (tier 2): ${EXIT_ORDER.filter(
        (r) => shares[r] !== undefined
      )
        .map((r) => `${r} ${Number(shares[r]!.toPrecision(4))}`)
        .join(', ')}`
    : `exits (1 − A) all on ${row.primary} (tier 4, made up: no exit observed in the window)`;
  const method = `literature synthetic (rung 3): constant monthly hazard q = 1 − 2^(−1/D) with D = ${D.months} mo (${tierText(D)}); advance share A = ${A.value} (${tierText(A)}); ${exitText}`;
  const extra = context ? { n: context.n, window: context.window } : {};
  const provenance: Provenance = {
    tier,
    label: `Synthetic ${stage} table from published figures and stated assumptions (tier ${tier})`,
    sources,
    method,
    ...extra
  };
  const tailProvenance: Provenance = {
    tier,
    label: `Constant hazard beyond month 1 (tier ${tier})`,
    sources: sources.map((s) => ({ ...s })),
    method: 'the synthetic table is one constant monthly hazard: the tail repeats month 1',
    ...extra
  };
  return {
    months: 1,
    advance: [advance],
    exit,
    tail: { advance, exit: tailExit },
    provenance,
    tailProvenance
  };
}
