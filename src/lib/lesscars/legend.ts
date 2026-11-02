// The /lesscars map key: one row per street state (map-key order) and per mark, with the token and
// pattern the map draws it in, so the key never says something the map does not show. Rows within
// a group differ by dash, width or double stroke, never by colour alone (WCAG 1.4.1).
import type { TokenName } from '$lib/map/palette';
import { STREET_STATES, type LineProps, type StreetState } from './features';
import { LINE_STYLE, STREET_STYLE } from './map-layers';

export interface LegendRow {
  id: string;
  label: string;
  token: TokenName;
  kind: 'line' | 'disc' | 'square' | 'fill';
  /** Dash pattern in line widths (MapLibre `line-dasharray`), null when solid. */
  dash: number[] | null;
  /** Line width in px as the map draws it (a built line for plan lines); null for non-lines. */
  width: number | null;
  /** Gap between the two strokes of a double line in px (`line-gap-width`), 0 for one stroke. */
  gap: number;
  /** Drawn as two parallel strokes (gap > 0). */
  double: boolean;
}

const STREET_LABEL: Record<StreetState, string> = {
  works: 'Works under way',
  transit: 'Buses and trams only',
  bike: 'Bike lanes',
  pedestrian: 'Pedestrian street',
  removed: 'Removed: now land',
  grade: 'Underpass filled'
};

const mark = { dash: null, width: null, gap: 0, double: false } as const;
const planLine = (
  id: string,
  label: string,
  token: TokenName,
  mode: LineProps['mode']
): LegendRow => ({
  id,
  label,
  token,
  kind: 'line',
  dash: null,
  width: LINE_STYLE[mode].width,
  gap: 0,
  double: false
});

export const LESSCARS_LEGEND: readonly LegendRow[] = [
  ...STREET_STATES.map((s): LegendRow => ({
    id: `street-${s}`,
    label: STREET_LABEL[s],
    token: `lc-${s}`,
    kind: 'line',
    dash: STREET_STYLE[s].dash,
    width: STREET_STYLE[s].width,
    gap: STREET_STYLE[s].gap,
    double: STREET_STYLE[s].gap > 0
  })),
  planLine('line-subway', 'New subway', 'lc-line-subway', 'subway'),
  planLine('line-tram', 'New tram', 'lc-line-tram', 'tram'),
  planLine('line-brt', 'New rapid bus', 'lc-line-brt', 'brt'),
  planLine('shuttle', 'Car shuttle', 'lc-shuttle', 'shuttle'),
  { id: 'stop', label: 'Plan stop', token: 'label', kind: 'disc', ...mark },
  { id: 'garage', label: 'Edge garage', token: 'lc-garage', kind: 'square', ...mark },
  { id: 'site', label: 'Freed land', token: 'lc-site', kind: 'fill', ...mark }
];
