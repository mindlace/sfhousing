import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { parsePlanFile, type LessCarsPlanFile } from '$lib/data/lesscars/codec';
import V1_PLAN from '$lib/data/lesscars/fixtures/v1/plan.json';
import { LESSCARS_HORIZON } from '$lib/data/lesscars/schedule';
import { parseManifest } from '$lib/data/manifest';
import { LC_ROADS_SOURCE_LAYER, buildStyle } from '$lib/map/style';
import { toExpressionFilter } from '$lib/map/filter-expr';
import { readFileSync } from 'node:fs';
import { cloneLayerIds, installBasemapHide, removedProjects } from './basemap-hide';

const manifest = parseManifest(
  JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8'))
);
const style = buildStyle(manifest, 'light');

const v1PlanFile = parsePlanFile(V1_PLAN);
/** The v1 plan with a split phase for its highway truncation (as a v1.1 build writes). */
const planFile: LessCarsPlanFile = {
  ...v1PlanFile,
  basemapHide: [{ projectId: 'hwy', ids: [35184564641330] }]
};
const openDay = (id: string) => planFile.times.find((t) => t.id === id)!.openDay;

function fakeMap() {
  const setFilter = vi.fn<(id: string, filter: unknown) => MapLibreMap>(() => ({}) as MapLibreMap);
  const m = { getStyle: () => style, setFilter };
  return m as typeof m & Pick<MapLibreMap, 'getStyle' | 'setFilter'>;
}

describe('basemap hide', () => {
  it('the clones are the roads_lc layers of the protomaps source', () => {
    const ids = cloneLayerIds(style);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.endsWith('__lc')).toBe(true);
      const l = style.layers.find((x) => x.id === id) as { 'source-layer'?: string };
      expect(l['source-layer']).toBe(LC_ROADS_SOURCE_LAYER);
    }
  });

  it('a plan file with no basemap ids hides nothing and sets no filter', () => {
    const map = fakeMap();
    expect(removedProjects(v1PlanFile, LESSCARS_HORIZON)).toEqual([]);
    installBasemapHide(map, v1PlanFile, LESSCARS_HORIZON).setDay(LESSCARS_HORIZON);
    expect(map.setFilter).not.toHaveBeenCalled();
  });

  it('a clone stops drawing a project’s features from its open day', () => {
    expect(removedProjects(planFile, openDay('hwy') - 1)).toEqual([]);
    expect(removedProjects(planFile, openDay('hwy'))).toEqual(['hwy']);
  });

  it('filters every clone with its own filter and the removed projects from the open day', () => {
    const map = fakeMap();
    const h = installBasemapHide(map, planFile, openDay('hwy') - 1);
    expect(map.setFilter).not.toHaveBeenCalled();
    h.setDay(openDay('hwy'));
    const ids = cloneLayerIds(style);
    expect(map.setFilter).toHaveBeenCalledTimes(ids.length);
    for (const id of ids) {
      const own = (style.layers.find((l) => l.id === id) as { filter?: unknown }).filter;
      expect(map.setFilter).toHaveBeenCalledWith(id, [
        'all',
        toExpressionFilter(own),
        ['!', ['in', ['get', 'lc_project'], ['literal', ['hwy']]]]
      ]);
    }
  });

  it('sets filters only when the removed set changes, and restores them scrubbing back', () => {
    const map = fakeMap();
    const h = installBasemapHide(map, planFile, openDay('hwy'));
    const n = cloneLayerIds(style).length;
    expect(map.setFilter).toHaveBeenCalledTimes(n);
    h.setDay(openDay('hwy') + 30);
    expect(map.setFilter).toHaveBeenCalledTimes(n);
    h.setDay(openDay('hwy') - 1);
    expect(map.setFilter).toHaveBeenCalledTimes(2 * n);
    const id = cloneLayerIds(style)[0];
    const own = (style.layers.find((l) => l.id === id) as { filter?: unknown }).filter;
    expect(map.setFilter).toHaveBeenLastCalledWith(cloneLayerIds(style).at(-1), expect.anything());
    expect(map.setFilter.mock.calls.slice(n).find((c) => c[0] === id)![1]).toEqual(own);
  });
});
