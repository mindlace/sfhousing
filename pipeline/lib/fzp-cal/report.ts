/**
 * `calibration-report.md` (stage-calibration spec §4.10; section 11, market-baseline spec §4.7;
 * sections 12 and 13, finance-data spec 4.7 and 4.8): the thirteen sections in order, deterministic
 * Markdown with no wall-clock time. Pipeline-internal, never shipped. Every number is printed by
 * `num`, which writes a non-finite value as "none".
 */
import { isoOf } from '../../project-records/parse';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { eventualProbabilities, typicalMonths } from '../../../src/lib/timelapse/model';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type MarketModel,
  type Pathway,
  type ProjectHistory,
  type Provenance,
  type Stage
} from '../../../src/lib/timelapse/types';
import { qualityRule } from '../quality';
import type { AffordableReport, FundedGroup, SiteGroup } from './affordable';
import { OUTCOMES, ajEnd } from './aalen-johansen';
import {
  FZP_BAND,
  INITIAL_EDGES,
  type InitiationReport,
  type InitiationTermReport
} from './initiation';
import type { MarketReport } from './market';
import type { FitCell, InitiationEvents, PanelResult } from './panel';
import { sig6 } from './tail';
import type { PurgeExit } from './purge';
import { REVISION_EDGES } from './revision';
import { SIZE_EDGES } from './size';
import type { CellReport, FitResult, NoFcdCell } from './transitions';
import {
  SC_RULE_IDS,
  type CalProfile,
  type CalStage,
  type NormHistory,
  type PermitRow,
  type PurgeWindow,
  type RuleTally,
  type ScRuleId,
  type Spell,
  type Tallies
} from './types';
import {
  COVERAGE,
  LOCAL_PROGRAM_START,
  PANEL_FIRST_MONTH,
  PANEL_LAST_MONTH,
  PHASE_GAP_START,
  PLANNING_START
} from './window';

export interface ReportInput {
  datasetVersion: string;
  cal: CalProfile;
  calibration: Calibration;
  /** the `calibration.*` counts */
  counts: Record<string, number>;
  tallies: Tallies;
  /** qualifying histories after normalisation and purge censoring, sorted by id */
  norm: NormHistory[];
  spells: Spell[];
  permits: PermitRow[];
  perStage: Record<ScRuleId, Partial<Record<Stage, number>>>;
  /** `purgeCensor`'s unwindowed tally, every window and every exit */
  purge: { tally: RuleTally; windows: PurgeWindow[]; exits: PurgeExit[] };
  permitOnlyPre2015: { fired: number; of: number };
  sizeOverEnvelope: { fired: number; of: number };
  fit: FitResult;
  initiation: InitiationReport;
  panel: PanelResult;
  events: Omit<InitiationEvents, 'timeline'>;
  backcast: { ok: boolean; detail: string };
  lpDiag: { filings: number; medianFiledToEntitled: number | null };
  phaseGap: { rung: 1 | 2 | 3; groups: number };
  /** today's market, the weights and the cross-check (market-baseline spec §4.7) */
  market: MarketReport;
  /** publicly funded housing: routes, stages, baseline funding and site choice (finance-data) */
  affordable: AffordableReport;
  warnings: string[];
}

/**
 * The thirteen section headings, in order (spec §4.10; market-baseline spec §4.7; finance-data
 * spec 4.7, 4.8).
 */
export const REPORT_SECTIONS = [
  '# Calibration report',
  '## 2. Fitting windows',
  '## 3. Transition tables',
  '## 4. Construction duration: TCO versus completed_date',
  '## 5. Initiation',
  '## 6. Size and revision',
  '## 7. New projects: pathway mix and ppaShare',
  '## 8. Parameter index',
  '## 9. Method constants',
  '## 10. Data-quality rules (sc.*) and method counts',
  "## 11. Today's market",
  '## 12. Publicly funded housing: routes, stages and baseline funding',
  '## 13. Where publicly funded housing starts'
] as const;

/** A number for the report: integers as is, others to 6 significant digits, non-finite "none". */
export function num(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'none';
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(6)));
}

const share = (a: number, b: number): string => (b > 0 ? `${num((100 * a) / b)}%` : 'none');

function table(head: string[], rows: (string | number)[][]): string[] {
  const cell = (v: string | number) =>
    (typeof v === 'number' ? num(v) : v).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)
  ];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Net units at the first recorded stage (the qualifying predicate's value). */
function netUnits(h: ProjectHistory): number {
  for (const s of STAGE_ORDER) {
    const u = h.unitsAt[s];
    if (typeof u === 'number' && Number.isFinite(u)) return u - h.existingUnits;
  }
  return 0;
}

function header(x: ReportInput): string[] {
  const c = x.counts;
  return [
    `${REPORT_SECTIONS[0]}: ${x.datasetVersion}`,
    '',
    `Profile \`${x.cal.name}\`; as of ${isoOf(x.calibration.asOf)}. Generated by the stage-calibration build step; deterministic (no wall-clock time). Not shipped.`,
    '',
    `- histories: ${num(c['calibration.histories'])}; qualifying (≥ 1 net unit at the first recorded stage): ${num(c['calibration.qualifying'])}; pathway unknown after normalisation (T4d nulls only, counted before the permit-only pre-2015 rule; calibration.method.permitOnlyPre2015 is separate and additive): ${num(c['calibration.pathwayNull'])}`,
    `- spells in the pooled windows: ${x.spells.length}; rung-3 cells: ${num(c['calibration.rung3'])}; calibration.json bytes: ${Buffer.byteLength(JSON.stringify(x.calibration))}`,
    `- warnings:${x.warnings.length === 0 ? ' none' : ''}`,
    ...x.warnings.map((w) => `  - ${w}`)
  ];
}

function windows(x: ReportInput): string[] {
  const out = [
    REPORT_SECTIONS[1],
    '',
    ...table(
      ['stage', 'side', 'pooled window start', 'pathway window start', 'entry end', 'evidence'],
      COVERAGE.map((r) => [
        r.stage,
        r.side,
        r.pooledStart,
        r.pathwayStart,
        r.entryEnd ?? 'none',
        r.evidence
      ])
    ),
    '',
    `A spell is kept iff it ends on or after its window start and was entered before as-of; it enters the risk set at the window start (left truncation). \`phaseGap\` uses its own window from ${PHASE_GAP_START}; the initiation panel runs ${PANEL_FIRST_MONTH} to ${PANEL_LAST_MONTH}.`,
    '',
    `calibration.window.preRoll = ${num(x.counts['calibration.window.preRoll'])} qualifying histories whose spells all end before the first assessor roll (2007-01-01) contribute no spell.`,
    '',
    `COVERAGE_GUARD is ${x.cal.coverageGuard ? 'on' : 'off'}. Entries per year of each stage's pooled window:`,
    ''
  ];
  const stages = STAGE_ORDER.filter(
    (s): s is CalStage => s !== 'complete' && x.fit.coverage[s] !== undefined
  );
  const years = new Set<number>();
  for (const s of stages) for (const y of Object.keys(x.fit.coverage[s]!)) years.add(Number(y));
  const sorted = [...years].sort((a, b) => a - b);
  out.push(
    ...table(
      ['year', ...stages],
      sorted.map((y) => [
        String(y),
        ...stages.map((s) => {
          const v = x.fit.coverage[s]![y];
          return v === undefined ? '' : num(v);
        })
      ])
    )
  );
  const partial = stages.flatMap((s) =>
    (x.fit.coveragePartial[s] ?? []).map((p) => [s, String(p.year), p.to, p.entries])
  );
  out.push(
    '',
    'Partial calendar years of each window (not asserted by the guard; conductor ruling C4):',
    '',
    ...(partial.length === 0 ? ['none'] : table(['stage', 'year', 'to', 'entries'], partial))
  );
  return out;
}

function noFcdText(c: NoFcdCell): string {
  return `X=${c.X}, A=${c.A}, w=${num(c.w)}, flagged=${c.flagged}, dropped=${c.dropped}`;
}

function cellDetail(c: CellReport): string[] {
  const parts: string[] = [];
  if (c.theta) {
    const th = OUTCOMES.filter((j) => c.theta![j] !== undefined)
      .map((j) => `${j} ${num(c.theta![j])}`)
      .join(', ');
    parts.push(
      `θ: ${th}; thin=${c.thin}; maxDiff=${num(c.maxDiff)}; capped=${num(c.capped)}; cappedInTable=${num(c.cappedInTable)}; pathway spells since 2015 = ${num(c.pathwaySpells)}`
    );
  }
  if (c.noFcd) {
    parts.push(
      `no-FCD weighting: pooled ${noFcdText(c.noFcd.pooled)}; ${c.pathway} ${noFcdText(c.noFcd.pathway)}`
    );
  }
  return parts.map((p) => `- ${c.stage}: ${p}`);
}

function transitionsSection(x: ReportInput): string[] {
  const typical = typicalMonths(x.calibration);
  const units = new Map(x.norm.map((h) => [h.id, netUnits(h.src)]));
  const out: string[] = [
    REPORT_SECTIONS[2],
    '',
    'Eventual shares (published table) are the published table and tail from month 0 (`eventualProbabilities`; possibly θ-scaled or laddered), project-weighted. The two raw columns are the Aalen–Johansen incidence at the end of observation of the pathway’s own spells in the pooled window (preApplication: all pathways), with no tail: unweighted (each spell counts once) and unit-weighted (each spell weighted by its net units). Comparing the raw pair shows the effect of weighting; comparing the published table with the unweighted column shows the effect of the table construction and tail.',
    ''
  ];
  for (const p of PATHWAYS) {
    out.push(`### ${p}`, '');
    const cells = x.fit.cells.filter((c) => c.pathway === p);
    out.push(
      ...table(
        [
          'stage',
          'rung',
          'tier',
          'n',
          'events',
          'window',
          'months',
          'k₀',
          'tail events',
          'advance (published table)',
          'exit (published table)',
          'advance (raw, unweighted)',
          'exit (raw, unweighted)',
          'advance (units)',
          'exit (units)',
          'typicalMonths',
          'purge-censored'
        ],
        cells.map((c) => {
          const t = x.calibration.transitions[p][c.stage]!;
          const ev = eventualProbabilities(t, 0);
          let exit = 0;
          for (const r of EXIT_ORDER) exit += ev.exit[r] ?? 0;
          const raw = x.spells.filter(
            (s) => s.stage === c.stage && (c.stage === 'preApplication' || s.pathway === p)
          );
          const unw = raw.length > 0 ? ajEnd(raw.map((s) => ({ ...s, w: 1 }))) : null;
          const uw =
            raw.length > 0
              ? ajEnd(raw.map((s) => ({ ...s, w: units.get(s.projectId) ?? 1 })))
              : null;
          return [
            c.stage,
            String(c.rung),
            c.tier,
            c.n,
            c.events,
            `${c.window[0]} to ${c.window[1]}`,
            c.months,
            num(c.k0),
            num(c.tailEvents),
            ev.advance,
            exit,
            num(unw?.advance),
            num(unw?.exit),
            num(uw?.advance),
            num(uw?.exit),
            num(typical[p][c.stage]),
            c.purgeCensored
          ];
        })
      ),
      ''
    );
    const detail = cells.flatMap(cellDetail);
    if (detail.length > 0) out.push(...detail, '');
  }
  out.push(
    'Per-stage `sc.*` rule counts (records changed at each stage; gap-impute, no-FCD, running-max and last-stage over all qualifying histories, purge-censor over all qualifying exits, ratio-clamp over revised pairs, carried-excluded over windowed revision pairs; the windowed rule totals are in section 10):',
    ''
  );
  const purgeByStage: Partial<Record<Stage, number>> = {};
  for (const e of x.purge.exits) {
    if (e.censored) purgeByStage[e.stage] = (purgeByStage[e.stage] ?? 0) + 1;
  }
  // the two revision rules' samples are `<id>:<stage>` pairs
  const pairsByStage = (id: ScRuleId): Partial<Record<Stage, number>> => {
    const by: Partial<Record<Stage, number>> = {};
    for (const s of x.tallies[id].sample) {
      const stage = s.slice(s.lastIndexOf(':') + 1) as Stage;
      by[stage] = (by[stage] ?? 0) + 1;
    }
    return by;
  };
  const clampByStage = pairsByStage('sc.revision.ratio-clamp');
  const carriedByStage = pairsByStage('sc.revision.carried-excluded');
  const perStage = (id: ScRuleId, s: Stage): number =>
    id === 'sc.exit.purge-censor'
      ? (purgeByStage[s] ?? 0)
      : id === 'sc.revision.ratio-clamp'
        ? (clampByStage[s] ?? 0)
        : id === 'sc.revision.carried-excluded'
          ? (carriedByStage[s] ?? 0)
          : (x.perStage[id][s] ?? 0);
  // The funding rule counts MOHCD homes, which have no stage (finance-data spec 4.9).
  const stageRules = SC_RULE_IDS.filter((id) => id !== 'sc.funding.ami-undeclared');
  out.push(
    ...table(
      ['stage', ...stageRules],
      STAGE_ORDER.map((s) => [s, ...stageRules.map((id) => perStage(id, s))])
    )
  );
  return out;
}

function tcoSection(x: ReportInput): string[] {
  const completeBy = new Map<string, number>();
  for (const r of x.permits) {
    if (r.project_id === null || r.complete_day === null) continue;
    const cur = completeBy.get(r.project_id);
    if (cur === undefined || r.complete_day < cur) completeBy.set(r.project_id, r.complete_day);
  }
  const tco: number[] = [];
  const permit: number[] = [];
  const differ: number[] = [];
  for (const h of x.norm) {
    if (h.end.kind !== 'complete' || h.noFcd) continue;
    const start = h.eff.construction;
    const done = h.eff.complete;
    const pc = completeBy.get(h.id);
    if (start === undefined || done === undefined || pc === undefined) continue;
    tco.push(done - start);
    permit.push(pc - start);
    if (done !== pc) differ.push(done - pc);
  }
  const out = [REPORT_SECTIONS[3], ''];
  if (tco.length === 0) {
    out.push(
      'not measurable: no completed history (with a construction start) has both a completion day and a permit `complete_day`.'
    );
    return out;
  }
  const mt = median(tco)!;
  const mp = median(permit)!;
  out.push(
    `Over ${tco.length} completed histories with a construction start and permit rows with a \`complete_day\`: median construction duration to the history's completion (first TCO/CFC, else permit \`completed_date\`) = ${num(mt)} days (${num(mt / MONTH_DAYS)} months); to the earliest permit \`complete_day\` = ${num(mp)} days (${num(mp / MONTH_DAYS)} months); difference ${num(mt - mp)} days. The medians hide the cases where the two dates differ: ${differ.length} of them have a completion day different from the earliest permit \`complete_day\`; paired median of (history completion − earliest permit \`complete_day\`) over them = ${num(median(differ))} days. TCO data start in 2018, so earlier completions are dated later.`
  );
  return out;
}

/**
 * Exactly aliased bin indicators of different terms: merged bins that hold the same non-empty,
 * non-total set of design rows (merged bins, basis), so the ridge splits one effect between them.
 * Each group lists its bins as `<feature> bin <i> (≥ <lower edge>)`.
 */
export function aliasGroups(
  terms: Pick<InitiationTermReport, 'feature' | 'edges' | 'map'>[],
  cells: Iterable<FitCell>
): string[][] {
  const rows = new Set<string>();
  const merged: number[][] = [];
  const keys: string[] = [];
  for (const cell of cells) {
    const bins = cell.bins.map((b, t) => terms[t].map[b]);
    const key = `${bins.join(',')}|${cell.basis}`;
    if (rows.has(key)) continue;
    rows.add(key);
    merged.push(bins);
    keys.push(key);
  }
  const order = keys.map((_, i) => i).sort((a, b) => (keys[a] < keys[b] ? -1 : 1));
  const bySig = new Map<string, { feature: string; label: string }[]>();
  terms.forEach((term, t) => {
    term.edges.forEach((lo, b) => {
      const members = order.filter((i) => merged[i][t] === b);
      if (members.length === 0 || members.length === order.length) return;
      const sig = members.map((i) => keys[i]).join(';');
      const list = bySig.get(sig) ?? [];
      list.push({ feature: term.feature, label: `${term.feature} bin ${b} (≥ ${num(lo)})` });
      bySig.set(sig, list);
    });
  });
  const groups: string[][] = [];
  for (const list of bySig.values()) {
    if (new Set(list.map((l) => l.feature)).size >= 2) groups.push(list.map((l) => l.label));
  }
  return groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function initiationSection(x: ReportInput): string[] {
  const r = x.initiation;
  const ev = x.events;
  const out: string[] = [
    REPORT_SECTIONS[4],
    '',
    `Mode: ${r.mode}. Events ${r.events.total} (record basis ${r.events.record}, permit basis ${r.events.permit}); exposure ${r.exposureMonths} parcel-months over ${r.parcelYears} hostable parcel-years; parcel-years excluded ${r.parcelYearsExcluded}; events off the panel ${r.eventsOffPanel}; events on covered parcel-months ${r.eventsCovered}.`,
    `Histories with no initiation event: no start ${ev.noStart}, no permit filing before 2015 ${ev.noPermit}, no parcel ${ev.noParcel}; event month outside the panel ${ev.outOfRange}.`,
    '',
    'Parcel-years excluded by roll year:',
    '',
    ...table(
      ['roll year', 'excluded'],
      Object.keys(r.parcelYearsExcludedByYear)
        .map(Number)
        .sort((a, b) => a - b)
        .map((y) => [String(y), r.parcelYearsExcludedByYear[y]])
    ),
    '',
    `Intercept ${num(r.intercept)}; measurement-basis coefficient (not shipped) ${num(r.basis)}; IRLS iterations ${num(r.iterations)}; MIN_BIN_EVENTS ${r.minBinEvents}; RIDGE_LAMBDA ${num(r.ridgeLambda)}.`,
    ''
  ];
  for (const t of r.terms) {
    out.push(
      `### ${t.feature}${t.categorical ? ' (categorical)' : ''}`,
      '',
      `Initial edges ${t.initialEdges.map(num).join(', ')}; merged edges ${t.edges.map(num).join(', ')}.`,
      '',
      ...table(
        ['bin ≥', 'exposure', 'events', 'predicted', 'coefficient'],
        t.bins.map((b) => [num(b.lo), b.exposure, b.events, b.predicted, num(b.coef)])
      ),
      ''
    );
  }
  out.push(
    '### Back-cast',
    '',
    ...table(
      ['basis', 'observed', 'predicted'],
      r.backcast.byBasis.map((b) => [b.basis === 1 ? 'permit' : 'record', b.observed, b.predicted])
    ),
    '',
    `V28 (${x.cal.backcastGate ? 'gating' : 'live only; not gating in this build'}): ${x.backcast.ok ? 'ok' : 'outside 2%'}: ${x.backcast.detail}`,
    '',
    ...table(
      ['year', 'basis', 'exposure', 'observed', 'predicted'],
      r.backcast.byYear.map((b) => [
        String(b.year),
        b.basis === 1 ? 'permit' : 'record',
        b.exposure,
        b.observed,
        b.predicted
      ])
    ),
    ''
  );
  const ho = r.holdOut;
  if (ho === null) out.push('Hold-out: none (fixture model).', '');
  else if ('error' in ho) out.push(`Hold-out: refit failed: ${ho.error}`, '');
  else {
    out.push(
      `Hold-out: fit through ${ho.fitThrough}; observed ${num(ho.observed)}, predicted ${num(ho.predicted)}.`,
      '',
      ...table(
        ['year', 'observed', 'predicted'],
        ho.rows.map((h) => [String(h.year), h.observed, h.predicted])
      ),
      ''
    );
  }
  const aliases = aliasGroups(r.terms, x.panel.cells.values());
  const aliasOf = (feature: string): string[] =>
    aliases.filter((g) => g.some((l) => l.startsWith(`${feature} `))).map((g) => g.join(' ≡ '));
  out.push(
    '### Plausibility',
    '',
    ...table(
      ['year', 'implied (published hazard)', 'observed'],
      Object.keys(r.impliedPerYear)
        .map(Number)
        .sort((a, b) => a - b)
        .map((y) => [String(y), r.impliedPerYear[y], r.observedPerYear[y] ?? 0])
    ),
    '',
    `- impliedSteadyState ${num(r.impliedSteadyState)} per year; fzpPerYear ${num(r.fzpPerYear)} over ${r.hostable} hostable unoccupied parcels; fzpRatio ${num(r.fzpRatio)}`,
    `- historical mean ${num(r.historicalMean)} events per year; FZP ÷ historical ${num(r.fzpVsHistorical)} (band ${FZP_BAND[0]} to ${FZP_BAND[1]}, tier 4)${r.fzpWarning ? ': outside the band (warned)' : ''}`,
    `- extrapolation: ${r.extrapolation.parcels} parcels (${num(100 * r.extrapolation.parcelShare)}% of hostable, ${num(100 * r.extrapolation.filingsShare)}% of FZP expected filings) beyond the at-risk maximum potentialRatio ${num(r.extrapolation.maxAtRisk.potentialRatio)}, storiesGap ${num(r.extrapolation.maxAtRisk.storiesGap)}`,
    `- topEffects (coefficient range):${r.topEffects.length === 0 ? ' none (no fitted terms)' : ''}`,
    ...r.topEffects.map((e) => {
      const a = aliasOf(e.feature);
      return `  - ${e.feature} ${num(e.range)}${a.length > 0 ? ` (aliased with ${a.join('; ')}: effects split by the ridge)` : ''}`;
    }),
    `- exactly aliased bin indicators (same design rows): ${aliases.length === 0 ? 'none' : aliases.map((g) => g.join(' ≡ ')).join('; ')}`,
    '',
    'Exposure and event shares per `imputed` mask bit (T11/T13: 0 yearBuilt, 1 existingStories, 2 improvementShare, 3 existingUnits, 4 no roll row, 5 carried, 6 floor area):',
    '',
    ...table(
      ['bit', 'exposure share', 'event share'],
      [
        ...r.mask.exposureShare.map((e, b) => [String(b), e, r.mask.eventShare[b]]),
        ['any', r.mask.anyExposure, r.mask.anyEvents]
      ]
    )
  );
  return out;
}

function sizeRevisionSection(x: ReportInput): string[] {
  const s = x.calibration.size;
  const v = x.calibration.revision;
  const clamp = x.tallies['sc.revision.ratio-clamp'];
  const carried = x.tallies['sc.revision.carried-excluded'];
  return [
    REPORT_SECTIONS[5],
    '',
    `### Size (tier ${s.provenance.tier}, n = ${num(s.provenance.n)})`,
    '',
    `Fill levels ${s.fillLevels.map(num).join(', ')}; bucket edges ${SIZE_EDGES.join(', ')}; calibration.method.sizeOverEnvelope = ${x.sizeOverEnvelope.fired} of ${x.sizeOverEnvelope.of} (r > 1 mapped to fill 1).`,
    '',
    ...table(
      ['max stories up to', ...s.fillLevels.map((f) => `fill ${num(f)}`)],
      s.byEnvelope.map((b) => [num(b.maxStoriesUpTo), ...b.probs])
    ),
    '',
    `### Revision (tier ${v.provenance.tier}, n = ${num(v.provenance.n)})`,
    '',
    `Ratio edges ${REVISION_EDGES.join(', ')}; sc.revision.ratio-clamp ${clamp.fired} of ${clamp.of} revised pairs; sc.revision.carried-excluded ${carried.fired} of ${carried.of} pairs left out (earlier count carried back; partner ruling).`,
    '',
    ...table(
      ['stage', 'probability', 'ratio probs'],
      v.at.map((a) => [a.stage, a.probability, a.ratio.probs.map(num).join(', ')])
    )
  ];
}

function newProjectsSection(x: ReportInput): string[] {
  const c = x.calibration;
  const lp = x.lpDiag;
  const days = c.phaseGap.days;
  return [
    REPORT_SECTIONS[6],
    '',
    ...table(
      ['pathway', 'pathwayForNew', 'ppaShare'],
      PATHWAYS.map((p: Pathway) => [p, c.pathwayForNew[p], c.ppaShare[p]])
    ),
    '',
    `- pathwayForNew: tier ${c.pathwayForNew.provenance.tier}, n = ${num(c.pathwayForNew.provenance.n)}`,
    `- ppaShare: tier ${c.ppaShare.provenance.tier}, n = ${num(c.ppaShare.provenance.n)}`,
    `- streamlinedForLocalProgram: tier ${c.streamlinedForLocalProgram.tier}, n = ${num(c.streamlinedForLocalProgram.n)} streamlined spells`,
    `- Local Program diagnostic (not used): ${lp.filings} filings since ${LOCAL_PROGRAM_START}; median days filed to entitled ${num(lp.medianFiledToEntitled)} (against the 180-day clock)`,
    `- phaseGap: rung ${x.phaseGap.rung}, ${x.phaseGap.groups} groups, ${days.length} gaps, median ${num(median(days))} days`
  ];
}

function provenanceIndex(c: Calibration): [string, Provenance][] {
  const out: [string, Provenance][] = [];
  for (const p of PATHWAYS) {
    for (const s of STAGE_ORDER) {
      if (s === 'complete') continue;
      const t = c.transitions[p][s];
      if (!t) continue;
      out.push([`transitions.${p}.${s}.provenance`, t.provenance]);
      out.push([`transitions.${p}.${s}.tailProvenance`, t.tailProvenance]);
    }
  }
  out.push(
    ['initiation.provenance', c.initiation.provenance],
    ['pathwayForNew.provenance', c.pathwayForNew.provenance],
    ['ppaShare.provenance', c.ppaShare.provenance],
    ['size.provenance', c.size.provenance],
    ['revision.provenance', c.revision.provenance],
    ['streamlinedForLocalProgram', c.streamlinedForLocalProgram],
    ['phaseGap.provenance', c.phaseGap.provenance]
  );
  if (c.market) {
    out.push(
      ['market.today.provenance', c.market.today.provenance],
      ['market.crossCheck.provenance', c.market.crossCheck.provenance],
      ['market.slope.provenance', c.market.slope.provenance],
      ['market.slope.crossChecks.provenance', c.market.slope.crossChecks.provenance]
    );
  }
  if (c.affordableRoutes) out.push(['affordableRoutes.provenance', c.affordableRoutes.provenance]);
  if (c.baselineFunding) {
    c.baselineFunding.provenance.forEach((p, i) =>
      out.push([`baselineFunding.provenance[${i}]`, p])
    );
    out.push(['baselineFunding.check.provenance', c.baselineFunding.check.provenance]);
  }
  return out;
}

function indexSection(x: ReportInput): string[] {
  return [
    REPORT_SECTIONS[7],
    '',
    ...table(
      ['path', 'tier', 'label', 'first source'],
      provenanceIndex(x.calibration).map(([path, p]) => [
        path,
        p.tier,
        p.label,
        p.sources.length > 0 ? `${p.sources[0].label} <${p.sources[0].url}>` : 'none'
      ])
    )
  ];
}

const CONSTANT_NAMES: Record<keyof CalProfile, string> = {
  name: 'profile',
  nSpellsMin: 'N_SPELLS_MIN',
  nEventsMin: 'N_EVENTS_MIN',
  nRiskMin: 'N_RISK_MIN',
  kMax: 'K_MAX (months)',
  tailSpan: 'TAIL_SPAN',
  tailMinEvents: 'TAIL_MIN_EVENTS',
  minBinEvents: 'MIN_BIN_EVENTS',
  ridgeLambda: 'RIDGE_LAMBDA',
  initMinEvents: 'INIT_MIN_EVENTS',
  sizeMinN: 'SIZE_MIN_N',
  revMinN: 'REV_MIN_N',
  v27N: 'V27 draws',
  v27Tol: 'V27 tolerance',
  coverageGuard: 'COVERAGE_GUARD',
  purgeMinExits: 'PURGE_MIN_EXITS',
  purgeRatio: 'PURGE_RATIO',
  purgeMinDays: 'PURGE_MIN_DAYS',
  purgeGapDays: 'PURGE_GAP_DAYS',
  phPrior: 'PH_PRIOR κ',
  phaseMinUnits: 'PHASE_MIN_UNITS',
  phaseMinGaps: 'PHASE_MIN_GAPS',
  fixtureInitiation: 'fixture initiation model',
  backcastGate: 'V28 back-cast gate'
};

function constantsSection(x: ReportInput): string[] {
  const value = (v: unknown): string =>
    typeof v === 'number' ? num(v) : v === null ? 'n/a' : String(v);
  return [
    REPORT_SECTIONS[8],
    '',
    'Tier 4 (made up) unless noted.',
    '',
    ...table(
      ['constant', 'value'],
      [
        ...(Object.keys(CONSTANT_NAMES) as (keyof CalProfile)[]).map((k) => [
          CONSTANT_NAMES[k],
          value(x.cal[k])
        ]),
        ['MONTH_DAYS (definitional)', num(MONTH_DAYS)],
        ['size bucket edges', SIZE_EDGES.join(', ')],
        ['revision ratio edges', REVISION_EDGES.join(', ')],
        ['FZP filings band', `${FZP_BAND[0]} to ${FZP_BAND[1]}`],
        ...Object.entries(INITIAL_EDGES).map(([f, e]) => [`initial bins: ${f}`, e.join(', ')])
      ]
    )
  ];
}

function rulesSection(x: ReportInput): string[] {
  const pw = x.purge;
  const out = [
    REPORT_SECTIONS[9],
    '',
    'The `fired` and `of` counts `recordQuality` writes into report.json; the top-25 record lists are in `quality-report.md`.',
    '',
    ...table(
      ['id', 'label', 'tier', 'action', 'fired', 'of', 'share'],
      SC_RULE_IDS.map((id) => {
        const r = qualityRule(id);
        const t = x.tallies[id];
        return [id, r.label, r.tier, r.action, t.fired, t.of, share(t.fired, t.of)];
      })
    ),
    '',
    `sc.exit.purge-censor, unwindowed (all qualifying exits): ${pw.tally.fired} censored of ${pw.tally.of} exits; ${pw.windows.length} purge windows.`,
    ''
  ];
  if (pw.windows.length > 0) {
    const counts = (o: Partial<Record<string, number>>) =>
      Object.keys(o)
        .sort()
        .map((k) => `${k} ${o[k]}`)
        .join(', ');
    out.push(
      ...table(
        ['first', 'last', 'exits', 'censored', 'by reason', 'by stage', 'median days'],
        pw.windows.map((w) => [
          isoOf(w.first),
          isoOf(w.last),
          w.exits,
          w.censored,
          counts(w.byReason),
          counts(w.byStage),
          w.medianDays
        ])
      ),
      ''
    );
  }
  const c = x.counts;
  out.push(
    'Method counts (model choices, not T14 rules):',
    '',
    ...table(
      ['count', 'value', 'of'],
      [
        [
          'calibration.method.permitOnlyPre2015',
          x.permitOnlyPre2015.fired,
          `${x.permitOnlyPre2015.of} qualifying permitOnly histories`
        ],
        [
          'calibration.method.ppaPooled',
          c['calibration.method.ppaPooled'],
          'preApplication spells'
        ],
        [
          'calibration.method.sizeOverEnvelope',
          x.sizeOverEnvelope.fired,
          `${x.sizeOverEnvelope.of} measured size histories`
        ],
        ['calibration.window.preRoll', c['calibration.window.preRoll'], 'qualifying histories'],
        ['calibration.noFcd.flaggedPooled', c['calibration.noFcd.flaggedPooled'], 'pooled cells']
      ]
    )
  );
  return out;
}

function requireMarket(c: Calibration): MarketModel {
  if (!c.market) throw new Error('calibration report: calibration.market is missing');
  return c.market;
}

/**
 * Section 11 (market-baseline spec §4.7): today's levels against the published model, the checks,
 * the public-money weights and the Controller cross-check. In fixture mode, the Mode line and the
 * weights and cross-check only.
 */
export function marketSection(m: MarketModel, r: MarketReport): string[] {
  const t = m.today;
  const [y0, y1] = t.years;
  const span = `${y0}-${y1}`;
  const [w0, w1] = r.years;
  const out: string[] = [REPORT_SECTIONS[10], ''];
  if (r.mode === 'fixture') {
    out.push(
      `Mode: fixture (today's levels fixed at ln 0.5 and ln 0.45 from ${num(t.observed.all)} and ${num(t.observed.private)} observed against ${num(t.implied)} implied; tier 4)`,
      ''
    );
  } else {
    const c = r.cohorts;
    out.push(
      '**Recent years**',
      '',
      ...table(
        [
          'year',
          'observed',
          'affordable cohort',
          'private',
          'implied (published hazard)',
          'hold-out predicted'
        ],
        r.rows.map((row) => [
          String(row.year),
          row.observed,
          row.affordable,
          row.private,
          row.implied,
          num(row.holdOutPredicted)
        ])
      ),
      '',
      `- today.all = ${num(t.all)}; today.private = ${num(t.private)}; years ${y0} to ${y1}`,
      `- observed ${num(t.observed.all)} (private ${num(t.observed.private)}); implied ${num(t.implied)}`,
      `- the recent starts by cohort: affordable ${num(c.affordable)}, private ${num(c.private)}, no Planning record ${num(c.noRecord)}, counts not recorded ${num(c.unknown)}`,
      '',
      `**Reproduction check**: The published model shifted by today.all predicts ${num(r.reproduction)} starts for ${span} against ${num(t.observed.all)} observed.`,
      ''
    );
    const ho = r.holdOut;
    if (ho === null) out.push('**Hold-out, report only**: none.', '');
    else if ('error' in ho) {
      out.push(`**Hold-out, report only**: the hold-out refit failed: ${ho.error}.`, '');
    } else {
      out.push(
        `**Hold-out, report only**: Fitted on ${PANEL_FIRST_MONTH.slice(0, 4)}-${y0 - 1} only, the model predicts ${num(ho.predicted)} starts for ${span}: ln(${num(t.observed.all)} ÷ ${num(ho.predicted)}) = ${num(sig6(ho.logRatio))}. This is evidence of the cycle and is not applied: the published model already contains part of the slowdown (OD-F11).`,
        ''
      );
    }
  }
  out.push(
    '**Public-money weights**',
    '',
    ...table(
      [
        'prototype',
        'rule',
        `private starts ${w0}-${w1}`,
        'weight',
        'uncovered per home',
        'cost per home',
        'uncovered share'
      ],
      r.weights.map((w) => [
        w.id,
        w.rule,
        w.starts,
        w.weight,
        w.uncoveredPerHome,
        w.costPerHome,
        w.uncoveredShare
      ])
    ),
    '',
    ...(r.equalWeights
      ? [`- no private start of ${w0}-${w1} has a prototype: every prototype weighs the same`]
      : []),
    `- unbinned private starts ${w0}-${w1}: ${num(r.unbinned.homes)} with homes not recorded; ${num(r.unbinned.stories)} of 25 homes or more with stories not recorded`,
    `- typicalUncoveredShare = ${num(r.typicalUncoveredShare)}`,
    `- slope.perCostShare = ${num(m.slope.perCostShare)}`,
    `- typicalCostOverValue = ${num(r.typicalCostOverValue)}`,
    `- cross-check slopes (reported, not applied): costCoefficient = ${num(m.slope.crossChecks.costCoefficient)}; priceCoefficient = ${num(m.slope.crossChecks.priceCoefficient)}`,
    '',
    "**The Controller's cross-check (reported, not applied)**",
    '',
    `crossCheck.logOdds = ${num(m.crossCheck.logOdds)}, from the lagged index means: cost ${num(r.means.costRecent)} (recent) against ${num(r.means.costReference)} (reference); price ${num(r.means.priceRecent)} (recent) against ${num(r.means.priceReference)} (reference). Gap to today.all: today.all − crossCheck.logOdds = ${num(sig6(t.all - m.crossCheck.logOdds))}.`
  );
  if (r.mode !== 'fixture') {
    out.push(
      '',
      `**Market warnings**:${r.warnings.length === 0 ? ' none' : ''}`,
      ...r.warnings.map((w) => `- ${w}`)
    );
  }
  return out;
}

const GROUP_LABEL: Record<FundedGroup, string> = {
  affordable: '100% affordable',
  some: 'some affordable',
  none: 'none'
};
const FILL_TIER_LABEL = { 1: '1, federal', 2: '2, state', 3: '3, City' } as const;

/** The fill-tier sentence under the baseline table (finance-data spec 4.7 item 4), verbatim. */
export const FILL_TIER_SENTENCE =
  "Grants fill a project's uncovered cost in three tiers: federal, then state, then the City's pools in proportion to their shares; with the whole baseline and nothing added, every grant pays its full share.";
/** The fixed sentence of section 13 (finance-data spec 4.8), verbatim. */
export const SITE_CHOICE_SENTENCE =
  'A ratio near 1 means funded projects started on lots like those private projects chose (the draw of F9 (d)); well above 1 means they took the likeliest lots; well below 1, lots private projects pass over. No San Francisco estimate of displacement exists.';

function requireFunded(c: Calibration): {
  routes: NonNullable<Calibration['affordableRoutes']>;
  funding: NonNullable<Calibration['baselineFunding']>;
} {
  if (!c.affordableRoutes || !c.baselineFunding) {
    throw new Error(
      'calibration report: calibration.affordableRoutes or baselineFunding is missing'
    );
  }
  return { routes: c.affordableRoutes, funding: c.baselineFunding };
}

/**
 * Section 12 (finance-data spec 4.7): the routes line, the pathway and stage tables by group, and
 * the baseline funding with its MOHCD mix and check. Ships nothing beyond `calibration.json`;
 * every number through `num`.
 */
export function fundedSection(x: ReportInput): string[] {
  const { routes, funding } = requireFunded(x.calibration);
  const a = x.affordable;
  const { pathways, rows, leftOut } = a.stages;
  const f = a.funding;
  const mix = f.mix;
  const groups = Object.keys(pathways) as FundedGroup[];
  const cell = (spells: number, v: number | null) => (spells === 0 ? 'none' : num(v));
  const routesLine =
    `- affordableRoutes: discretionary ${num(routes.discretionary)}, streamlined ${num(routes.streamlined)}, ` +
    `permitOnly ${num(routes.permitOnly)}; tier ${routes.provenance.tier}; n ${num(a.routes.n)}` +
    (a.routes.fallback ? '; fallback (the pathway mix of all new projects)' : '');
  const out: string[] = [
    REPORT_SECTIONS[11],
    '',
    routesLine,
    '',
    `**Pathways by group** (qualifying histories first recorded ${PLANNING_START} to ${isoOf(x.calibration.asOf)}, with a Planning pair of 10 homes or more and a recorded affordable count)`,
    '',
    ...table(
      ['group', 'discretionary', 'streamlined', 'permitOnly', 'pathway unknown'],
      groups.map((g) => [
        GROUP_LABEL[g],
        pathways[g].discretionary,
        pathways[g].streamlined,
        pathways[g].permitOnly,
        pathways[g].null
      ])
    ),
    '',
    `Left out of the groups (no Planning pair, blank or fewer than 10 proposed homes, or a blank affordable count): ${num(leftOut)} histories.`,
    '',
    '**Stages by group**',
    '',
    ...table(
      [
        'stage',
        'group',
        'spells',
        'advances',
        'exits',
        'eventual advance',
        'eventual exit',
        'median months to advance'
      ],
      rows.map((r) => [
        r.stage,
        GROUP_LABEL[r.group],
        num(r.spells),
        cell(r.spells, r.advances),
        cell(r.spells, r.exits),
        cell(r.spells, r.eventualAdvance),
        cell(r.spells, r.eventualExit),
        cell(r.spells, r.medianMonths)
      ])
    ),
    '',
    "The transition tables' estimator (Aalen–Johansen with left truncation, censoring and competing exits) on the calibration's own spells, pooled over pathways, without the fallback ladder and tail: the comparison is descriptive.",
    '',
    '**Baseline funding**',
    '',
    ...table(
      ['fill tier', 'programme', 'pool', 'kind', 'dollars a year', 'share', 'implied homes a year'],
      f.rows.map((r) => [
        FILL_TIER_LABEL[r.fillTier],
        r.programme,
        r.pool,
        r.kind,
        r.dollarsPerYear === null ? 'uncapped' : num(r.dollarsPerYear),
        num(r.share),
        r.dollarsPerYear === null ? 'uncapped' : num(r.impliedHomesPerYear)
      ])
    ),
    '',
    FILL_TIER_SENTENCE,
    '',
    `- tiers: ${Object.entries(mix.tiers)
      .map(([t, v]) => `${t} ${num(v)}`)
      .join(', ')}`,
    `- minHomes: ${num(mix.minHomes)}`,
    `- MOHCD rows used: ${num(mix.used)}`,
    `- homes by AMI band: ${Object.entries(mix.byBand)
      .map(([b, v]) => `${b} ${num(v)}`)
      .join(', ')}, ami_undeclared ${num(mix.undeclared)}`,
    `- undeclared homes: ${num(mix.undeclared)} of ${num(mix.affordable)} affordable homes in the rows used (${share(mix.undeclared, mix.affordable)})`,
    `- check: impliedHomesPerYear ${num(funding.check.impliedHomesPerYear)}; observedHomesPerYear ${num(funding.check.observedHomesPerYear)} (${num(f.awardRows)} award rows)`,
    `- check warning: ${f.warning ?? 'none'}`
  ];
  return out;
}

function siteRow(label: string, g: SiteGroup): (string | number)[] {
  return [label, g.histories, g.onPanel, g.offPanel, num(g.meanPerMille), num(g.medianPerMille)];
}

/**
 * Section 13 (finance-data spec 4.8, OD-F9b): the published initiation hazard on the lots where
 * the cohort's projects started, against private starts. Report-only.
 */
export function siteChoiceSection(x: ReportInput): string[] {
  const s = x.affordable.siteChoice;
  return [
    REPORT_SECTIONS[12],
    '',
    "Each history's start is its first entered day among preApplication, filed and permitFiled, from 2015-01 to 2025-12; its lot is the primary parcel, read on the panel row of the start's roll year. A start whose lot has no row, or a row not hostable under the base zoning, is off panel.",
    '',
    ...table(
      [
        'group',
        'histories',
        'starts on the panel',
        'off panel',
        'mean monthly hazard × 1000',
        'median monthly hazard × 1000'
      ],
      [siteRow('100% affordable', s.affordable), siteRow('private', s.private)]
    ),
    '',
    `- in neither group (flagged 100% affordable, under 10 homes): ${num(s.neither)}`,
    `- ratio of means, 100% affordable ÷ private: ${num(s.ratio)}`,
    '',
    SITE_CHOICE_SENTENCE
  ];
}

/** The calibration report (spec §4.10): thirteen sections, deterministic. */
export function calibrationReport(x: ReportInput): string {
  const sections = [
    header(x),
    windows(x),
    transitionsSection(x),
    tcoSection(x),
    initiationSection(x),
    sizeRevisionSection(x),
    newProjectsSection(x),
    indexSection(x),
    constantsSection(x),
    rulesSection(x),
    marketSection(requireMarket(x.calibration), x.market),
    fundedSection(x),
    siteChoiceSection(x)
  ];
  return sections.map((s) => s.join('\n')).join('\n\n') + '\n';
}
