// `npx tsx scripts/cap-measure.ts <datasetDir> [--json]` (building-choice spec, Measurement to
// report): net completed homes (`completedNet`) at months 168 (2040) and 479 (2066) for current
// law, for current law plus one transit rule (all stop types, 805 m) at 12, 13, 16, 20, 40 and 80
// stories, and for every policy of the game's catalogue with its transit bands at the same caps,
// each beside the old dataset's figure from the taller-caps report (whose third row was the points
// game's full tree, not the catalogue), with the share of simulated starts by construction type over
// the window. A report, never a gate: a cap that builds fewer homes than a lower one is shown, not
// fixed. Always exits 0 once it has run; 2 when it could not run.
import { pathToFileURL } from 'node:url';
import { utcParts } from '../src/lib/fzp/time';
import { POLICY_KEYS } from '../src/lib/game/catalogue/rounds';
import { catalogueDoc } from '../src/lib/game/offer';
import { BUILDING_TYPES } from '../src/lib/sim/choice/types';
import { STOP_TYPES } from '../src/lib/sim/levers/brushes';
import { monthFirstDay } from '../src/lib/sim/world/months';
import { NO_BTYPE, ORIGIN_SIM, type World } from '../src/lib/sim/world/types';
import type { Day } from '../src/lib/timelapse/time';
import type { Calibration } from '../src/lib/timelapse/types';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '../src/lib/timeline/policy4';
import { openWorlds, type Worlds } from './record-check';

/** The caps measured, in stories. */
export const CAPS = [12, 13, 16, 20, 40, 80] as const;
/** The transit rule's distance: 805 m (half a mile) from any stop type. */
export const TRANSIT_MAX_M = 805;
/** The two months read: the view's row index (2040-11 and 2066-10 on the live dataset). */
export const MONTHS = [168, 479] as const;

export type At = { 168: number; 479: number };
export type Who = 'current' | 'transit' | 'full';

/** The transit rule's policy id. */
export const TRANSIT_RULE_ID = 'cap-transit';

/** The dataset the taller-caps report measured. */
export const OLD_DATASET = '2026-11-25-76c90397';

const at = (a: number, b: number): At => ({ 168: a, 479: b });
const byCap = (xs: readonly At[]): Record<number, At> =>
  Object.fromEntries(CAPS.map((c, i) => [c, xs[i]]));

/**
 * `completedNet` at months 168 and 479 on `OLD_DATASET`, from the taller-caps report's engine
 * runs (section 2: "current law", "zoning 805 m" and "full-tree" at each cap).
 */
export const OLD_FIGURES: { current: At; transit: Record<number, At>; full: Record<number, At> } = {
  current: at(47_502, 79_338),
  transit: byCap([
    at(63_092, 138_298),
    at(60_832, 126_709),
    at(61_648, 135_976),
    at(63_950, 140_339),
    at(68_106, 156_754),
    at(73_248, 182_282)
  ]),
  full: byCap([
    at(80_685, 165_058),
    at(75_920, 157_445),
    at(79_489, 167_549),
    at(83_391, 171_072),
    at(89_249, 197_592),
    at(97_777, 222_488)
  ])
};

/** Simulated starts over the window, by construction type. */
export interface Starts {
  n: number;
  V: number;
  III: number;
  I: number;
}

/** One measured run. */
export interface CapRun {
  who: Who;
  /** Stories of the transit bands; null for current law. */
  cap: number | null;
  completedNet: At;
  starts: Starts;
}

export interface CapRow {
  who: Who;
  cap: number | null;
  now: At;
  old: At;
  starts: Starts;
}

/** The rows in table order: current law, then the transit rule and the full tree, each by cap. */
export function capTable(runs: readonly CapRun[]): CapRow[] {
  const find = (who: Who, cap: number | null): CapRun => {
    const r = runs.find((x) => x.who === who && x.cap === cap);
    if (r === undefined) throw new Error(`no run for ${who}${cap === null ? '' : ` at ${cap}`}`);
    return r;
  };
  const row = (who: Who, cap: number | null, old: At): CapRow => {
    const r = find(who, cap);
    return { who, cap, now: r.completedNet, old, starts: r.starts };
  };
  return [
    row('current', null, OLD_FIGURES.current),
    ...CAPS.map((c) => row('transit', c, OLD_FIGURES.transit[c])),
    ...CAPS.map((c) => row('full', c, OLD_FIGURES.full[c]))
  ];
}

const count = (n: number) => n.toLocaleString('en-US');
const pct = (k: number, n: number) => (n === 0 ? '—' : `${Math.round((100 * k) / n)}%`);

const NAMES: Record<Who, string> = {
  current: 'Current law',
  transit: 'Transit rule',
  full: 'Every policy'
};

/** The printed lines; `years` labels months 168 and 479 (the live dataset's by default). */
export function capLines(
  datasetVersion: string,
  rows: readonly CapRow[],
  years: { 168: string; 479: string } = { 168: '2040', 479: '2066' }
): string[] {
  const lines = [`Dataset ${datasetVersion}; old figures from dataset ${OLD_DATASET}`];
  for (const r of rows) {
    const name = r.cap === null ? NAMES[r.who] : `${NAMES[r.who]}, ${r.cap} stories`;
    const figs = MONTHS.map((m) => `${years[m]} ${count(r.now[m])} (was ${count(r.old[m])})`);
    const s = r.starts;
    const types = `V ${pct(s.V, s.n)}, III ${pct(s.III, s.n)}, I ${pct(s.I, s.n)} (n ${count(s.n)})`;
    lines.push(`${name}: ${figs.join(', ')}; starts ${types}`);
  }
  return lines;
}

/** Simulated rows of `world` by construction type (rows with none are counted in n only). */
export function startsOf(world: World): Starts {
  const p = world.projects;
  const s: Starts = { n: 0, V: 0, III: 0, I: 0 };
  for (let row = 0; row < p.n; row++) {
    if (p.origin[row] !== ORIGIN_SIM) continue;
    s.n++;
    if (p.btype[row] !== NO_BTYPE) s[BUILDING_TYPES[p.btype[row]]]++;
  }
  return s;
}

/** Current law plus one transit rule: every stop type, `TRANSIT_MAX_M`, `stories`. */
export function transitDoc(asOf: Day, stories: number): SimPolicy4 {
  const rule: Policy = {
    id: TRANSIT_RULE_ID,
    label: 'Transit rule',
    preset: null,
    on: true,
    where: { tag: 'transit', stopTypes: [...STOP_TYPES] },
    spans: [
      {
        from: monthFirstDay(asOf, 1),
        to: null,
        what: { tag: 'bands', bands: [{ maxM: TRANSIT_MAX_M, stories }] }
      }
    ]
  };
  return { ...DEFAULT_POLICY4, kinds: { ...DEFAULT_POLICY4.kinds, zoning: [rule] } };
}

/** Every policy of the catalogue on, every band of its transit policies at `stories`. */
export function fullDoc(cal: Calibration, stories: number): SimPolicy4 {
  const doc = catalogueDoc(cal, POLICY_KEYS);
  const zoning = doc.kinds.zoning.map((p) =>
    p.where.tag !== 'transit'
      ? p
      : {
          ...p,
          spans: p.spans.map((sp) =>
            sp.what.tag !== 'bands'
              ? sp
              : {
                  ...sp,
                  what: {
                    tag: 'bands' as const,
                    bands: sp.what.bands.map((b) => ({ ...b, stories }))
                  }
                }
          )
        }
  );
  return { ...doc, kinds: { ...doc.kinds, zoning } };
}

/** One run's figures, and the year of each month read. */
export function measure(
  worlds: Worlds,
  who: Who,
  cap: number | null,
  doc: SimPolicy4
): { run: CapRun; years: { 168: string; 479: string } } {
  const { world, rows, months } = worlds.run(doc, { series: true });
  const i = (m: number) => Math.min(m, rows.length - 1);
  const year = (m: number) => String(utcParts(months[i(m)]).y);
  return {
    run: {
      who,
      cap,
      completedNet: at(rows[i(MONTHS[0])].completedNet, rows[i(MONTHS[1])].completedNet),
      starts: startsOf(world)
    },
    years: { 168: year(MONTHS[0]), 479: year(MONTHS[1]) }
  };
}

export interface CapIo {
  out(line: string): void;
  err(line: string): void;
  /** Progress, one line per run (stderr by default). */
  progress?(line: string): void;
}

const CONSOLE_IO: CapIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  progress: (line) => console.error(line)
};

const USAGE = 'usage: npx tsx scripts/cap-measure.ts <datasetDir> [--json]';
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function main(argv: string[], io: CapIo = CONSOLE_IO): Promise<0 | 2> {
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  if (rest.length !== 1 || rest[0].startsWith('--')) {
    io.err(`cap-measure: ${USAGE}`);
    return 2;
  }
  try {
    const worlds = await openWorlds(rest[0], { warn: (m) => io.err(m) });
    const plan: [Who, number | null, SimPolicy4][] = [
      ['current', null, DEFAULT_POLICY4],
      ...CAPS.map((c): [Who, number, SimPolicy4] => ['transit', c, transitDoc(worlds.asOf, c)]),
      ...CAPS.map((c): [Who, number, SimPolicy4] => ['full', c, fullDoc(worlds.cal, c)])
    ];
    const runs: CapRun[] = [];
    let years: { 168: string; 479: string } | undefined;
    const t0 = performance.now();
    for (const [who, cap, doc] of plan) {
      const m = measure(worlds, who, cap, doc);
      runs.push(m.run);
      years ??= m.years;
      const s = ((performance.now() - t0) / 1000).toFixed(0);
      io.progress?.(`cap-measure: ${who}${cap === null ? '' : ` ${cap}`} done (${s} s)`);
    }
    const rows = capTable(runs);
    if (json) {
      io.out(
        JSON.stringify(
          { datasetVersion: worlds.datasetVersion, oldDataset: OLD_DATASET, years, rows },
          null,
          2
        )
      );
    } else {
      for (const line of capLines(worlds.datasetVersion, rows, years)) io.out(line);
    }
    return 0;
  } catch (e) {
    io.err(`cap-measure: ${messageOf(e)}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`cap-measure: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
