// The /lesscars map key: one row per street state (map-key order) and per mark, with the token and
// pattern the map draws it in, so the key never says something the map does not show.
import type { TokenName } from '$lib/map/palette';
import { STREET_STATES, type StreetState } from './features';
import { STREET_STYLE } from './map-layers';

export interface LegendRow {
  id: string;
  label: string;
  token: TokenName;
  kind: 'line' | 'disc' | 'square' | 'fill';
  /** Dash pattern in line widths (MapLibre `line-dasharray`), null when solid. */
  dash: number[] | null;
}

const STREET_LABEL: Record<StreetState, string> = {
  works: 'Works under way',
  transit: 'Buses and trams only',
  bike: 'Bike lanes',
  pedestrian: 'Pedestrian street',
  removed: 'Removed: now land',
  grade: 'Underpass filled'
};

export const LESSCARS_LEGEND: readonly LegendRow[] = [
  ...STREET_STATES.map((s): LegendRow => ({
    id: `street-${s}`,
    label: STREET_LABEL[s],
    token: `lc-${s}`,
    kind: 'line',
    dash: STREET_STYLE[s].dash
  })),
  { id: 'line-subway', label: 'New subway', token: 'lc-line-subway', kind: 'line', dash: null },
  { id: 'line-tram', label: 'New tram', token: 'lc-line-tram', kind: 'line', dash: null },
  { id: 'line-brt', label: 'New rapid bus', token: 'lc-line-brt', kind: 'line', dash: null },
  { id: 'shuttle', label: 'Car shuttle', token: 'lc-shuttle', kind: 'line', dash: null },
  { id: 'stop', label: 'Plan stop', token: 'label', kind: 'disc', dash: null },
  { id: 'garage', label: 'Edge garage', token: 'lc-garage', kind: 'square', dash: null },
  { id: 'site', label: 'Freed land', token: 'lc-site', kind: 'fill', dash: null }
];
