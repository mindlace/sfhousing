/**
 * "Where these numbers come from" (spec §4.10). Pure: turns the calibration, the T8 score and
 * `projects.json` into sections of plain strings for `SourcesDialog.svelte`. Transition shares
 * come from `cumulativeIncidence` (tail included); nothing here re-derives them.
 */
import { formatCount } from '$lib/scoreboard/format';
import type { TimelineScore } from '$lib/sim/protocol';
import { cumulativeIncidence } from '$lib/timelapse/model';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';
import type {
  Calibration,
  FeatureId,
  Pathway,
  Provenance,
  Stage,
  Transition
} from '$lib/timelapse/types';
import { transitionSectionId, LOCAL_PROGRAM_SECTION_ID } from './card';
import { SERIES_NAME } from './chart';
import { formatDate } from './format';
import { EXIT_LABEL, PATHWAY_LABEL, TIER_LABEL, inStageLabel } from './labels';

export interface ProvEntry {
  id: string;
  title: string;
  prov: Provenance;
  /** Tier label, label, method, "based on N records", "records from … to …", then fixed sentences. */
  lines: string[];
  /** A second provenance line, for a transition's tail beyond the observed months. */
  tail: Provenance | null;
  /** 'Within 12 months: …' lines; transitions only. */
  shares: string[];
  /** Tier 3 or 4: the dialog adds `NOT_SF_NOTE`. */
  research: boolean;
}

export interface ProvSection {
  id: string;
  heading: string;
  intro: string[];
  entries: ProvEntry[];
  tables: { caption: string; head: string[]; rows: string[][] }[];
}

export const HOW_TO_READ_SENTENCE =
  'Every number the simulation uses comes from the best evidence available, and says which kind it is.';

export const PERMIT_WINDOW_SENTENCE =
  "Building-permit stages use records from 2007 on, the first year the assessor's roll can say how many homes a site had before the project.";

export const PHASE_GAP_SENTENCE =
  "This gap is measured on building permits alone, so its records start earlier than the stage tables'.";

export const PATHWAY_RULE_SENTENCE =
  'New projects on Local Program parcels always take the streamlined path. That is a rule (administrative approval with a 180-day clock), tier 1. The shares below apply to other parcels.';

export const PLAN_EFFECT_SENTENCE =
  "To see what the plan itself does, each future is run twice: once with the Family Zoning Plan, and once as the same city simulated under the old zoning, with the same luck. The difference between the two is the plan's effect. Some homes would have been built anyway; they are not counted here.";

export const TWIN_RESIZE_SENTENCE =
  "Under the old zoning a real project's resize is capped by the old height limit, so its size can differ between the two runs. That difference is a real effect of the plan, but it appears only in 'from today's pipeline', not in 'what the plan added', so that the published estimates compare like with like.";

export const PHASE_DELAY_SENTENCE =
  "Where no published schedule gives a start date, the first phase starts after the master plan's approval by a gap drawn from the phase gap. That is the typical gap between successive phases of past projects, used here as a stand-in for the wait before the first phase (tier 2, proxy).";

export const UNENRICHED_SENTENCE =
  "These are simulated as one project each. Where the site has lots that no other project holds, the project is drawn as one footprint on them. Where another project in the pipeline already holds every lot (in every known case, one of the same development's own phases), it is counted in the score but not drawn.";

export const QUALITY_SECTION_ID = 'src-quality';
export const QUALITY_HEADING = 'How the records were checked';

export const QUALITY_INTRO =
  "The city's records are checked for missing and impossible values before the simulation uses them. Every rule that changes or estimates a value is listed in each data build with how often it fired. The rules below changed a value of at least one project in today's pipeline; that project's card says so.";

export const QUALITY_EMPTY = "No project's values were changed by the data checks.";

export const QUALITY_PARCEL_SENTENCE =
  "Checks on the assessor's roll and on the stage tables follow the same rules; a value they replace is marked as estimated in the data and is never shown as a record.";

export const QUALITY_LOAD_FAILED = "The list of data checks couldn't be loaded.";

export const NOT_SF_NOTE = 'Not from San Francisco records.';

const SHARE_MONTHS = [12, 24, 60] as const;
const PERMIT_STAGES: readonly Stage[] = ['permitFiled', 'permitIssued', 'construction'];

const pct = (x: number) => `${Math.round(100 * x)}%`;
const isResearch = (p: Provenance) => p.tier >= 3;

/** Tier label, label, method, then the record count and window when the provenance has them. */
export function provenanceLines(p: Provenance): string[] {
  const lines = [TIER_LABEL[p.tier], p.label, p.method];
  if (p.n !== undefined) lines.push(`based on ${formatCount(p.n)} records`);
  if (p.window !== undefined) lines.push(`records from ${p.window[0]} to ${p.window[1]}`);
  return lines;
}

/** "Within 12 months: 34% advanced, 5% withdrawn", for 12, 24 and 60 months. */
export function transitionShares(t: Transition): string[] {
  return SHARE_MONTHS.map((k) => {
    const inc = cumulativeIncidence(t, k);
    const parts = [`${pct(inc.advance)} advanced`];
    for (const [reason, share] of Object.entries(inc.exit)) {
      parts.push(`${pct(share)} ${EXIT_LABEL[reason as keyof typeof EXIT_LABEL] ?? reason}`);
    }
    return `Within ${k} months: ${parts.join(', ')}`;
  });
}

function entry(
  id: string,
  title: string,
  prov: Provenance,
  extra: { after?: string[]; shares?: string[]; tail?: Provenance } = {}
): ProvEntry {
  return {
    id,
    title,
    prov,
    lines: [...provenanceLines(prov), ...(extra.after ?? [])],
    tail: extra.tail ?? null,
    shares: extra.shares ?? [],
    research: isResearch(prov)
  };
}

function transitionEntry(p: Pathway, s: Exclude<Stage, 'complete'>, t: Transition): ProvEntry {
  return entry(transitionSectionId(p, s), `${PATHWAY_LABEL[p]}: ${inStageLabel(s)}`, t.provenance, {
    after: PERMIT_STAGES.includes(s) ? [PERMIT_WINDOW_SENTENCE] : [],
    shares: transitionShares(t),
    tail: t.tailProvenance
  });
}

function transitionsSection(cal: Calibration): ProvSection {
  const entries: ProvEntry[] = [];
  for (const p of PATHWAYS) {
    for (const s of STAGE_ORDER) {
      if (s === 'complete') continue;
      const t = cal.transitions[p][s];
      if (t) entries.push(transitionEntry(p, s, t));
    }
    if (p === 'streamlined') {
      entries.push(
        entry(
          LOCAL_PROGRAM_SECTION_ID,
          'Local Program projects use the streamlined tables',
          cal.streamlinedForLocalProgram
        )
      );
    }
  }
  return {
    id: 'src-transitions',
    heading: 'How projects move through the stages',
    intro: [],
    entries,
    tables: []
  };
}

const LAND_USE = ['residential', 'mixed', 'commercial', 'pdr', 'vacant', 'other'];

const FEATURE_LABEL: Record<FeatureId, string> = {
  potentialRatio: 'Homes allowed ÷ homes there now',
  existingUnits: 'Homes there now',
  lotAreaM2: 'Lot area (square meters)',
  yearBuilt: 'Year built',
  storiesGap: 'Stories allowed above the existing building',
  improvementShare: 'Share of assessed value in the building',
  rentControlLikely: 'Likely rent-controlled (2 or more homes, built before 1979)',
  landUseClass: 'Land use'
};

const CATEGORIES: Partial<Record<FeatureId, string[]>> = {
  landUseClass: LAND_USE,
  rentControlLikely: ['no', 'yes']
};

function binText(feature: FeatureId, bins: number[], j: number): string {
  const names = CATEGORIES[feature];
  if (names) return names[bins[j]] ?? String(bins[j]);
  if (bins.length === 1) return 'any';
  if (j === 0) return `under ${bins[1]}`;
  if (j === bins.length - 1) return `${bins[j]} or more`;
  return `${bins[j]} to under ${bins[j + 1]}`;
}

/** Two decimals, U+2212 for negatives, no trailing zeros. */
function coefText(x: number): string {
  const r = Number(x.toFixed(2));
  return (r < 0 ? '−' : '') + String(Math.abs(r));
}

function initiationSection(cal: Calibration): ProvSection {
  const { initiation } = cal;
  const head = ['Feature', 'Bin', 'Coefficient'];
  const rows: string[][] = [];
  if (initiation.terms.length === 0) {
    rows.push([`Intercept only: ${coefText(initiation.intercept)}`]);
  }
  for (const term of initiation.terms) {
    term.bins.forEach((_, j) => {
      rows.push([
        FEATURE_LABEL[term.feature],
        binText(term.feature, term.bins, j),
        coefText(term.coef[j])
      ]);
    });
  }
  return {
    id: 'src-initiation',
    heading: 'Where new projects start',
    intro: [],
    entries: [
      entry('src-initiation-model', 'Chance a parcel starts a project', initiation.provenance)
    ],
    tables: [{ caption: 'What raises or lowers the monthly chance', head, rows }]
  };
}

function sizeSection(cal: Calibration): ProvSection {
  const { size } = cal;
  const rows = size.byEnvelope.flatMap((band) =>
    size.fillLevels.map((fill, j) => [
      `Up to ${band.maxStoriesUpTo} stories`,
      `${Number((fill * 100).toFixed(1))}% of the allowed height`,
      pct(band.probs[j])
    ])
  );
  return {
    id: 'src-size',
    heading: 'How big new projects are',
    intro: [],
    entries: [entry('src-size-model', 'Size of a new project', size.provenance)],
    tables: [
      {
        caption: 'Share of new projects at each fill level',
        head: ['Allowed height', 'Fill level', 'Share'],
        rows
      }
    ]
  };
}

function revisionSection(cal: Calibration): ProvSection {
  const { revision } = cal;
  const rows = revision.at.map((a) => {
    const { edges, probs } = a.ratio;
    let shrink = 0;
    let grow = 0;
    probs.forEach((p, j) => {
      if (edges[j + 1] <= 1) shrink += p;
      if (edges[j] >= 1) grow += p;
    });
    return [inStageLabel(a.stage), pct(a.probability), pct(shrink), pct(grow)];
  });
  return {
    id: 'src-revision',
    heading: 'How projects change size',
    intro: [],
    entries: [entry('src-revision-model', 'Resizing before construction', revision.provenance)],
    tables: [
      {
        caption: 'Chance of a resize on entering each stage',
        head: ['On entering', 'Chance of a resize', 'Resized smaller', 'Resized larger'],
        rows
      }
    ]
  };
}

function pathwaySection(cal: Calibration): ProvSection {
  return {
    id: 'src-pathway',
    heading: 'Which approval path',
    intro: [PATHWAY_RULE_SENTENCE],
    entries: [
      entry('src-pathway-for-new', 'Approval path of a new project', cal.pathwayForNew.provenance),
      entry('src-ppa-share', 'Start at pre-application', cal.ppaShare.provenance)
    ],
    tables: [
      {
        caption: 'Shares of new projects by approval path',
        head: ['Approval path', 'Share of new projects', 'Of those, start at pre-application'],
        rows: PATHWAYS.map((p) => [
          PATHWAY_LABEL[p],
          pct(cal.pathwayForNew[p]),
          pct(cal.ppaShare[p])
        ])
      }
    ]
  };
}

const MEASURE_SERIES = {
  'planEffect.entitledNew': 'planEntitled',
  'planEffect.completedNetNew': 'planCompleted',
  completedNet: 'total'
} as const;

function targetsSection(score: TimelineScore, asOf: Day): ProvSection {
  const targets = score.targets.map(({ target, deadline }) =>
    entry(`src-target-${target.id}`, target.label, {
      tier: 1,
      label: target.source.label,
      sources: [target.source],
      method: `Target: ${formatCount(target.units)} net new homes by ${formatDate(deadline)}.`
    })
  );
  const references = score.references.map((r) =>
    entry(`src-reference-${r.id}`, r.label, r.provenance, {
      after: [`Compared with: ${SERIES_NAME[MEASURE_SERIES[r.measure]]}`]
    })
  );
  return {
    id: 'src-targets',
    heading: 'Targets and published estimates',
    intro: [
      PLAN_EFFECT_SENTENCE,
      TWIN_RESIZE_SENTENCE,
      `Simulated counts start on ${formatDate(asOf)}.`
    ],
    entries: [...targets, ...references],
    tables: []
  };
}

function multiphaseSection(cal: Calibration, phasing: TimelineScore['phasing']): ProvSection {
  const { masters, enrichedMasters, phasesScheduled, phasesEstimated, unenriched } = phasing;
  const intro = [
    `${masters} multi-phase projects, of which ${enrichedMasters} have a published Development Agreement phasing plan (tier 1). ${phasesScheduled} phases are scheduled from those plans, and ${phasesEstimated} are estimated from past projects (tier 2).`,
    'How estimated phases are built:',
    'Phase size: the median completed building size.',
    'Start gaps: the typical gap between successive phases of past projects (below).',
    'At most one phase per parcel; extra units are spread over the existing phases.',
    PHASE_DELAY_SENTENCE
  ];
  if (unenriched.length > 0) intro.push(UNENRICHED_SENTENCE);
  const list = (caption: string, drawn: boolean) => {
    const rows = unenriched
      .filter((u) => u.drawn === drawn)
      .map((u) => [u.label ?? u.projectId, formatCount(u.units)]);
    return rows.length === 0
      ? []
      : [{ caption: `${caption} (${rows.length})`, head: ['Project', 'Homes'], rows }];
  };
  return {
    id: 'src-multiphase',
    heading: 'Multi-phase projects',
    intro,
    entries: [
      entry('src-phase-gap', 'Gap between phases', cal.phaseGap.provenance, {
        after: [PHASE_GAP_SENTENCE]
      })
    ],
    tables: [...list('Drawn as one footprint', true), ...list('Counted but not drawn', false)]
  };
}

/**
 * Sections 1-9 of the dialog, in spec order. Section 9 only when the score has multi-phase
 * projects; sections 2 and 8 only once a score exists. Section 10 is rendered separately
 * (`qualityRows`). Simulated counts start on the calibration's `asOf`.
 */
export function provenanceSections(cal: Calibration, score: TimelineScore | null): ProvSection[] {
  const out: ProvSection[] = [
    {
      id: 'src-how-to-read',
      heading: 'How to read this',
      intro: [HOW_TO_READ_SENTENCE],
      entries: [],
      tables: [
        {
          caption: 'Kinds of evidence',
          head: ['Tier', 'Kind of evidence'],
          rows: ([0, 1, 2, 3, 4] as const).map((tier) => [String(tier), TIER_LABEL[tier]])
        }
      ]
    }
  ];
  if (score) {
    const { baseline } = score;
    out.push({
      id: 'src-actual',
      heading: 'Actual completions',
      intro: [],
      entries: [
        entry(
          'src-baseline',
          `Net homes completed since ${formatDate(baseline.since)}`,
          baseline.provenance
        )
      ],
      tables: []
    });
  }
  out.push(
    transitionsSection(cal),
    initiationSection(cal),
    sizeSection(cal),
    revisionSection(cal),
    pathwaySection(cal)
  );
  if (score) {
    out.push(targetsSection(score, cal.asOf));
    if (score.phasing.masters > 0) out.push(multiphaseSection(cal, score.phasing));
  }
  return out;
}

/** Section 10 rows: one per `qualityRules` entry, in file order. */
export function qualityRows(file: ProjectsFile): {
  id: string;
  label: string;
  tierLabel: string;
  research: boolean;
  count: number;
}[] {
  return file.qualityRules.map((rule) => {
    const tier = rule.valueTier ?? rule.tier;
    return {
      id: rule.id,
      label: rule.label,
      tierLabel: TIER_LABEL[tier],
      research: tier >= 3,
      count: file.projects.filter((p) => p.quality.includes(rule.id)).length
    };
  });
}

/**
 * Fetches and validates `projects.json` (imported dynamically, so the validator stays out of the
 * first bundle). An invalid project is dropped silently (the worker already reported it), so the
 * result may fail a strict re-parse: do not re-validate it. A file-level violation rejects.
 */
export async function loadProjectsFile(url: string, fetchFn: typeof fetch): Promise<ProjectsFile> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`projects.json: HTTP ${res.status}`);
  const json: unknown = await res.json();
  const { parseProjectsFile } = await import('$lib/timelapse/projects');
  return parseProjectsFile(json, { onInvalid: () => {} });
}
