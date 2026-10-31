/**
 * Reconcile a loaded policy's permitting timelines with the calibration it will run on (plan 5,
 * Call 7). Presets are re-resolved by their rule, custom edits are clamped to the stage bounds,
 * and what changed is reported. It never rejects a document. Pure TS: the server imports it.
 *
 * Unchanged sets keep their object identity, and so does the whole timing, so reconciling twice
 * is a no-op and a reload does not nag.
 */
import { typicalMonths } from '$lib/timelapse/model';
import type { Calibration, Pathway } from '$lib/timelapse/types';
import type { TimedStage, TimerEdit } from '$lib/sim/levers/types';
import {
  EDITABLE_STAGES,
  PRESETS,
  STAGE_LABELS,
  resolvePreset,
  setStageMonths,
  stageBounds,
  type PresetId,
  type SimTiming,
  type TimingSet
} from './timing';

export type TimingChange =
  | { set: 'current' | 'saved'; kind: 'preset-unavailable'; preset: PresetId }
  | { set: 'current' | 'saved'; kind: 'preset-refit'; preset: PresetId }
  | { set: 'current' | 'saved'; kind: 'edit-dropped'; pathway: Pathway; stage: TimedStage }
  | {
      set: 'current' | 'saved';
      kind: 'edit-clamped';
      pathway: Pathway;
      stage: TimedStage;
      months: number;
      bound: 'min' | 'max';
    };

const EPS = 1e-9;

// The same names the timeline UI shows (PermittingSection and RouteTimeline keep theirs local).
const ROUTE_NAMES: Record<Pathway, string> = {
  discretionary: 'Discretionary',
  streamlined: 'Streamlined',
  permitOnly: 'Permit only'
};

const typicalCache = new WeakMap<Calibration, ReturnType<typeof typicalMonths>>();
function typical0(cal: Calibration): ReturnType<typeof typicalMonths> {
  let t = typicalCache.get(cal);
  if (t === undefined) {
    t = typicalMonths(cal);
    typicalCache.set(cal, t);
  }
  return t;
}

const presetName = (id: PresetId) => PRESETS.find((p) => p.id === id)!.name;

function sameTimers(a: readonly TimerEdit[], b: readonly TimerEdit[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (t, i) =>
        t.pathway === b[i].pathway &&
        t.stage === b[i].stage &&
        t.reach === b[i].reach &&
        Math.abs(t.scale - b[i].scale) <= EPS
    )
  );
}

function sameShares(a: TimingSet['presetRouteShares'], b: TimingSet['presetRouteShares']) {
  if (a === null || b === null) return a === b;
  return (['discretionary', 'streamlined', 'permitOnly'] as const).every((p) => a[p] === b[p]);
}

function reconcileSet(
  set: TimingSet,
  cal: Calibration,
  which: 'current' | 'saved',
  changes: TimingChange[]
): TimingSet {
  // 1. A preset that is no longer available becomes observed.
  const available = PRESETS.find((p) => p.id === set.preset)?.available ?? false;
  const preset: PresetId = available ? set.preset : 'observed';
  if (!available) changes.push({ set: which, kind: 'preset-unavailable', preset: set.preset });

  // 2. Replace the preset layer when it differs from the rule's result.
  const fresh = resolvePreset(preset, cal);
  const layerSame =
    sameTimers(set.presetTimers, fresh.presetTimers) &&
    sameShares(set.presetRouteShares, fresh.presetRouteShares) &&
    set.localProgramStreamlined === fresh.localProgramStreamlined;
  if (!layerSame && available) changes.push({ set: which, kind: 'preset-refit', preset });
  const base: TimingSet = layerSame
    ? { ...set, preset }
    : {
        ...set,
        preset,
        presetTimers: fresh.presetTimers,
        presetRouteShares: fresh.presetRouteShares,
        localProgramStreamlined: fresh.localProgramStreamlined
      };

  // 3 and 4. Drop edits on stages with no table; pass the rest through setStageMonths.
  const t0 = typical0(cal);
  const edits: TimerEdit[] = [];
  for (const e of set.edits) {
    const typical = t0[e.pathway][e.stage];
    if (typical === undefined || !EDITABLE_STAGES.includes(e.stage)) {
      changes.push({ set: which, kind: 'edit-dropped', pathway: e.pathway, stage: e.stage });
      continue;
    }
    const alone: TimingSet = { ...base, edits: [] };
    const { set: out, clamped } = setStageMonths(cal, alone, e.pathway, e.stage, e.scale * typical);
    if (clamped !== null) {
      const b = stageBounds(cal, alone, e.pathway, e.stage);
      changes.push({
        set: which,
        kind: 'edit-clamped',
        pathway: e.pathway,
        stage: e.stage,
        months: clamped === 'min' ? b.min : b.max,
        bound: clamped
      });
    }
    const next = out.edits[0]; // undefined: the edit now equals the preset's months
    if (next === undefined) continue;
    edits.push(Math.abs(next.scale - e.scale) <= EPS && next.reach === e.reach ? e : next);
  }

  // 5. Custom route shares are kept as they are.
  const editsSame = edits.length === set.edits.length && edits.every((e, i) => e === set.edits[i]);
  if (layerSame && preset === set.preset && editsSame) return set;
  return { ...base, edits };
}

export function reconcileTiming(
  t: SimTiming,
  cal: Calibration
): { timing: SimTiming; changes: TimingChange[] } {
  const changes: TimingChange[] = [];
  const current = reconcileSet(t.current, cal, 'current', changes);
  const savedSet = t.saved === null ? null : reconcileSet(t.saved.set, cal, 'saved', changes);
  const saved =
    t.saved === null || savedSet === t.saved.set ? t.saved : { ...t.saved, set: savedSet! };
  if (current === t.current && saved === t.saved) return { timing: t, changes };
  return { timing: { current, saved }, changes };
}

export function changeText(c: TimingChange): string {
  switch (c.kind) {
    case 'preset-unavailable':
      return `SF as observed is used: ${presetName(c.preset)} is no longer offered`;
    case 'preset-refit':
      return `${presetName(c.preset)} was re-computed for this data`;
    case 'edit-dropped':
      return (
        `${STAGE_LABELS[c.stage]}, ${ROUTE_NAMES[c.pathway]}: removed ` +
        '(this route has no such stage in this data)'
      );
    case 'edit-clamped':
      return (
        `${STAGE_LABELS[c.stage]}, ${ROUTE_NAMES[c.pathway]}: ` +
        (c.bound === 'min' ? 'raised to the minimum' : 'lowered to the maximum') +
        `, ${c.months} months`
      );
  }
}
