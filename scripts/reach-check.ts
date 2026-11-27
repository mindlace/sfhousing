// `npx tsx scripts/reach-check.ts <datasetDir> | --version <v> [--from <origin>] [--amount <homes>]
// [--cars on|off]`: the one rule is that every policy of the catalogue on, at its fixed values,
// reaches the goal inside the window. Exits 0 when it does, 1 when it does not, 2 when the check
// could not run (one stderr line, `reach-check: {reason}`, nothing on stdout). The report beside
// the rule asks the engine for current law, every policy on, each policy alone against current law
// and over the rounds before its own, and rounds 1..k all on, and prints the month each reaches the
// goal, the months it is earlier by and the homes at the window's end, then lists what to judge: a
// round that gains nothing and a policy that builds fewer homes. The last line says how long the
// opening fill took. `--cars off` runs the worlds without the car system (default on: the dataset's
// car system, whose parking link moves start odds when the model prices parking).
import { pathToFileURL } from 'node:url';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { CATALOGUE, ROUNDS, type PolicyKey } from '../src/lib/game/catalogue/rounds';
import { catalogueDoc } from '../src/lib/game/offer';
import { monthsBetween } from '../src/lib/game/rounds';
import { defaultGoal, readGoal } from '../src/lib/goal/goal';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import { openEngine, parseSourceArgs, type DataSource, type Engine } from './lib/engine-runner';

/** 'on' (default): the dataset's car system, when it has one; 'off': none. */
export type CarsSwitch = 'on' | 'off';

export interface Reading {
  /** The first month the amount is met; null when it is not met inside the window. */
  reachedOn: Day | null;
  /** Homes counted by the goal's measure at the window's last month. */
  homesAtEnd: number;
}

export interface Report {
  /** Every policy on. */
  all: Reading;
  /** Current law. */
  law: Reading;
  /** Each policy alone, against current law. */
  alone: { key: PolicyKey; r: Reading }[];
  /** Each policy over the rounds before its own; base: those rounds all on. */
  inRound: { key: PolicyKey; r: Reading; base: Reading }[];
  /** Rounds 1..k all on. */
  rounds: { round: number; r: Reading }[];
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const USAGE =
  'usage: npx tsx scripts/reach-check.ts <datasetDir> | --version <v> ' +
  '[--from <origin>] [--amount <homes>] [--cars on|off]';

/** The goal over a filled view: when its amount is first met, and the homes at the window's end. */
export function readReading(view: TimelineView, asOf: Day, amount?: number): Reading {
  const base = defaultGoal(asOf);
  const goal = amount === undefined ? base : { ...base, amount };
  const reading = readGoal(goal, view, view.lastIndex);
  if (reading === null) throw new Error('the window is not filled');
  return {
    reachedOn: reading.reachedOn,
    homesAtEnd: goal.measure.valueAt(view, view.lastIndex)
  };
}

const roundOf = (key: PolicyKey): number => CATALOGUE.find((e) => e.key === key)!.round;

/** The keys of rounds 1..round, in catalogue order. */
const keysThrough = (round: number): PolicyKey[] =>
  CATALOGUE.filter((e) => e.round <= round).map((e) => e.key);

/**
 * Asks the engine for current law, every policy on, each key alone, each key over the rounds
 * before it and rounds 1..k, one view at a time; a list of keys asked twice is read once.
 */
export async function measure(engine: Engine, amount?: number): Promise<Report> {
  const kept = new Map<string, Reading>();
  const read = async (keys: readonly PolicyKey[]): Promise<Reading> => {
    const id = keys.join(',');
    const had = kept.get(id);
    if (had !== undefined) return had;
    const r = readReading(await engine.view(catalogueDoc(engine.cal, keys)), engine.asOf, amount);
    kept.set(id, r);
    return r;
  };
  const law = await read([]);
  const all = await read(keysThrough(ROUNDS));
  const rounds: Report['rounds'] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    rounds.push({ round, r: await read(keysThrough(round)) });
  }
  const alone: Report['alone'] = [];
  for (const { key } of CATALOGUE) alone.push({ key, r: await read([key]) });
  const inRound: Report['inRound'] = [];
  for (const { key } of CATALOGUE) {
    const before = keysThrough(roundOf(key) - 1);
    inRound.push({ key, r: await read(before.concat(key)), base: await read(before) });
  }
  return { all, law, alone, inRound, rounds };
}

const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;
const labelOf = (key: PolicyKey): string => CATALOGUE.find((e) => e.key === key)!.label;

/** "reached Mon YYYY" or "not by Mon YYYY" for the window's end. */
const reachedText = (r: Reading, end: Day): string =>
  r.reachedOn === null
    ? `not by ${formatShortMonthYear(end)}`
    : `reached ${formatShortMonthYear(r.reachedOn)}`;

/** How much earlier `r` reaches than `base`: "5 months earlier", "no change", "n/a" for a miss. */
function changeText(r: Reading, base: Reading): string {
  if (r.reachedOn === null || base.reachedOn === null) return 'n/a';
  const earlier = monthsBetween(r.reachedOn, base.reachedOn);
  if (earlier === 0) return 'no change';
  return earlier > 0 ? `${plural(earlier, 'month')} earlier` : `${plural(-earlier, 'month')} later`;
}

/** A line of a policy or round: the month, the change against `base`, the homes by the end. */
function effectLine(name: string, r: Reading, base: Reading, end: Day, homes: string): string {
  const when =
    r.reachedOn === null
      ? `not by ${formatShortMonthYear(end)}`
      : formatShortMonthYear(r.reachedOn);
  return `  ${name}: ${when}, ${changeText(r, base)}, ${homes} by ${formatShortMonthYear(end)}`;
}

/** A homes difference with its sign: "+111 homes", "-222 homes". */
const delta = (n: number): string => `${n < 0 ? '-' : '+'}${count(Math.abs(n))} homes`;

/** The lines the command prints but the opening fill's: the rule's answers, then the report. */
export function reportLines(
  datasetVersion: string,
  amount: number,
  end: Day,
  rep: Report
): string[] {
  const lines = [
    `Dataset ${datasetVersion}`,
    `Goal: ${count(amount)} homes`,
    `Every policy: ${reachedText(rep.all, end)}`,
    `Current law: ${reachedText(rep.law, end)}`,
    'Alone, against current law:',
    ...rep.alone.map((a) =>
      effectLine(labelOf(a.key), a.r, rep.law, end, delta(a.r.homesAtEnd - rep.law.homesAtEnd))
    ),
    'In its round, against the rounds before:',
    ...rep.inRound.map((a) =>
      effectLine(labelOf(a.key), a.r, a.base, end, delta(a.r.homesAtEnd - a.base.homesAtEnd))
    ),
    'Rounds, all on:'
  ];
  const judge: string[] = [];
  rep.rounds.forEach((row, i) => {
    const above = i === 0 ? rep.law : rep.rounds[i - 1].r;
    lines.push(
      effectLine(String(row.round), row.r, above, end, `${count(row.r.homesAtEnd)} homes`)
    );
    const earlier =
      row.r.reachedOn !== null && (above.reachedOn === null || row.r.reachedOn < above.reachedOn);
    if (!earlier) judge.push(`  Round ${row.round} gains nothing`);
  });
  for (const a of rep.alone) {
    const fewer = rep.law.homesAtEnd - a.r.homesAtEnd;
    if (fewer > 0) judge.push(`  ${labelOf(a.key)} alone: ${count(fewer)} fewer homes`);
  }
  for (const a of rep.inRound) {
    const fewer = a.base.homesAtEnd - a.r.homesAtEnd;
    if (fewer > 0) judge.push(`  ${labelOf(a.key)} in its round: ${count(fewer)} fewer homes`);
  }
  return [...lines, ...(judge.length === 0 ? ['To judge: nothing'] : ['To judge:', ...judge])];
}

/** 0 when every policy on reaches the goal inside the window, else 1. */
export function reachExit(rep: Report): 0 | 1 {
  return rep.all.reachedOn !== null ? 0 : 1;
}

/** The line reporting the opening fill's wall-clock time. */
export function fillLine(fillMs: number, cars: CarsSwitch): string {
  return `Filled in ${(fillMs / 1000).toFixed(1)} s (cars ${cars})`;
}

/** `--amount`'s value: a positive whole number, or undefined when not given. */
export function parseAmount(v: string | true | undefined): number | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (v === true || !/^\d+$/.test(v) || Number(v) <= 0) {
    return { error: `--amount must be a positive integer, got ${v === true ? 'nothing' : v}` };
  }
  return Number(v);
}

/** The command's arguments, or the reason they are refused. */
export function parseCheckArgs(
  argv: string[]
): { src: DataSource; amount?: number; cars: CarsSwitch } | { error: string } {
  if (argv.length === 0) return { error: USAGE };
  const parsed = parseSourceArgs(argv, { amount: 'value', cars: 'value' });
  if ('error' in parsed) {
    return parsed.error === '--cars needs a value'
      ? { error: '--cars must be on or off, got nothing' }
      : parsed;
  }
  const given = parsed.flags.cars;
  if (given !== undefined && given !== 'on' && given !== 'off') {
    return { error: `--cars must be on or off, got ${given === true ? 'nothing' : given}` };
  }
  const cars: CarsSwitch = given ?? 'on';
  const amount = parseAmount(parsed.flags.amount);
  if (typeof amount === 'object') return amount;
  return amount === undefined ? { src: parsed.src, cars } : { src: parsed.src, amount, cars };
}

export interface CheckIo {
  out(line: string): void;
  err(line: string): void;
  /** Test seam, default `openEngine`. */
  open?: typeof openEngine;
}

const CONSOLE_IO: CheckIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line)
};

export async function main(argv: string[], io: CheckIo = CONSOLE_IO): Promise<0 | 1 | 2> {
  const args = parseCheckArgs(argv);
  if ('error' in args) {
    io.err(`reach-check: ${args.error}`);
    return 2;
  }
  const open = io.open ?? openEngine;
  // Warnings are kept until the check has run: a refusal prints one line and nothing else.
  const warnings: string[] = [];
  let engine: Engine | null = null;
  try {
    engine = await open(args.src, { warn: (msg) => warnings.push(msg), cars: args.cars });
    const rep = await measure(engine, args.amount);
    const law = await engine.view(DEFAULT_POLICY4);
    const amount = args.amount ?? defaultGoal(engine.asOf).amount;
    const lines = [
      ...reportLines(engine.datasetVersion, amount, law.months[law.lastIndex], rep),
      fillLine(engine.fillMs, args.cars)
    ];
    for (const w of warnings) io.err(w);
    for (const line of lines) io.out(line);
    return reachExit(rep);
  } catch (e) {
    io.err(`reach-check: ${messageOf(e)}`);
    return 2;
  } finally {
    engine?.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`reach-check: ${messageOf(e)}`);
      process.exitCode = 2;
    }
  );
}
