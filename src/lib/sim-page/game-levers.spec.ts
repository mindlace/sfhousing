import { describe, expect, it } from 'vitest';
import { GAME_TRANSIT_ID } from '$lib/game/grant';
import { NEW_GAME } from '$lib/game/state';
import type { TreeNode } from '$lib/game/tree';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/world/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/world/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import {
  DEFAULT_POLICY4,
  type Policy,
  type PolicyKind,
  type SimPolicy4
} from '$lib/timeline/policy4';
import { policyOf, setOn } from '$lib/timeline/spans';
import { limitsWith } from '$lib/timeline/test/limits';
import { bandsInnermostFirst } from './policy';
import { nodeRefs, nodeSwitches, restoreNode, switchNodeDoc } from './game-levers';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const ctx = {
  cal,
  limits: limitsWith({
    stops: new Set(['regionalRail', 'metro']),
    bands: 1,
    stories: 8,
    reachM: 402
  })
};

const P = 'sb423Clock';
const M = 'housing-bond';
const price = { housing: 1 } as unknown as TreeNode['levels'][number]['price'];

function node(id: string, grants: TreeNode['levels'][number]['grant'][]): TreeNode {
  return {
    id,
    branch: 'zoning',
    label: id,
    line: '',
    after: [],
    ring: 0,
    levels: grants.map((grant) => ({ price, grant, step: '' })),
    source: null
  };
}

const presetNode = node('t-preset', [{ tag: 'preset', preset: P }]);
const measureNode = node('t-measure', [{ tag: 'measure', preset: M }]);
const stopNode = node('t-stop', [{ tag: 'stop', stop: 'metro' }]);
const storiesNode = node('t-stories', [
  { tag: 'stories', max: 6 },
  { tag: 'stories', max: 8 }
]);
const bandsNode = node('t-bands', [
  { tag: 'bands', max: 2 },
  { tag: 'bands', max: 3 }
]);
const handsNode = node('t-hands', [{ tag: 'hands', what: 'radius', value: 64 }]);

const policy = (id: string, preset: string | null, on = true): Policy => ({
  id,
  label: id,
  preset,
  on,
  where: { tag: 'routes' },
  spans: []
});

const withKind = (kind: PolicyKind, ...ps: Policy[]): SimPolicy4 => ({
  ...DEFAULT_POLICY4,
  kinds: { ...DEFAULT_POLICY4.kinds, [kind]: ps }
});

const twoPresetsAndOther = withKind(
  'permitting',
  policy('p1', P),
  policy('p2', 'other'),
  policy('p3', P)
);
const withPreset = withKind('permitting', policy('p1', P));
const withMeasure = withKind('money', policy('m1', M));
const withGameRule = withKind('zoning', {
  id: GAME_TRANSIT_ID,
  label: 'Transit rule',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: []
});

const innermostStories = (p: Policy): number | undefined => {
  const what = p.spans[0].what;
  return what.tag === 'bands' ? bandsInnermostFirst(what.bands)[0]?.stories : undefined;
};

describe('game-levers', () => {
  it('nodeRefs per grant tag, in list order, first span each', () => {
    expect(nodeRefs(twoPresetsAndOther, presetNode.levels[0].grant)).toEqual([
      { kind: 'permitting', id: 'p1', span: 0 },
      { kind: 'permitting', id: 'p3', span: 0 }
    ]);
    expect(nodeRefs(withMeasure, measureNode.levels[0].grant).map((r) => r.kind)).toEqual([
      'money'
    ]);
    for (const n of [stopNode, storiesNode])
      expect(nodeRefs(withGameRule, n.levels[0].grant)).toEqual([
        { kind: 'zoning', id: GAME_TRANSIT_ID, span: 0 }
      ]);
    expect(nodeRefs(withGameRule, handsNode.levels[0].grant)).toEqual([]);
  });

  it('restoreNode', () => {
    expect(restoreNode(withPreset, presetNode, 1, ctx)).toBe(withPreset);
    expect(
      nodeRefs(restoreNode(DEFAULT_POLICY4, presetNode, 1, ctx), presetNode.levels[0].grant)
    ).toHaveLength(1);
    const r = policyOf(
      restoreNode(DEFAULT_POLICY4, storiesNode, 2, ctx),
      'zoning',
      GAME_TRANSIT_ID
    )!;
    expect(r.where).toMatchObject({ tag: 'transit', stopTypes: ['regionalRail', 'metro'] });
    expect(innermostStories(r)).toBe(8);
    expect(restoreNode(DEFAULT_POLICY4, handsNode, 1, ctx)).toBe(DEFAULT_POLICY4);
  });

  it('restoreNode applies the levels bought, no more', () => {
    const more = { ...ctx, limits: { ...ctx.limits, bands: 3 } };
    const bandCount = (level: number) =>
      policyOf(restoreNode(DEFAULT_POLICY4, bandsNode, level, more), 'zoning', GAME_TRANSIT_ID)!
        .spans[0].what;
    const count = (w: ReturnType<typeof bandCount>) => (w.tag === 'bands' ? w.bands.length : -1);
    expect(count(bandCount(1))).toBe(2);
    expect(count(bandCount(2))).toBe(3);
    expect(restoreNode(DEFAULT_POLICY4, bandsNode, 0, more)).toBe(DEFAULT_POLICY4);
  });

  it('nodeSwitches lists bought nodes whose policy is there', () => {
    const s = {
      ...NEW_GAME,
      bought: { [presetNode.id]: 1, [handsNode.id]: 1, [measureNode.id]: 1 }
    };
    const nodes = [presetNode, handsNode, measureNode];
    expect(nodeSwitches(withPreset, s, nodes)).toEqual({ [presetNode.id]: true });
    expect(nodeSwitches(withPreset, { ...s, bought: {} }, nodes)).toEqual({});
    expect(nodeSwitches(setOn(withPreset, 'permitting', 'p1', false), s, nodes)).toEqual({
      [presetNode.id]: false
    });
  });

  it('switchNodeDoc switches every policy of the node; same doc when nothing changes', () => {
    const off = switchNodeDoc(withGameRule, stopNode, false);
    expect(policyOf(off, 'zoning', GAME_TRANSIT_ID)!.on).toBe(false);
    expect(switchNodeDoc(off, storiesNode, false)).toBe(off);
  });
});
