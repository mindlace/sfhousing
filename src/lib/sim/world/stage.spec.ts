import { describe, expect, it } from 'vitest';
import { NULL_CAP } from '$lib/data/policy-codec';
import { allowedCount } from '$lib/sim/choice/choose';
import { MAX_SCALE, MIN_SCALE } from '$lib/sim/levers/types';
import { revisionRatio } from '$lib/sim/world/rules/stages';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/world/rules/rng';
import { sampleAdvance } from '$lib/timelapse/model';
import { PATHWAYS, STAGE_ORDER, type Calibration, type Stage } from '$lib/timelapse/types';
import { addProject, emptyWorld, pushRev, revisionsOf } from './columns';
import { monthFirstDay, monthOfDay } from './months';
import { dueMonthOf } from './pipeline';
import { enterStage, heightMultiplier, reanchor, reviseOnEntry, rowSpeed, speedOf } from './stage';
import { frameOf, IDENTITY } from './test/timeline';
import { miniInput } from './test/mini';
import { NO_DAY, RULE_NONE, RULE_PIPELINE, RULE_SIM } from './types';

const input = miniInput();
const frame = frameOf(input);
const streams = Array.from({ length: 200 }, (_, e) => streamOf(seedHash(1), e, 0));

/** The first stage with a transition on a pathway. */
function stageWith(pathway: (typeof PATHWAYS)[number]) {
  const name = STAGE_ORDER.find(
    (s): s is Exclude<Stage, 'complete'> =>
      s !== 'complete' && frame.calibration.transitions[pathway][s] !== undefined
  );
  if (!name) throw new Error('no transition');
  return { name, i: STAGE_ORDER.indexOf(name), t: frame.calibration.transitions[pathway][name]! };
}

function rowOn(pathway: number, stream: number, o: { certain?: boolean; isNew?: boolean } = {}) {
  const w = emptyWorld(0);
  const row = addProject(w.projects);
  w.projects.pathway[row] = pathway;
  w.projects.stream[row] = stream;
  w.projects.certain[row] = o.certain ? 1 : 0;
  w.projects.isNew[row] = o.isNew ? 1 : 0;
  return { w, row };
}

describe('speedOf', () => {
  it('is the product of speed and the speedNew entries that reach the row, clamped', () => {
    const half = { ...IDENTITY, discretionary: { filed: 0.5 } };
    const f = { ...frame, speed: half, speedNew: [{ from: 500, scale: half }] };
    expect(speedOf(f, 'discretionary', 'filed', NO_DAY)).toBe(0.25);
    expect(speedOf(f, 'discretionary', 'filed', 500)).toBe(0.25);
    expect(speedOf(f, 'discretionary', 'filed', 499)).toBe(0.5);
    expect(speedOf(f, 'discretionary', 'entitled', NO_DAY)).toBe(1);
    const tenth = { ...IDENTITY, discretionary: { filed: 0.1 } };
    const low = { ...frame, speed: tenth, speedNew: [{ from: 0, scale: tenth }] };
    expect(speedOf(low, 'discretionary', 'filed', NO_DAY)).toBe(MIN_SCALE);
    const five = { ...IDENTITY, discretionary: { filed: 5 } };
    const high = { ...frame, speed: five, speedNew: [{ from: 0, scale: five }] };
    expect(speedOf(high, 'discretionary', 'filed', NO_DAY)).toBe(MAX_SCALE);
  });

  it('rowSpeed reads the row pathway, stage and filing day', () => {
    const half = { ...IDENTITY, streamlined: { filed: 0.5 } };
    const f = { ...frame, speed: half };
    const { w, row } = rowOn(PATHWAYS.indexOf('streamlined'), 1);
    w.projects.stage[row] = STAGE_ORDER.indexOf('filed');
    expect(rowSpeed(w, row, f)).toBe(0.5);
  });
});

describe.each(PATHWAYS.map((p, i) => [p, i] as const))('the stage clock on %s', (pathway, pi) => {
  const { name, i, t } = stageWith(pathway);

  it('a certain row advances on sampleAdvance and never reads the stage draw', () => {
    let exits = 0;
    for (const s of [1, 0.5]) {
      const f = { ...frame, speed: { ...IDENTITY, [pathway]: { [name]: s } } };
      for (let e = 0; e < streams.length; e++) {
        const ordinary = rowOn(pi, streams[e]);
        enterStage(ordinary.w, ordinary.row, i, 100, 0, f);
        if (ordinary.w.projects.outcome[ordinary.row] !== 0) exits++;
        const { w, row } = rowOn(pi, streams[e], { certain: true });
        enterStage(w, row, i, 100, 0, f);
        expect(w.projects.outcome[row]).toBe(0);
        expect(w.projects.leave[row]).toBe(
          100 + Math.floor(s * sampleAdvance(t, drawOn(streams[e], P.STAGE_TIME, i)).days)
        );
      }
    }
    if (Object.keys(t.exit).length > 0) expect(exits).toBeGreaterThan(0);
    else expect(exits).toBe(0);
  });

  it('a new row draws on the new calibration', () => {
    const slow: Calibration = {
      ...frame.calibration,
      transitions: {
        ...frame.calibration.transitions,
        [pathway]: { ...frame.calibration.transitions[pathway], [name]: undefined }
      }
    };
    const f = { ...frame, newCalibration: slow };
    const old = rowOn(pi, streams[0]);
    enterStage(old.w, old.row, i, 0, 0, f);
    const fresh = rowOn(pi, streams[0], { isNew: true });
    expect(() => enterStage(fresh.w, fresh.row, i, 0, 0, f)).toThrow(/no .* transition/);
  });
});

describe('reanchor', () => {
  function row100() {
    const { w, row } = rowOn(0, 1);
    const p = w.projects;
    p.anchor[row] = 100;
    p.used[row] = 0;
    p.length[row] = 60;
    p.speed[row] = 1;
    p.leave[row] = 160;
    return { w, row };
  }

  it('carries the used length', () => {
    const { w, row } = row100();
    reanchor(w, row, 130, 0.5);
    expect(w.projects.used[row]).toBe(30);
    expect(w.projects.leave[row]).toBe(145);
    reanchor(w, row, 140, 2);
    expect(w.projects.used[row]).toBe(50);
    expect(w.projects.leave[row]).toBe(160);
  });

  it('clamps to the change day', () => {
    const { w, row } = rowOn(0, 1);
    const p = w.projects;
    p.anchor[row] = 0;
    p.used[row] = 0;
    p.length[row] = 0.3;
    p.speed[row] = 10;
    p.leave[row] = 3;
    reanchor(w, row, 3, 1);
    expect(p.leave[row]).toBe(3);
  });

  it('clamps to the change day when used rounds past length, so the row stays due', () => {
    // s_old = 1.045, length 1000, used 0: leave = anchor + 1045. Re-anchoring on that very day
    // gives used = 1045 / 1.045 = 1000.0000000000001, one ulp past length.
    const asOf = 0;
    const m = 36;
    const c = monthFirstDay(asOf, m);
    const { w, row } = rowOn(0, 1);
    const p = w.projects;
    p.anchor[row] = c - 1045;
    p.used[row] = 0;
    p.length[row] = 1000;
    p.speed[row] = 1.045;
    p.leave[row] = p.anchor[row] + Math.floor(1.045 * 1000);
    expect(p.leave[row]).toBe(c);
    expect(dueMonthOf(w, asOf, row)).toBe(m);
    reanchor(w, row, c, 1);
    expect(p.used[row]).toBeGreaterThan(p.length[row]);
    const unclamped = c + Math.floor(p.speed[row] * (p.length[row] - p.used[row]));
    expect(unclamped).toBe(c - 1);
    expect(monthOfDay(asOf, unclamped)).toBe(m - 1);
    expect(p.leave[row]).toBe(c);
    expect(dueMonthOf(w, asOf, row)).toBe(m);
  });
});

describe('revisions', () => {
  const stage = STAGE_ORDER.indexOf('entitled');
  const withRevision = (probability: number, edges: number[], probs: number[]) => {
    const cal: Calibration = {
      ...frame.calibration,
      revision: {
        ...frame.calibration.revision,
        at: [{ stage: STAGE_ORDER[stage], probability, ratio: { edges, probs } }]
      }
    };
    return { ...frame, calibration: cal };
  };

  it('follow today’s pipeline rules', () => {
    const f = withRevision(1, [0.5, 2], [1]);
    let changed = 0;
    for (const stream of streams) {
      const { w, row } = rowOn(0, stream);
      const p = w.projects;
      p.rule[row] = RULE_PIPELINE;
      p.yieldCap[row] = 150;
      p.envelope[row] = 12;
      pushRev(p, row, 0, 100, 10);
      const r = revisionRatio({ edges: [0.5, 2], probs: [1] }, drawOn(stream, P.REV_RATIO, stage));
      const next = Math.min(Math.max(1, Math.round(r * 100)), 150);
      let s = Math.max(1, Math.round((10 * next) / 100));
      if (next > 100) s = Math.min(s, Math.max(10, 12));
      const did = reviseOnEntry(w, row, stage, 400, f);
      expect(did).toBe(next !== 100);
      if (did) {
        changed++;
        expect(revisionsOf(p, row, 400).at(-1)).toEqual({ day: 400, units: next, stories: s });
      } else expect(revisionsOf(p, row, 400)).toHaveLength(1);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('revises within the same construction type', () => {
    const f = withRevision(1, [0.5, 2], [1]);
    const t = input.options;
    const p0 = input.parcels;
    // A hostable lot whose allowed options hold one type at three or more home counts.
    let lot = -1;
    let n = 0;
    let type = -1;
    for (let i = 0; i < p0.count && lot < 0; i++) {
      if (p0.hostable[i] !== 1) continue;
      const allowed = allowedCount(t, i, p0.envelopeStories[i]);
      for (const ty of [0, 1, 2]) {
        const homes = new Set<number>();
        for (let k = 0; k < allowed; k++)
          if (t.type[t.offset[i] + k] === ty) homes.add(t.homes[t.offset[i] + k]);
        if (homes.size >= 3) {
          lot = i;
          n = allowed;
          type = ty;
          break;
        }
      }
    }
    expect(lot).toBeGreaterThanOrEqual(0);
    const from = t.offset[lot];
    const same: number[] = [];
    for (let k = 0; k < n; k++) if (t.type[from + k] === type) same.push(k);
    const start = same[Math.floor(same.length / 2)];
    const existing = 0;
    const most = Math.max(...same.map((k) => t.homes[from + k]));
    let changed = 0;
    for (const stream of streams) {
      const { w, row } = rowOn(0, stream);
      const p = w.projects;
      p.rule[row] = RULE_SIM;
      p.src[row] = lot;
      p.level[row] = start;
      p.btype[row] = type;
      p.optCap[row] = NULL_CAP;
      p.existing[row] = existing;
      p.env[row] = p0.envelopeStories[lot];
      const units = t.homes[from + start];
      p.units[row] = units;
      pushRev(p, row, 0, units, t.stories[from + start]);
      const r = revisionRatio({ edges: [0.5, 2], probs: [1] }, drawOn(stream, P.REV_RATIO, stage));
      const next = Math.min(most, Math.max(existing + 1, Math.round(r * units)));
      // the same-type option with the fewest homes that holds them
      let k = -1;
      for (const s of same)
        if (t.homes[from + s] >= next && (k < 0 || t.homes[from + s] < t.homes[from + k])) k = s;
      const did = reviseOnEntry(w, row, stage, 400, f);
      expect(did).toBe(next !== units);
      if (!did) continue;
      changed++;
      expect(revisionsOf(p, row, 400).at(-1)).toEqual({
        day: 400,
        units: next,
        stories: t.stories[from + k]
      });
      expect(p.level[row]).toBe(k);
      expect(p.btype[row]).toBe(type);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('throws on a row with no base revision entry', () => {
    const f = withRevision(1, [0.5, 2], [1]);
    const bare = rowOn(0, streams[0]);
    bare.w.projects.rule[bare.row] = RULE_PIPELINE;
    expect(() => reviseOnEntry(bare.w, bare.row, stage, 400, f)).toThrow(/base revision/);
  });

  it('none from construction on, none for RULE_NONE, none without an entry for the stage', () => {
    const f = withRevision(1, [0.5, 2], [1]);
    const none = rowOn(0, streams[0]);
    none.w.projects.rule[none.row] = RULE_NONE;
    pushRev(none.w.projects, none.row, 0, 100, null);
    expect(reviseOnEntry(none.w, none.row, stage, 400, f)).toBe(false);
    const late = rowOn(0, streams[0]);
    late.w.projects.rule[late.row] = RULE_PIPELINE;
    pushRev(late.w.projects, late.row, 0, 100, null);
    const cons = STAGE_ORDER.indexOf('construction');
    const g = {
      ...f,
      calibration: {
        ...f.calibration,
        revision: {
          ...f.calibration.revision,
          at: [
            { stage: 'construction' as const, probability: 1, ratio: { edges: [2, 3], probs: [1] } }
          ]
        }
      }
    };
    expect(reviseOnEntry(late.w, late.row, cons, 400, g)).toBe(false);
    expect(reviseOnEntry(late.w, late.row, stage - 1, 400, f)).toBe(false);
    expect(revisionsOf(late.w.projects, late.row, 400)).toHaveLength(1);
  });
});

describe('heightMultiplier', () => {
  const ht = input.calibration.heightTime!;
  const asOf = input.asOf;
  const D = asOf + 400;
  const later = structuredClone(ht.steps[0].value);
  later.construction = later.construction.map((x) => x * 1.5);
  const htTwoSteps = { ...ht, steps: [ht.steps[0], { from: D, value: later }] };
  const band30 = ht.upTo.findIndex((u) => 30 <= u);

  it('lengthens construction by the band multiplier and leaves NaN stories at 1', () => {
    expect(heightMultiplier(ht, 'construction', 30, asOf)).toBe(
      ht.steps[0].value.construction[band30]
    );
    expect(heightMultiplier(ht, 'construction', NaN, asOf)).toBe(1);
    expect(heightMultiplier(undefined, 'construction', 30, asOf)).toBe(1);
    expect(heightMultiplier(htTwoSteps, 'construction', 30, D - 1)).toBe(
      htTwoSteps.steps[0].value.construction[band30]
    );
    expect(heightMultiplier(htTwoSteps, 'construction', 30, D)).toBe(
      htTwoSteps.steps[1].value.construction[band30]
    );
  });

  it('reads the permit stage and is 1 for every other stage', () => {
    expect(heightMultiplier(ht, 'permitIssued', 3, asOf)).toBe(
      ht.steps[0].value.permitIssued[ht.upTo.findIndex((u) => 3 <= u)]
    );
    expect(heightMultiplier(ht, 'filed', 30, asOf)).toBe(1);
  });

  it('enterStage multiplies the drawn length of a row with known stories', () => {
    const pathway = PATHWAYS.findIndex(
      (p) => frame.calibration.transitions[p].construction !== undefined
    );
    const stage = STAGE_ORDER.indexOf('construction');
    const plain = rowOn(pathway, streams[3], { certain: true });
    enterStage(plain.w, plain.row, stage, 100, 0, frame);
    const tall = rowOn(pathway, streams[3], { certain: true });
    tall.w.projects.stories[tall.row] = 30;
    pushRev(tall.w.projects, tall.row, 50, 100, 30);
    enterStage(tall.w, tall.row, stage, 100, 0, frame);
    expect(tall.w.projects.length[tall.row]).toBeCloseTo(
      plain.w.projects.length[plain.row] * heightMultiplier(ht, 'construction', 30, 100),
      9
    );
  });
});
