import { describe, expect, it } from 'vitest';
import { STOP_TYPES } from '$lib/sim/levers/brushes';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { applyGrant, GAME_TRANSIT_ID } from '../grant';
import { limitsOf } from '../limits';
import { NEW_GAME } from '../state';
import { buy } from '../tree';
import { NODES } from './nodes';
import { buyAndApply, fullTree, type Played } from './play';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};

const MEASURES = [
  'housing-bond',
  'general-revenue',
  'revolving-fund',
  'public-bank',
  'federal-support',
  'state-double'
];

describe('buyAndApply', () => {
  it('buyAndApply returns null when buy refuses', () => {
    const p: Played = { state: NEW_GAME, doc: DEFAULT_POLICY4 };
    expect(buy(p.state, 'benchmark-permits')).toMatchObject({ ok: false, reason: 'hidden' });
    expect(buyAndApply(p, 'benchmark-permits', cal)).toBeNull();
    expect(buy(p.state, 'sb423-clock')).toMatchObject({ ok: false, reason: 'short' });
    expect(buyAndApply(p, 'sb423-clock', cal)).toBeNull();
  });

  it('buyAndApply returns the bought state and the document granted under the new limits', () => {
    const p: Played = {
      state: { ...NEW_GAME, units: { home: Number.MAX_SAFE_INTEGER } },
      doc: DEFAULT_POLICY4
    };
    for (const id of ['sb423-clock', 'stop-rail', 'housing-bond']) {
      const r = buy(p.state, id);
      if (!r.ok) throw new Error(`${id} was refused`);
      const out = buyAndApply(p, id, cal);
      expect(out).not.toBeNull();
      expect(out!.state).toEqual(r.state);
      expect(out!.doc).toEqual(applyGrant(p.doc, r.grant, { cal, limits: limitsOf(r.state) }));
      expect(out!.doc).not.toEqual(p.doc);
    }
  });
});

describe('fullTree', () => {
  it('fullTree holds the three presets, the six measures and one full transit rule', () => {
    const { doc } = fullTree(cal);
    expect(doc.kinds.permitting.map((p) => p.preset).sort()).toEqual([
      'benchmarkPermits',
      'noDiscretionary',
      'sb423Clock'
    ]);
    expect(new Set(doc.kinds.money.map((p) => p.preset))).toEqual(new Set(MEASURES));
    expect(doc.kinds.zoning).toHaveLength(1);
    const rule = doc.kinds.zoning[0];
    expect(rule.id).toBe(GAME_TRANSIT_ID);
    expect(rule.where).toEqual({ tag: 'transit', stopTypes: [...STOP_TYPES] });
    expect(rule.spans).toHaveLength(1);
    const what = rule.spans[0].what;
    if (what.tag !== 'bands') throw new Error('expected a bands span');
    expect(what.bands).toHaveLength(3);
    expect(what.bands.every((b) => b.stories === 80)).toBe(true);
    expect(Math.max(...what.bands.map((b) => b.maxM))).toBe(3219);
  });

  it('fullTree throws naming the node it cannot buy', () => {
    const nodes = [{ ...NODES[0], id: 'orphan', after: ['missing'] }];
    expect(() => fullTree(cal, nodes)).toThrow('full tree: orphan level 1 was refused');
  });
});
