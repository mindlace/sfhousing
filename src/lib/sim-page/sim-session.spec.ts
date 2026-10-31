// restoreSimDoc: the autosave restore's outcome, reconciled with the calibration, as the
// document SimPage loads and the notices it shows (plan 5, Task 5).
import { describe, expect, it } from 'vitest';
import { copyFor } from '$lib/sharing/copy';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import fixture0CalibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { DEFAULT_POLICY, type SimDoc } from './sim-doc';
import { FZP_KEPT_TEXT, TIMING_NOTICE_TEXT, restoreSimDoc } from './sim-session';
import { resolvePreset } from './timing';

const cal: Calibration = parseCalibration(structuredClone(fixture0CalibrationJson) as unknown);
const sim = copyFor('sim');

const doc = (over: Partial<SimDoc> = {}): SimDoc => ({
  schema: 1,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  policy: DEFAULT_POLICY,
  ...over
});

function sdDoc(): SimDoc {
  const current = resolvePreset('benchmarkPermits', cal);
  return doc({ policy: { ...DEFAULT_POLICY, timing: { current, saved: null } } });
}

describe('restoreSimDoc', () => {
  it('an unchanged restore gives no notices and the same document', () => {
    const d = sdDoc();
    const r = restoreSimDoc({ plan: d, notice: null }, cal);
    expect(r.notices).toEqual([]);
    expect(r.doc).toBe(d);
  });

  it('a rebased record gives the rebased notice (N3, policy copy)', () => {
    const r = restoreSimDoc(
      { plan: doc(), notice: { kind: 'rebased', from: 'fixture-old', to: 'fixture-0' } },
      cal
    );
    expect(r.notices).toEqual([
      { id: 'rebased', text: sim.n3('fixture-old', 'fixture-0'), tone: 'info' }
    ]);
    expect(r.notices[0].text).toContain('Your policy was made with an older map dataset');
  });

  it('corrupt and future records give the N1 and N2 policy notices', () => {
    const c = restoreSimDoc({ plan: doc(), notice: { kind: 'corrupt' } }, cal);
    expect(c.notices.map((n) => [n.id, n.text])).toEqual([['corrupt', sim.n1]]);
    expect(sim.n1).toContain('Your saved policy');
    const f = restoreSimDoc({ plan: doc(), notice: { kind: 'future' } }, cal);
    expect(f.notices.map((n) => [n.id, n.text])).toEqual([['future', sim.n2]]);
  });

  it('a tampered preset gives a timing notice listing the change, and the refit document', () => {
    const d = sdDoc();
    const tampered: SimDoc = {
      ...d,
      policy: {
        ...d.policy,
        timing: {
          current: {
            ...d.policy.timing.current,
            presetTimers: d.policy.timing.current.presetTimers.map((t) => ({ ...t, scale: 0.3 }))
          },
          saved: null
        }
      }
    };
    const r = restoreSimDoc({ plan: tampered, notice: null }, cal);
    expect(r.notices).toHaveLength(1);
    const n = r.notices[0];
    expect(n.id).toBe('timing');
    expect(n.text).toBe(TIMING_NOTICE_TEXT);
    expect(n.text).toBe(
      'Some permitting timelines were re-fit to the data this simulation runs on.'
    );
    expect(n.details).toContain("Permits at San Diego's pace was re-computed for this data");
    expect(r.doc.policy.timing.current.presetTimers).toEqual(
      resolvePreset('benchmarkPermits', cal).presetTimers
    );
    // Reconciling the result again changes nothing (a reload does not nag).
    expect(restoreSimDoc({ plan: r.doc, notice: null }, cal).notices).toEqual([]);
  });

  it('remixFrom adds the toast after the other notices', () => {
    const r = restoreSimDoc({ plan: doc(), notice: { kind: 'corrupt' } }, cal, 'SD permits');
    expect(r.notices.map((n) => n.id)).toEqual(['corrupt', 'remix']);
    expect(r.notices[1]).toEqual({
      id: 'remix',
      text: "Remixed from SD permits. You're editing your own copy.",
      tone: 'toast'
    });
  });

  it('a null calibration skips the reconcile and keeps the notices', () => {
    const d = sdDoc();
    const r = restoreSimDoc({ plan: d, notice: { kind: 'corrupt' } }, null);
    expect(r.doc).toBe(d);
    expect(r.notices.map((n) => n.id)).toEqual(['corrupt']);
  });

  it('the fzp-kept copy is Call 13', () => {
    expect(FZP_KEPT_TEXT).toBe(
      'Showing the Family Zoning Plan comparison. Your saved policy is kept until you change something here.'
    );
  });
});
