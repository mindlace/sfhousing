/**
 * Project card logic (spec §4.8). Pure: everything the card shows is derived from a `ProjectCard`
 * and the scrubbed day. Chance and incidence come from `$lib/timelapse/model`; nothing here
 * computes them.
 */
import type { ProjectCard } from '$lib/sim/protocol';
import { formatCount } from '$lib/scoreboard/format';
import type { chanceTable } from '$lib/timelapse/model';
import { monthsIn, type Day } from '$lib/timelapse/time';
import { pathwayStages } from '$lib/timelapse/types';
import type { Calibration, Pathway, Stage } from '$lib/timelapse/types';
import { formatCardDate, formatChance, formatDate, formatShortMonthYear } from './format';
import { EXIT_LABEL, TIER_LABEL, enteredLabel, inStageLabel, masterEnteredLabel } from './labels';
import type { CardStatus } from './types';

export type ChanceTable = ReturnType<typeof chanceTable>;

export const SIMULATED_DISCLAIMER =
  "Not a real proposal. In this simulated future a project starts on this parcel. The parcel was picked by chance, weighted by how often parcels like it have been redeveloped. It says nothing about the owner's plans.";

export const CHANCE_EXPLANATION =
  'The share of similar projects that finish from this point. It is not a prediction for this project.';

export const RESEARCH_NOTE = 'partly based on research estimates, not San Francisco records';

const UNENRICHED_NOTE =
  "Multi-phase project without published or estimated phases; drawn as one footprint on the site's lots that no other project holds";

const DATA_NOTES_FOOTER =
  "The data checks changed or estimated some values on this card, so not every value is the record's own.";

/** `chance[pathway][stage]` has this many entries; later months read the last one. */
const LAST_CHANCE_MONTH = 240;

/** Dialog section ids (spec §4.10) the card's "How is this estimated?" list links to. */
export const LOCAL_PROGRAM_SECTION_ID = 'src-local-program';
export const transitionSectionId = (p: Pathway, s: Stage) => `src-transition-${p}-${s}`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The entry for the last stage on or before `day`; `-1` if none. */
function currentIndex(stages: ProjectCard['stages'], day: Day): number {
  let found = -1;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].day <= day) found = i;
  }
  return found;
}

/** The last revision on or before `day`; before every revision, the first (the proposal). */
function revisionAt(card: ProjectCard, day: Day): { units: number; stories: number | null } {
  let found: ProjectCard['revisions'][number] | undefined;
  for (const r of card.revisions) {
    if (r.day <= day) found = r;
  }
  found ??= card.revisions[0];
  return found ?? { units: card.units, stories: card.stories };
}

/**
 * The card's status at `day`, or null before its first stage. The current stage is the last
 * `stages` entry on or before `day`, unless `end` has been reached (spec §4.8). For an exit,
 * `monthsInStage` is the time spent in the stage it stopped in; for a completion it is 0.
 */
export function cardStatus(card: ProjectCard, day: Day, chance: ChanceTable): CardStatus | null {
  const i = currentIndex(card.stages, day);
  if (i < 0) return null;
  const { units, stories } = revisionAt(card, day);
  const end = card.end;
  if (end !== null && end.kind !== 'open' && end.day <= day) {
    if (end.kind === 'complete') {
      return {
        kind: 'complete',
        stage: 'complete',
        monthsInStage: 0,
        day,
        units,
        stories,
        chance: null
      };
    }
    const entered = card.stages.find((s) => s.stage === end.stage)?.day;
    return {
      kind: 'exited',
      stage: end.stage,
      monthsInStage: entered === undefined ? 0 : monthsIn(entered, end.day),
      day,
      units,
      stories,
      chance: null
    };
  }
  const { stage, day: entered } = card.stages[i];
  const months = monthsIn(entered, day);
  if (stage === 'complete') {
    return { kind: 'complete', stage, monthsInStage: months, day, units, stories, chance: null };
  }
  const table = chance[card.pathway][stage];
  const p = table?.[Math.min(Math.max(months, 0), LAST_CHANCE_MONTH)];
  return {
    kind: 'inStage',
    stage,
    monthsInStage: months,
    day,
    units,
    stories,
    chance: p ?? null
  };
}

/** "Under construction, 4 months so far", "Completed Mar 4, 2031", "Stopped during …". */
export function statusText(s: CardStatus, card: ProjectCard, asOf: Day): string {
  if (s.kind === 'inStage') {
    const n = s.monthsInStage;
    return `${inStageLabel(s.stage)}, ${n} ${plural(n, 'month', 'months')} so far`;
  }
  const end = card.end;
  if (s.kind === 'complete') {
    const done =
      end?.kind === 'complete'
        ? end.day
        : (card.stages.find((x) => x.stage === 'complete')?.day ?? s.day);
    return `Completed ${formatCardDate(done, asOf)}`;
  }
  const reason = end?.kind === 'exit' ? EXIT_LABEL[end.reason] : 'stopped';
  const when = end !== null && end.kind !== 'open' ? end.day : s.day;
  return `Stopped during ${inStageLabel(s.stage)} (${reason}), ${formatCardDate(when, asOf)}`;
}

/** The stories part of the size line (spec §4.8 table), or null when unknown. */
export function storiesText(card: ProjectCard, stories: number | null): string | null {
  if (stories === null) return null;
  const n = Math.round(stories);
  const count = `${n} ${plural(n, 'story', 'stories')}`;
  if (card.origin === 'simulated' || card.storiesTier === 0) return count;
  if (card.storiesTier === 3) return `about ${count}, from the project description`;
  // Tier 4, or a count of unknown origin (T6 says it cannot happen): never shown as a record.
  return `about ${count} (simulated)`;
}

/** "24 homes · 6 stories · replaces 2 existing homes (assessor) (net +22)". */
export function sizeLine(card: ProjectCard, day: Day, marked: boolean): string {
  const { units, stories } = revisionAt(card, day);
  const existing = card.existingUnits;
  const net = units - existing;
  const parts = [`${formatCount(units)} ${plural(units, 'home', 'homes')}`];
  const storiesPart = storiesText(card, stories);
  if (storiesPart !== null) parts.push(storiesPart);
  const assessor = marked ? 'assessor*' : 'assessor';
  parts.push(
    `replaces ${formatCount(existing)} existing ${plural(existing, 'home', 'homes')} (${assessor}) ` +
      `(net ${net < 0 ? '' : '+'}${formatCount(net)})`
  );
  return parts.join(' · ');
}

/** One line per later revision: "Resized: 24 → 30 homes, Mar 2028, simulated". */
export function revisionLines(card: ProjectCard, asOf: Day): string[] {
  const lines: string[] = [];
  for (let i = 1; i < card.revisions.length; i++) {
    const prev = card.revisions[i - 1];
    const rev = card.revisions[i];
    const after = rev.day > asOf ? ', simulated' : '';
    lines.push(
      `Resized: ${formatCount(prev.units)} → ${formatCount(rev.units)} ` +
        `${plural(rev.units, 'home', 'homes')}, ${formatCardDate(rev.day, asOf)}${after}`
    );
  }
  return lines;
}

/** "Chance of finishing from here: 62%". */
export function chanceLine(p: number): string {
  return `Chance of finishing from here: ${formatChance(p)}`;
}

/**
 * The evidence behind the chance: every transition from `stage` to `complete` on the card's
 * pathway (main provenance, then its tail's), led by the Local Program proxy for a Local Program
 * project. `research` is true when any listed entry is tier 3 or worse.
 */
export function chanceProvenance(
  cal: Calibration,
  card: ProjectCard,
  stage: Stage
): { entries: { sectionId: string; tier: number; label: string }[]; research: boolean } {
  const entries: { sectionId: string; tier: number; label: string }[] = [];
  if (card.localProgram) {
    entries.push({
      sectionId: LOCAL_PROGRAM_SECTION_ID,
      tier: cal.streamlinedForLocalProgram.tier,
      label: cal.streamlinedForLocalProgram.label
    });
  }
  const path = pathwayStages(card.pathway);
  const from = path.indexOf(stage);
  if (from >= 0) {
    for (const s of path.slice(from)) {
      if (s === 'complete') continue;
      const tr = cal.transitions[card.pathway][s];
      if (tr === undefined) continue;
      const sectionId = transitionSectionId(card.pathway, s);
      entries.push({ sectionId, tier: tr.provenance.tier, label: tr.provenance.label });
      entries.push({ sectionId, tier: tr.tailProvenance.tier, label: tr.tailProvenance.label });
    }
  }
  return { entries, research: entries.some((e) => e.tier >= 3) };
}

/** Phase cards: stage rows before the building permit belong to the master plan. */
const MASTER_STAGES: readonly string[] = ['preApplication', 'filed', 'entitled'];

/**
 * One row per `stages` entry in data order, then the end. On a phase card the master-plan rows
 * come first and the first row of the phase itself carries the "This phase" heading.
 */
export function timelineRows(
  card: ProjectCard,
  asOf: Day,
  marked: boolean
): { heading: 'This phase' | null; text: string }[] {
  const recorded = marked ? 'Recorded*' : 'Recorded';
  const rows: { heading: 'This phase' | null; text: string }[] = [];
  let headed = false;
  for (const s of card.stages) {
    const master = card.phase !== null && MASTER_STAGES.includes(s.stage);
    const label = master ? masterEnteredLabel(s.stage) : enteredLabel(s.stage);
    const date = s.actual ? formatDate(s.day) : formatShortMonthYear(s.day);
    let suffix = recorded;
    if (!s.actual) {
      suffix = 'Simulated';
      if (card.phase !== null && s.stage === 'permitFiled') {
        suffix +=
          card.phase.start === 'scheduled' ? ' (published plan date)' : ' (start estimated)';
      }
    }
    let heading: 'This phase' | null = null;
    if (card.phase !== null && !master && !headed) {
      heading = 'This phase';
      headed = true;
    }
    rows.push({ heading, text: `${label} · ${date} · ${suffix}` });
  }
  const end = card.end;
  if (end !== null && end.kind !== 'open') {
    const label =
      end.kind === 'complete' ? enteredLabel('complete') : `Stopped (${EXIT_LABEL[end.reason]})`;
    rows.push({
      heading: null,
      text: `${label} · ${formatCardDate(end.day, asOf)} · ${end.day > asOf ? 'Simulated' : recorded}`
    });
  }
  return rows;
}

/** Why the building looks the way it does, or null when it is drawn from a matched shape. */
export function massingNote(card: ProjectCard): string | null {
  if (card.massing === 'approximate') return 'Building shape approximate';
  if (card.massing !== 'none') return null;
  if (card.multiPhase && card.phase === null) return UNENRICHED_NOTE;
  return 'Building not drawn; footprint only';
}

/** "Phase 3 of 12, Candlestick Point", or null for a card that is not a phase. */
export function phaseLine(card: ProjectCard): string | null {
  const phase = card.phase;
  if (phase === null) return null;
  return `Phase ${phase.index} of ${phase.of}, ${card.label}`;
}

/** The "About this record's data" block, or null when no data check touched the record. */
export function dataNotes(
  card: ProjectCard
): { heading: string; items: string[]; footer: string } | null {
  if (card.quality.length === 0) return null;
  return {
    heading: "* About this record's data",
    items: card.quality.map((q) => `${q.label} (${TIER_LABEL[q.valueTier ?? q.tier]})`),
    footer: DATA_NOTES_FOOTER
  };
}

/** DataSF datasets with a known record-id field (spec §4.8, keys verified 2026-10-16). */
export const SOURCE_DATASETS: Record<string, { key: string; name: string }> = {
  'i98e-djp9': { key: 'permit_number', name: 'Building permit' },
  'qvu5-m3a2': { key: 'record_id', name: 'Planning project' },
  'y673-d69b': { key: 'record_id', name: 'Planning record' },
  'd4jk-jw33': { key: 'b1_alt_id', name: 'Planning review' },
  'j67f-aayr': { key: 'building_permit_application', name: 'Completion certificate' },
  'xdht-4php': { key: 'bpa', name: 'Housing production record' },
  '6jgi-cpb4': { key: 'bpa_no', name: 'Development pipeline' }
};

/** One link per source: the DataSF record as JSON, or the dataset page for an unknown dataset. */
export function sourceLinks(sources: ProjectCard['sources']): { text: string; href: string }[] {
  return sources.map(({ dataset, id, key }) => {
    const known = Object.hasOwn(SOURCE_DATASETS, dataset) ? SOURCE_DATASETS[dataset] : undefined;
    if (known === undefined) {
      return { text: `${dataset} ${id}`, href: `https://data.sf.gov/d/${dataset}` };
    }
    return {
      text: `${known.name} ${id}: DataSF record (JSON)`,
      href: `https://data.sf.gov/resource/${dataset}.json?${key ?? known.key}=${encodeURIComponent(id)}`
    };
  });
}
