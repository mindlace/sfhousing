import * as policyCodecModule from '$lib/data/policy-codec';
import * as chooseModule from '$lib/sim/choice/choose';
import * as choiceTypesModule from '$lib/sim/choice/types';
import type { HeightTimeModel } from '$lib/sim/choice/types';
import * as leversTypesModule from '$lib/sim/levers/types';
import * as rngModule from '$lib/sim/world/rules/rng';
import * as stagesModule from '$lib/sim/world/rules/stages';
import * as modelModule from '$lib/timelapse/model';
import * as timeModule from '$lib/timelapse/time';
import type { Day } from '$lib/timelapse/time';
import * as timelapseTypesModule from '$lib/timelapse/types';
import type { Calibration, Pathway, RevisionModel, Stage } from '$lib/timelapse/types';
import * as columnsModule from './columns';
import type { PolicyFrame } from './policy/frame';
import * as typesModule from './types';
import type { World } from './types';

// Imports are bound once, here: under Vite's module runner (the tests and the cost bench) every
// use of an imported name is a getter call (docs/dev/world-core.md, Cost).
const { NULL_CAP } = policyCodecModule;
const { allowedCount, optionHomes } = chooseModule;
const { stepAt } = choiceTypesModule;
const { MAX_SCALE, MIN_SCALE } = leversTypesModule;
const { P, drawOn } = rngModule;
const { revisionRatio } = stagesModule;
const { sampleAdvance, sampleTransition } = modelModule;
const { stageMonths } = timeModule;
const { EXIT_ORDER, PATHWAYS, STAGE_ORDER } = timelapseTypesModule;
const { pushRev } = columnsModule;
const { NO_DAY, RULE_NONE, RULE_PIPELINE } = typesModule;

type Scale = Partial<Record<Stage, number>>;
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');

/**
 * The height-band multiplier on a stage's drawn time (building-choice spec, construction time by
 * height band): the step of `ht` in force on `day` (the stage entry), at the first band whose
 * `upTo` holds `stories`. 1 for NaN stories, for stages other than `permitIssued` and
 * `construction`, and without a model.
 */
export function heightMultiplier(
  ht: HeightTimeModel | undefined,
  stage: Stage,
  stories: number,
  day: Day
): number {
  if (ht === undefined || Number.isNaN(stories)) return 1;
  if (stage !== 'permitIssued' && stage !== 'construction') return 1;
  let band = 0;
  while (band < ht.upTo.length - 1 && stories > ht.upTo[band]) band++;
  return stepAt(ht.steps, day).value[stage][band];
}

/** The row's stories as last proposed: its latest revision's, else its start's (NaN = unknown). */
function rowStories(w: World, row: number): number {
  const p = w.projects;
  const last = p.revLast[row];
  return last >= 0 ? p.revStories[last] : p.stories[row];
}

/**
 * The scale on a stage's time for a project that filed on `filed`: the frame's `speed` times each
 * `speedNew` entry that reaches it (not yet filed, or filed on or after `from`), in list order,
 * clamped.
 */
export function speedOf(frame: PolicyFrame, pathway: Pathway, stage: Stage, filed: Day): number {
  let s = (frame.speed[pathway] as Scale)[stage] ?? 1;
  for (const e of frame.speedNew) {
    if (filed === NO_DAY || filed >= e.from) s *= (e.scale[pathway] as Scale)[stage] ?? 1;
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** `speedOf` for a row's own pathway, current stage and filing day. */
export function rowSpeed(w: World, row: number, frame: PolicyFrame): number {
  const p = w.projects;
  return speedOf(frame, PATHWAYS[p.pathway[row]], STAGE_ORDER[p.stage[row]], p.filed[row]);
}

/**
 * Draws stage `stage` of the row, entered on `entered` with `survived` days already spent in it
 * (rules 10, 11 and 15).
 */
export function enterStage(
  w: World,
  row: number,
  stage: number,
  entered: Day,
  survived: number,
  frame: PolicyFrame
): void {
  const p = w.projects;
  const cal = p.isNew[row] === 1 ? frame.newCalibration : frame.calibration;
  const name = STAGE_ORDER[stage];
  const pathway = PATHWAYS[p.pathway[row]];
  const t = name === 'complete' ? undefined : cal.transitions[pathway][name];
  if (t === undefined) throw new Error(`calibration has no ${pathway} ${name} transition`);
  const stream = p.stream[row];
  let length: number;
  if (p.certain[row] === 1) {
    p.outcome[row] = 0;
    length = sampleAdvance(t, drawOn(stream, P.STAGE_TIME, stage)).days;
  } else {
    const r = sampleTransition(
      t,
      drawOn(stream, P.STAGE, stage),
      drawOn(stream, P.STAGE_TIME, stage),
      stageMonths(survived)
    );
    p.outcome[row] = r.kind === 'advance' ? 0 : 1 + EXIT_ORDER.indexOf(r.kind);
    length = r.days;
  }
  // The height band scales the drawn time still to run; the days already spent are a record.
  const mult = heightMultiplier(cal.heightTime, name, rowStories(w, row), entered);
  p.length[row] = mult === 1 ? length : survived + (length - survived) * mult;
  p.stage[row] = stage;
  p.used[row] = survived;
  p.anchor[row] = entered + survived;
  const speed = speedOf(frame, pathway, name, p.filed[row]);
  p.speed[row] = speed;
  p.leave[row] = p.anchor[row] + Math.floor(speed * (p.length[row] - survived));
}

/**
 * A speed change on day `c`: carries the used length at the old speed and re-plans the leave
 * (rule 12). Call it only when `speed` differs from the row's speed: `used` is a float, and
 * re-anchoring at an unchanged speed can move the leave by a day.
 */
export function reanchor(w: World, row: number, c: Day, speed: number): void {
  const p = w.projects;
  p.used[row] += (c - p.anchor[row]) / p.speed[row];
  p.anchor[row] = c;
  p.speed[row] = speed;
  p.leave[row] = Math.max(c, c + Math.floor(speed * (p.length[row] - p.used[row])));
}

const memo = new WeakMap<Calibration, (RevisionModel['at'][number] | undefined)[]>();

function revisionAtOf(cal: Calibration): (RevisionModel['at'][number] | undefined)[] {
  let at = memo.get(cal);
  if (!at) {
    at = STAGE_ORDER.map(() => undefined);
    for (const a of cal.revision.at) {
      const i = STAGE_ORDER.indexOf(a.stage);
      if (at[i] === undefined) at[i] = a;
    }
    memo.set(cal, at);
  }
  return at;
}

/** The revision on entering `stage` on `day` (rule 13); true when the units changed. */
export function reviseOnEntry(
  w: World,
  row: number,
  stage: number,
  day: Day,
  frame: PolicyFrame
): boolean {
  const p = w.projects;
  if (stage >= CONSTRUCTION || p.rule[row] === RULE_NONE) return false;
  const last = p.revLast[row];
  if (last < 0) throw new Error(`reviseOnEntry: row ${row} has no base revision entry`);
  const at = revisionAtOf(frame.calibration)[stage];
  if (at === undefined) return false;
  const stream = p.stream[row];
  if (!(drawOn(stream, P.REV, stage) < at.probability)) return false;
  const ratio = revisionRatio(at.ratio, drawOn(stream, P.REV_RATIO, stage));
  const units = p.revUnits[last];
  const lastStories = p.revStories[last];
  let next: number;
  let stories: number | null;
  if (p.rule[row] === RULE_PIPELINE) {
    next = Math.min(Math.max(1, Math.round(ratio * units)), Math.max(units, p.yieldCap[row]));
    if (Number.isNaN(lastStories)) stories = null;
    else {
      let s = Math.max(1, Math.round((lastStories * next) / units));
      if (next > units) s = Math.min(s, Math.max(lastStories, p.envelope[row]));
      stories = s;
    }
  } else {
    // Within the construction type: an entitled building keeps its frame (plan, Revisions).
    const t = frame.view.pre.choice.t;
    const lot = p.src[row];
    const from = t.offset[lot];
    const allowed = allowedCount(t, lot, p.env[row]);
    const cap = p.optCap[row] === NULL_CAP ? null : p.optCap[row];
    const existing = p.existing[row];
    const type = p.btype[row];
    let most = 0;
    for (let k = 0; k < allowed; k++) {
      if (t.type[from + k] === type) most = Math.max(most, optionHomes(t, from + k, cap, existing));
    }
    next = Math.min(most, Math.max(existing + 1, Math.round(ratio * units)));
    // the same-type option with the fewest homes that holds them (the first on a tie)
    let best = -1;
    let fewest = Infinity;
    for (let k = 0; k < allowed; k++) {
      if (t.type[from + k] !== type) continue;
      const h = optionHomes(t, from + k, cap, existing);
      if (h >= next && h < fewest) {
        best = k;
        fewest = h;
      }
    }
    if (next === units || best < 0) return false;
    p.level[row] = best;
    stories = t.stories[from + best];
  }
  if (next === units) return false;
  pushRev(p, row, day, next, stories, p.level[row]);
  return true;
}
