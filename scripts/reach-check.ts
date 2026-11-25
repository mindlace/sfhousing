// `npx tsx scripts/reach-check.ts <datasetDir> | --version <v> [--from <origin>] [--amount <homes>]`:
// asks one dataset two questions of the goal, reached or missed: does current law (the empty
// policy document) reach it by the first rung's deadline, and does the full tree reach it by the
// last rung's. Exits 0 when both are reached, 1 when either is missed, 2 when the check could not
// run (one stderr line, `reach-check: {reason}`, nothing on stdout).
import { pathToFileURL } from 'node:url';
import { formatShortMonthYear } from '../src/lib/fzp/format';
import { utcParts } from '../src/lib/fzp/time';
import { fullTree } from '../src/lib/game/catalogue/play';
import { RUNGS, goalAt } from '../src/lib/game/ladder';
import { TODAY, readGoal } from '../src/lib/goal/goal';
import type { TimelineView } from '../src/lib/sim/world/score/types';
import type { Day } from '../src/lib/timelapse/time';
import { DEFAULT_POLICY4 } from '../src/lib/timeline/policy4';
import {
  openEngine,
  parseAmount,
  parseSourceArgs,
  type DataSource,
  type Engine
} from './reach-measure';

export interface Reach {
  who: 'current' | 'full';
  rung: number;
  amount: number;
  deadline: Day;
  /** The first month the amount is met; null when it is not met by the deadline. */
  reachedOn: Day | null;
  /** Homes counted by the goal's measure at the deadline month. */
  homesAtDeadline: number;
  /** Calendar months from reachedOn to the deadline; null when missed. */
  marginMonths: number | null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const USAGE =
  'usage: npx tsx scripts/reach-check.ts <datasetDir> | --version <v> ' +
  '[--from <origin>] [--amount <homes>]';

/** Calendar months from `a`'s month to `b`'s. */
function monthsBetween(a: Day, b: Day): number {
  const ay = utcParts(a);
  const by = utcParts(b);
  return (by.y - ay.y) * 12 + (by.m - ay.m);
}

/** Read the goal over a filled view: current law at rung 0, the full tree at the last rung. */
export function readReach(
  view: TimelineView,
  asOf: Day,
  who: 'current' | 'full',
  amount?: number
): Reach {
  const rung = who === 'current' ? 0 : RUNGS - 1;
  const goal = goalAt(asOf, rung, amount);
  const reading = readGoal(goal, view, view.lastIndex);
  if (reading === null) throw new Error('the window is not filled');
  const offset = monthsBetween(view.months[0], goal.deadline);
  const d = offset < 0 ? TODAY : Math.min(offset, view.lastIndex);
  const { reachedOn } = reading;
  return {
    who,
    rung,
    amount: goal.amount,
    deadline: goal.deadline,
    reachedOn,
    homesAtDeadline: goal.measure.valueAt(view, d),
    marginMonths: reachedOn === null ? null : monthsBetween(reachedOn, goal.deadline)
  };
}

const count = (n: number) => n.toLocaleString('en-US');

/** One answer's line: "Current law by Mon YYYY: reached ..." or "...: missed, N homes, M short". */
function answerLine(r: Reach): string {
  const head = `${r.who === 'current' ? 'Current law' : 'Full tree'} by ${formatShortMonthYear(r.deadline)}: `;
  if (r.reachedOn === null || r.marginMonths === null) {
    return `${head}missed, ${count(r.homesAtDeadline)} homes, ${count(r.amount - r.homesAtDeadline)} short`;
  }
  const n = r.marginMonths;
  return `${head}reached ${formatShortMonthYear(r.reachedOn)}, ${count(n)} ${n === 1 ? 'month' : 'months'} early`;
}

/** The lines the command prints: the dataset, the goal, then each answer. */
export function reachLines(datasetVersion: string, r: readonly Reach[]): string[] {
  return [`Dataset ${datasetVersion}`, `Goal: ${count(r[0].amount)} homes`, ...r.map(answerLine)];
}

/** 0 when every answer is reached, 1 when any is missed. */
export function reachExit(r: readonly Reach[]): 0 | 1 {
  return r.some((x) => x.reachedOn === null) ? 1 : 0;
}

/** The command's arguments, or the reason they are refused. */
export function parseCheckArgs(
  argv: string[]
): { src: DataSource; amount?: number } | { error: string } {
  if (argv.length === 0) return { error: USAGE };
  const parsed = parseSourceArgs(argv, { amount: 'value' });
  if ('error' in parsed) return parsed;
  const amount = parseAmount(parsed.flags.amount);
  if (typeof amount === 'object') return amount;
  return amount === undefined ? { src: parsed.src } : { src: parsed.src, amount };
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
    engine = await open(args.src, { warn: (msg) => warnings.push(msg) });
    const current = await engine.view(DEFAULT_POLICY4);
    const full = await engine.view(fullTree(engine.cal).doc);
    const r = [
      readReach(current, engine.asOf, 'current', args.amount),
      readReach(full, engine.asOf, 'full', args.amount)
    ];
    const lines = reachLines(engine.datasetVersion, r);
    for (const w of warnings) io.err(w);
    for (const line of lines) io.out(line);
    return reachExit(r);
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
