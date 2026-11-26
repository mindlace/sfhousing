import { describe, expect, it } from 'vitest';
import { fundingPresets } from '$lib/sim-page/funding-presets';
import { MAX_BANDS, BAND_MAX_M } from '$lib/sim-page/transit-edit';
import { PRESETS } from '$lib/sim-page/timing';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import { STOP_TYPES } from '$lib/sim/levers/brushes';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { BASE_HANDS } from '../limits';
import { NEW_GAME, type GameState } from '../state';
import { treeView, buy, levelOf, type Grant, type TreeNode } from '../tree';
import { CATALOGUE, NODES, STAGES, ringOf } from './nodes';
import { PRICES } from './tuning';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};

const grantsOf = <T extends Grant['tag']>(tag: T) =>
  NODES.flatMap((n) => n.levels.map((l) => l.grant)).filter(
    (g): g is Extract<Grant, { tag: T }> => g.tag === tag
  );

const node = (id: string): TreeNode => NODES.find((n) => n.id === id)!;

const rising = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('nodes', () => {
  it('ids are unique and every after id names a node listed earlier', () => {
    const seen = new Set<string>();
    for (const n of NODES) {
      for (const a of n.after) expect(seen.has(a)).toBe(true);
      expect(seen.has(n.id)).toBe(false);
      seen.add(n.id);
    }
    expect(NODES.length).toBe(23);
  });

  it('every stage 0 to 4 holds a node', () => {
    const stages = new Set(CATALOGUE.map((e) => e.stage));
    for (let s = 0; s <= STAGES; s++) expect(stages.has(s)).toBe(true);
  });

  it('ringOf: the stage on five rungs, 0 on one, rounds on two to four, the last rung for stage 4', () => {
    for (let s = 0; s <= 4; s++) {
      expect(ringOf(s, 5)).toBe(s);
      expect(ringOf(s, 1)).toBe(0);
    }
    expect(ringOf(1, 3)).toBe(1);
    expect(ringOf(1, 2)).toBe(0);
    expect(ringOf(2, 4)).toBe(2);
    for (let r = 1; r <= 5; r++) expect(ringOf(4, r)).toBe(r - 1);
    NODES.forEach((n, i) => expect(n.ring).toBe(ringOf(CATALOGUE[i].stage)));
  });

  it('each level is priced from PRICES in home only', () => {
    for (const n of NODES) {
      n.levels.forEach((l, k) => expect(l.price).toEqual({ home: PRICES[n.id][k] }));
    }
  });

  it('preset grants name available presets; measure grants name the six measures once each', () => {
    for (const g of grantsOf('preset')) {
      const p = PRESETS.find((x) => x.id === g.preset);
      expect(p?.available).toBe(true);
      expect(g.preset).not.toBe('observed');
      expect(g.preset).not.toBe('ceqaInfill');
    }
    expect(
      grantsOf('measure')
        .map((g) => g.preset)
        .sort()
    ).toEqual([
      'federal-support',
      'general-revenue',
      'housing-bond',
      'public-bank',
      'revolving-fund',
      'state-double'
    ]);
  });

  it('fundingPresets offers each measure under the label its node carries', () => {
    const offered = fundingPresets(cal);
    for (const n of NODES.filter((x) => x.branch === 'money')) {
      expect(offered.find((p) => p.id === n.id && p.available)!.label).toBe(n.label);
    }
  });

  it('preset and measure nodes have a source with text; zoning and hands nodes have none', () => {
    for (const n of NODES) {
      if (n.branch === 'permitting' || n.branch === 'money') {
        expect(n.source?.text.length).toBeGreaterThan(0);
      } else {
        expect(n.source).toBeNull();
      }
    }
    expect(node('federal-support').source?.href).toBeNull();
    expect(node('state-double').source?.href).toBeNull();
  });

  it('stories, reach and bands steps stay inside the editor', () => {
    const stories = ['taller-1', 'taller-2', 'taller-3'].flatMap((id) =>
      node(id).levels.map((l) => (l.grant.tag === 'stories' ? l.grant.max : NaN))
    );
    expect(stories.every(Number.isInteger)).toBe(true);
    expect(stories).toEqual([6, 8, 12, 20, 40, 80]);
    expect(rising(stories)).toBe(true);
    const reach = grantsOf('reach').map((g) => g.maxM);
    expect(reach).toEqual([805, 1609, 3219]);
    for (const m of reach) expect(m).toBeLessThanOrEqual(BAND_MAX_M);
    const bands = grantsOf('bands').map((g) => g.max);
    expect(bands).toEqual([2, 3]);
    for (const b of bands) expect(b).toBeLessThanOrEqual(MAX_BANDS);
  });

  it('each stop type has one node', () => {
    expect(
      grantsOf('stop')
        .map((g) => g.stop)
        .sort()
    ).toEqual([...STOP_TYPES].sort());
  });

  it('hands steps rise above BASE_HANDS and hands-auto is the last hands node', () => {
    const hands = grantsOf('hands');
    const radius = hands.flatMap((g) => (g.what === 'radius' ? [g.value] : []));
    const linger = hands.flatMap((g) => (g.what === 'linger' ? [g.value] : []));
    expect(rising(radius)).toBe(true);
    expect(radius[0]).toBeGreaterThan(BASE_HANDS.radiusPx);
    expect(rising(linger)).toBe(true);
    expect(linger[0]).toBeGreaterThan(BASE_HANDS.lingerMs);
    const handsNodes = NODES.filter((n) => n.branch === 'hands');
    expect(handsNodes[handsNodes.length - 1].id).toBe('hands-auto');
  });

  it('with unlimited units at the last rung, buying every ready level buys every level', () => {
    let s: GameState = {
      ...NEW_GAME,
      rung: Math.max(...NODES.map((n) => n.ring)),
      units: { home: Number.MAX_SAFE_INTEGER }
    };
    for (;;) {
      const ready = treeView(s).find((v) => v.state === 'ready');
      if (ready === undefined) break;
      const r = buy(s, ready.node.id);
      if (!r.ok) throw new Error('a ready node refused');
      s = r.state;
    }
    for (const n of NODES) expect(levelOf(s, n)).toBe(n.levels.length);
  });
});
