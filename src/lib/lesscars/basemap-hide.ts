// The /lesscars basemap hide (docs/dev/lesscars.md "Basemap ids"): the tiles step moved each split
// phase's freeway stretch into the basemap's `roads_lc` source layer, tagged `lc_project`, and
// every protomaps `roads` layer has a clone drawing it (src/lib/map/style.ts). From a project's
// open day the clones stop drawing its features. A plan file without `basemapHide` (dataset
// 2026-11-02-39fbf039) sets no filter, so the clones draw everything, as /sim and FZP do.
// Theme switches only set paint properties, so the filters survive them.
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { LessCarsPlanFile } from '$lib/data/lesscars/codec';
import { toExpressionFilter } from '$lib/map/filter-expr';
import { LC_ROADS_SOURCE_LAYER } from '$lib/map/style';
import type { Day } from '$lib/timelapse/time';

/**
 * The basemapHide projects whose openDay <= day (their roads_lc features stop drawing), sorted;
 * [] without the key.
 */
export function removedProjects(f: LessCarsPlanFile, day: Day): string[] {
  if (!f.basemapHide?.length) return [];
  const open = new Map(f.times.map((t) => [t.id, t.openDay]));
  const out = new Set<string>();
  for (const h of f.basemapHide) {
    const d = open.get(h.projectId);
    if (d !== undefined && d <= day) out.add(h.projectId);
  }
  return [...out].sort();
}

/** Every style layer on source 'protomaps' with source-layer roads_lc (the `__lc` clones). */
export function cloneLayerIds(style: Pick<StyleSpecification, 'layers'>): string[] {
  return style.layers
    .filter((l) => {
      const v = l as { source?: string; 'source-layer'?: string };
      return v.source === 'protomaps' && v['source-layer'] === LC_ROADS_SOURCE_LAYER;
    })
    .map((l) => l.id);
}

/**
 * Filters each `__lc` clone with `['all', own, ['!', ['in', ['get', 'lc_project'], ['literal',
 * removed]]]]` (own: its style filter as an expression), or back to its own filter when nothing is
 * removed. Sets filters only when the removed set changes; `day` is the page's current day.
 */
export function installBasemapHide(
  map: Pick<MapLibreMap, 'getStyle' | 'setFilter'>,
  f: LessCarsPlanFile,
  day: Day
): { setDay(day: Day): void } {
  if (!f.basemapHide?.length) return { setDay() {} };
  const style = map.getStyle();
  const clones = cloneLayerIds(style).map((id) => {
    const filter = (style.layers.find((l) => l.id === id) as { filter?: unknown }).filter;
    return { id, filter, own: toExpressionFilter(filter) };
  });
  // The style as built draws every clone unfiltered: nothing removed.
  let applied = '';
  const setDay = (d: Day) => {
    const removed = removedProjects(f, d);
    const key = removed.join('\n');
    if (key === applied) return;
    applied = key;
    for (const c of clones)
      map.setFilter(
        c.id,
        (removed.length === 0
          ? c.filter
          : [
              'all',
              c.own,
              ['!', ['in', ['get', 'lc_project'], ['literal', removed]]]
            ]) as Parameters<MapLibreMap['setFilter']>[1]
      );
  };
  setDay(day);
  return { setDay };
}
