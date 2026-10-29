/**
 * T14 data-quality registry (design row T14; scenario-data spec §4.12). Pipeline-internal.
 *
 * `QUALITY_RULES` is the only place a pipeline rule may null, replace, default or drop a source
 * value; observation rules (`action: 'none'`) only count. `recordQuality` is the only writer of
 * `quality.*` report keys and of `quality-report.md` rows. Each owner declares its rules in its
 * own file under `quality-rules/`; this module collects them, sorted by id, and validates them at
 * load.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Duck } from './duck';
import { PR_RULES } from './quality-rules/pr';
import { SC_RULES } from './quality-rules/sc';
import { SD_RULES } from './quality-rules/sd';

export interface QualityRule {
  /** '<sd|pr|sc>.<area>.<rule>', kebab-case, unique */
  id: string;
  owner: 'scenario-data' | 'project-records' | 'stage-calibration';
  /** lock id, raw table or derived table */
  source: string;
  field: string;
  kind: 'bound' | 'outlier' | 'shape' | 'gap' | 'missing' | 'observe';
  action: 'null' | 'replace' | 'default' | 'drop' | 'none';
  /** of the rule's predicate and thresholds */
  tier: 2 | 3 | 4;
  /** of a value the rule writes; null unless action is 'replace' or 'default' */
  valueTier: 0 | 1 | 2 | 3 | 4 | null;
  /** T11/T13 imputed bit it sets; scenario-data rules only */
  maskBit: number | null;
  /** plain English, shown to users */
  label: string;
  denominator: string;
  /** default 0.01 */
  warnShare: number;
  /** default 0.10 */
  failShare: number;
  unitsWeighted: boolean;
}

/**
 * Smallest gross floor area per home, m², for the capacity rules (tier 4: SF's smallest legal
 * rooms are about 6.5 m² before any circulation; design RA1).
 */
export const MIN_GROSS_M2_PER_UNIT = 10;

/**
 * Default shares by kind (T14 row; tier 4 check bounds, made up). A routine missing-value
 * imputation (`kind: 'missing'`) warns above 5% (ledger SD rulings 2026-10-17, "kind missing →
 * warnShare 0.05"); every other kind above 1%. Every kind fails above 10% (RA1: the 10% fail
 * share generalises ruling A9).
 */
const WARN_SHARE = 0.01;
const WARN_SHARE_MISSING = 0.05;
const FAIL_SHARE = 0.1;

/** The report file `writeQualityReport` writes into the build's derived folder. */
export const QUALITY_REPORT_MD = 'quality-report.md';
/** The markers around the generated "Data quality" section of docs/dev/pipeline.md. */
export const QUALITY_DOC_BEGIN = '<!-- quality:begin -->';
export const QUALITY_DOC_END = '<!-- quality:end -->';

const ID_RE = /^(sd|pr|sc)\.[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/;
const PREFIX: Record<QualityRule['owner'], string> = {
  'scenario-data': 'sd',
  'project-records': 'pr',
  'stage-calibration': 'sc'
};
/** Mask bits a scenario-data rule may set (T11/T13 mask convention; bit 7 is reserved). */
const MASK_BITS = [0, 6] as const;
/** First affected ids per rule kept for quality-report.md (T14 row). */
const SAMPLE_KEEP = 25;

/** The kind's default `warnShare` and `failShare` (T14 row). */
export function defaultShares(kind: QualityRule['kind']): { warnShare: number; failShare: number } {
  return { warnShare: kind === 'missing' ? WARN_SHARE_MISSING : WARN_SHARE, failShare: FAIL_SHARE };
}

/** Ids of the rules whose shares differ from their kind's default, in input order. */
export function kindDefaultDepartures(rules: readonly QualityRule[]): string[] {
  return rules
    .filter((r) => {
      const d = defaultShares(r.kind);
      return r.warnShare !== d.warnShare || r.failShare !== d.failShare;
    })
    .map((r) => r.id);
}

/** Throws on the first rule that breaks a registry check of spec §4.12 "Module". */
export function validateRules(rules: readonly QualityRule[]): void {
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) throw new Error(`quality rule ${r.id}: duplicate id`);
    seen.add(r.id);
    if (!ID_RE.test(r.id))
      throw new Error(`quality rule ${r.id}: id does not match the id pattern ${ID_RE}`);
    if (r.id.slice(0, 2) !== PREFIX[r.owner])
      throw new Error(`quality rule ${r.id}: prefix disagrees with owner ${r.owner}`);
    const writes = r.action === 'replace' || r.action === 'default';
    if (writes && r.valueTier === null)
      throw new Error(`quality rule ${r.id}: valueTier is null for action ${r.action}`);
    if (!writes && r.valueTier !== null)
      throw new Error(`quality rule ${r.id}: valueTier is set for action ${r.action}`);
    if (r.maskBit !== null) {
      if (r.owner !== 'scenario-data')
        throw new Error(`quality rule ${r.id}: maskBit is set on a ${r.owner} rule`);
      if (!Number.isInteger(r.maskBit) || r.maskBit < MASK_BITS[0] || r.maskBit > MASK_BITS[1])
        throw new Error(`quality rule ${r.id}: maskBit ${r.maskBit} outside 0–6`);
    }
    // Both 0 is allowed: any firing fails, so the warn band is empty.
    if (!(r.warnShare < r.failShare) && !(r.warnShare === 0 && r.failShare === 0))
      throw new Error(`quality rule ${r.id}: warnShare ${r.warnShare} ≥ failShare ${r.failShare}`);
  }
}

/** A rule's report row, recorded by `recordQuality` against one `counts` object. */
export interface QualityReportRow {
  fired: number;
  of: number;
  units?: number;
  unitsOf?: number;
  /** Distinct affected ids passed as `sample`. */
  sampleCount: number;
  /** The first 25 of them in code-unit order. */
  sample: string[];
}

export interface QualityCheck {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

type Counts = Record<string, number>;
type CountInput = {
  fired: number;
  of: number;
  units?: number;
  unitsOf?: number;
  sample?: string[];
};

const COUNT_KEYS = ['fired', 'of', 'units', 'unitsOf'] as const;
const keysOf = (r: QualityRule) => (r.unitsWeighted ? COUNT_KEYS : COUNT_KEYS.slice(0, 2));
/** Every T14 report key starts with this; no other module writes one. */
const KEY_PREFIX = 'quality.';
const reportKey = (id: string, k: string) => `${KEY_PREFIX}${id}.${k}`;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const share = (n: number, d: number) => (d === 0 ? 0 : n / d);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const codeUnitOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cell = (s: string) => s.replaceAll('|', '\\|');
const tiers = (r: QualityRule) => `${r.tier} / ${r.valueTier ?? '—'}`;

/** A GitHub table in the form prettier prints it (columns padded, delimiter at least 3). */
export function mdTable(head: string[], rows: string[][]): string {
  const width = (s: string) => [...s].length;
  const w = head.map((h, j) => Math.max(3, width(h), ...rows.map((r) => width(r[j]))));
  const line = (cs: string[]) =>
    `| ${cs.map((c, j) => c + ' '.repeat(w[j] - width(c))).join(' | ')} |`;
  return [line(head), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...rows.map(line)].join(
    '\n'
  );
}

/**
 * The registry and its helpers over `rules` (validated, then sorted by id). The module exports
 * are bound to the real registry; tests build one over crafted rules.
 */
export function makeQuality(input: readonly QualityRule[]) {
  validateRules(input);
  const rules: readonly QualityRule[] = [...input].sort((a, b) => codeUnitOrder(a.id, b.id));
  const byId = new Map(rules.map((r) => [r.id, r]));
  /** Report rows per build `counts` object, so two builds in one process never mix rows. */
  const rows = new WeakMap<object, Map<string, QualityReportRow>>();

  function qualityRule(id: string): QualityRule {
    const r = byId.get(id);
    if (!r) throw new Error(`unregistered quality rule ${id}`);
    return r;
  }

  function recordQuality(counts: Counts, id: string, c: CountInput): void {
    const r = qualityRule(id);
    for (const k of COUNT_KEYS) {
      // fired and of are required even from a caller that bypasses the type (recordSqlQuality,
      // plain JS); units and unitsOf are checked against the rule below.
      const required = k === 'fired' || k === 'of';
      if ((required || c[k] !== undefined) && !isCount(c[k]))
        throw new Error(`${id}: ${k} must be a non-negative integer, got ${c[k]}`);
    }
    const hasUnits = c.units !== undefined || c.unitsOf !== undefined;
    if (r.unitsWeighted && (c.units === undefined || c.unitsOf === undefined))
      throw new Error(`${id}: units and unitsOf are required on a unit-weighted rule`);
    if (!r.unitsWeighted && hasUnits)
      throw new Error(`${id}: units and unitsOf are only for a unit-weighted rule`);
    if (c.fired > c.of) throw new Error(`${id}: fired ${c.fired} > of ${c.of}`);
    if (r.unitsWeighted && c.units! > c.unitsOf!)
      throw new Error(`${id}: units ${c.units} > unitsOf ${c.unitsOf}`);
    const sample = [...new Set(c.sample ?? [])].sort(codeUnitOrder);
    if (sample.length > c.fired)
      throw new Error(`${id}: sample has ${sample.length} ids, more than fired ${c.fired}`);
    let byRule = rows.get(counts);
    const keys = keysOf(r);
    if (byRule?.has(id) || keys.some((k) => reportKey(id, k) in counts))
      throw new Error(`${id}: recorded twice against one counts object`);
    if (!byRule) rows.set(counts, (byRule = new Map()));
    for (const k of keys) counts[reportKey(id, k)] = c[k]!;
    byRule.set(id, {
      fired: c.fired,
      of: c.of,
      ...(r.unitsWeighted ? { units: c.units, unitsOf: c.unitsOf } : {}),
      sampleCount: sample.length,
      sample: sample.slice(0, SAMPLE_KEEP)
    });
  }

  async function recordSqlQuality(
    db: Duck,
    owner: QualityRule['owner'],
    counts: Counts
  ): Promise<void> {
    const prefix = `${PREFIX[owner]}.`;
    const tally = await db.all<{
      rule_id: string;
      fired: number;
      of: number;
      units: number | null;
      units_of: number | null;
    }>(
      `SELECT rule_id, fired, "of", units, units_of FROM quality_tally
       WHERE starts_with(rule_id, '${prefix}') ORDER BY rule_id`
    );
    const samples = await db.all<{ rule_id: string; record_id: string }>(
      `SELECT rule_id, record_id FROM quality_sample WHERE starts_with(rule_id, '${prefix}')`
    );
    for (const t of tally) qualityRule(t.rule_id);
    const byRule = new Map<string, string[]>();
    for (const s of samples) {
      const ids = byRule.get(s.rule_id);
      if (ids) ids.push(s.record_id);
      else byRule.set(s.rule_id, [s.record_id]);
    }
    const tallied = new Set(tally.map((t) => t.rule_id));
    const orphan = [...byRule.keys()].filter((id) => !tallied.has(id)).sort(codeUnitOrder);
    if (orphan.length)
      throw new Error(`quality_sample rows without a quality_tally row: ${orphan.join(', ')}`);
    for (const t of tally) {
      recordQuality(counts, t.rule_id, {
        fired: t.fired,
        of: t.of,
        ...(t.units !== null ? { units: t.units } : {}),
        ...(t.units_of !== null ? { unitsOf: t.units_of } : {}),
        sample: (byRule.get(t.rule_id) ?? []).sort(codeUnitOrder)
      });
    }
  }

  function reportRows(counts: Counts): ReadonlyMap<string, QualityReportRow> {
    return rows.get(counts) ?? new Map();
  }

  function writeQualityReport(
    file: string,
    datasetVersion: string,
    counts: Counts,
    sections: string[] = []
  ): void {
    const got = reportRows(counts);
    const lines = [
      `# Data quality report: ${datasetVersion}`,
      '',
      'One row per registered T14 rule (`pipeline/lib/quality.ts`), in id order. Counts are as',
      'recorded by `recordQuality`; a rule with no row is "not reported", and V30 fails on it.',
      ''
    ];
    if (rules.length === 0) lines.push('No rules are registered.', '');
    else {
      lines.push(
        '| id | label | tier (rule / value) | action | fired / of | units / unitsOf | share |',
        '| --- | --- | --- | --- | --- | --- | --- |'
      );
      for (const r of rules) {
        const row = got.get(r.id);
        const head = [`\`${r.id}\``, cell(r.label), tiers(r), r.action];
        if (!row) lines.push(`| ${[...head, 'not reported', '—', '—'].join(' | ')} |`);
        else {
          const units = r.unitsWeighted ? `${row.units} / ${row.unitsOf}` : '—';
          const rowShare = pct(share(row.fired, row.of));
          const shares = r.unitsWeighted
            ? `${rowShare} rows, ${pct(share(row.units!, row.unitsOf!))} units`
            : rowShare;
          lines.push(`| ${[...head, `${row.fired} / ${row.of}`, units, shares].join(' | ')} |`);
        }
      }
      lines.push('', '## Samples', '');
      for (const r of rules) {
        const row = got.get(r.id);
        lines.push(`### ${r.id}`, '');
        if (!row) lines.push('Not reported.', '');
        else if (row.sampleCount === 0) lines.push('No affected ids recorded.', '');
        else {
          const n = Math.min(row.sampleCount, SAMPLE_KEEP);
          lines.push(
            `${row.sampleCount} affected ids; the first ${n} in sort order:`,
            '',
            row.sample.join(', '),
            ''
          );
        }
      }
    }
    for (const section of sections) lines.push(section.trimEnd(), '');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.join('\n'));
  }

  function checkQuality(counts: Counts, opts: { shares: boolean }): QualityCheck {
    const failures: string[] = [];
    const warnings: string[] = [];
    const judge = (id: string, what: string, s: number, r: QualityRule) => {
      if (s > r.failShare)
        failures.push(`${id}: ${what} ${pct(s)} > failShare ${pct(r.failShare)}`);
      else if (s > r.warnShare)
        warnings.push(`${id}: ${what} ${pct(s)} > warnShare ${pct(r.warnShare)}`);
    };
    for (const r of rules) {
      const keys = keysOf(r);
      const missing = keys.filter((k) => counts[reportKey(r.id, k)] === undefined);
      if (missing.length) {
        failures.push(`${r.id}: not reported (no ${missing.map((k) => `.${k}`).join(', ')})`);
        continue;
      }
      const v = Object.fromEntries(keys.map((k) => [k, counts[reportKey(r.id, k)]]));
      const bad = keys.filter((k) => !isCount(v[k]));
      if (bad.length) {
        for (const k of bad) failures.push(`${r.id}: ${k} ${v[k]} is not a non-negative integer`);
        continue;
      }
      if (v.fired > v.of) {
        failures.push(`${r.id}: fired ${v.fired} > of ${v.of}`);
        continue;
      }
      if (r.unitsWeighted && v.units > v.unitsOf) {
        failures.push(`${r.id}: units ${v.units} > unitsOf ${v.unitsOf}`);
        continue;
      }
      if (!opts.shares) continue;
      judge(r.id, 'share', share(v.fired, v.of), r);
      if (r.unitsWeighted) judge(r.id, 'units share', share(v.units, v.unitsOf), r);
    }
    for (const key of Object.keys(counts).sort(codeUnitOrder)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const rest = key.slice(KEY_PREFIX.length);
      const dot = rest.lastIndexOf('.');
      const id = rest.slice(0, Math.max(dot, 0));
      const r = byId.get(id);
      if (!r) failures.push(`${key}: names no registered rule`);
      else if (!(keysOf(r) as readonly string[]).includes(rest.slice(dot + 1)))
        failures.push(`${key}: not a report key of ${id}`);
    }
    return { ok: failures.length === 0, failures, warnings };
  }

  function qualityDocSection(): string {
    const table =
      rules.length === 0
        ? 'No rules are registered.'
        : mdTable(
            [
              'id',
              'label',
              'tier (rule / value)',
              'kind',
              'action',
              'mask bit',
              'warn / fail share'
            ],
            rules.map((r) => [
              `\`${r.id}\``,
              cell(r.label),
              tiers(r),
              r.kind,
              r.action,
              r.maskBit === null ? '—' : String(r.maskBit),
              `${r.warnShare} / ${r.failShare}`
            ])
          );
    return [
      '## Data quality',
      '',
      'Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule, and so is an observation rule that only counts (action `none`). The registry is `QUALITY_RULES` in `pipeline/lib/quality.ts`; each owner declares its rules in `pipeline/lib/quality-rules/` (`sd.ts`, `pr.ts`, `sc.ts`). The tiers are those of the rule (its predicate and thresholds) and of the value it writes; the mask bit is the T11/T13 `imputed` bit the rule sets. This section is generated from the registry by `npm run pipeline -- quality-doc`: do not edit it by hand.',
      '',
      table,
      '',
      'Each build reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` for a unit-weighted rule) in `report.json` and writes `pipeline/.cache/derived/<v>/quality-report.md` with one row per rule and its first 25 affected ids. V30 fails when a rule does not report or a `quality.*` key names no registered rule, and on a live build when a share exceeds its fail share; a share above its warn share warns.'
    ].join('\n');
  }

  return {
    rules,
    qualityRule,
    recordQuality,
    recordSqlQuality,
    reportRows,
    writeQualityReport,
    checkQuality,
    qualityDocSection
  };
}

const REGISTRY = makeQuality([...SD_RULES, ...PR_RULES, ...SC_RULES]);

/** Every registered rule, sorted by id (validated at module load). */
export const QUALITY_RULES: readonly QualityRule[] = REGISTRY.rules;

/** T14. Writes quality.<id>.fired and .of (and .units, .unitsOf) into `counts`, and records the
 *  rule's report row (its counts and the first 25 of `sample`) against this `counts` object. */
export function recordQuality(
  counts: Record<string, number>,
  id: string,
  c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] }
): void {
  REGISTRY.recordQuality(counts, id, c);
}

/** A rule's `fired` and `of` as recorded in `counts` (report.json), or undefined when unreported. */
export function reportedQuality(
  counts: Record<string, number>,
  id: string
): { fired: number; of: number } | undefined {
  const fired = counts[reportKey(id, 'fired')];
  const of = counts[reportKey(id, 'of')];
  return isCount(fired) && isCount(of) ? { fired, of } : undefined;
}

/** The registered rule; throws on an unknown id. */
export function qualityRule(id: string): QualityRule {
  return REGISTRY.qualityRule(id);
}

/** Creates the DuckDB tables quality_tally(rule_id, fired, of, units, units_of) and
 *  quality_sample(rule_id, record_id), unless they exist (runSql calls it too, so a database it
 *  ran on keeps its tallies). A SQL rule inserts one tally row and its sample rows. */
export async function createQualityTables(db: Duck): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS quality_tally (rule_id VARCHAR NOT NULL, fired BIGINT NOT NULL,
       "of" BIGINT NOT NULL, units BIGINT, units_of BIGINT);
     CREATE TABLE IF NOT EXISTS quality_sample (rule_id VARCHAR NOT NULL, record_id VARCHAR NOT NULL);`
  );
}

/** Calls recordQuality once for every tally row of one owner, with its sample sorted. */
export function recordSqlQuality(
  db: Duck,
  owner: QualityRule['owner'],
  counts: Record<string, number>
): Promise<void> {
  return REGISTRY.recordSqlQuality(db, owner, counts);
}

/** Writes quality-report.md from the rows recordQuality recorded against `counts`, one per
 *  registered rule in id order; it writes no row of its own (a rule with none is listed as
 *  "not reported", and V30 fails on it). Each of `sections` (markdown) follows the Samples.
 *  Deterministic. */
export function writeQualityReport(
  file: string,
  datasetVersion: string,
  counts: Record<string, number>,
  sections: string[] = []
): void {
  REGISTRY.writeQualityReport(file, datasetVersion, counts, sections);
}

/** V30 over report.json counts. */
export function checkQuality(
  counts: Record<string, number>,
  opts: { shares: boolean }
): { ok: boolean; failures: string[]; warnings: string[] } {
  return REGISTRY.checkQuality(counts, opts);
}

/** The "Data quality" section of docs/dev/pipeline.md, generated from QUALITY_RULES. */
export function qualityDocSection(): string {
  return REGISTRY.qualityDocSection();
}

/** `doc` with the text between the quality markers replaced by `qualityDocSection()`. */
export function replaceQualityDocSection(doc: string): string {
  const b = doc.indexOf(QUALITY_DOC_BEGIN);
  const e = doc.indexOf(QUALITY_DOC_END);
  if (b < 0 || e < b) throw new Error(`no ${QUALITY_DOC_BEGIN} … ${QUALITY_DOC_END} markers`);
  return `${doc.slice(0, b + QUALITY_DOC_BEGIN.length)}\n\n${qualityDocSection()}\n\n${doc.slice(e)}`;
}
