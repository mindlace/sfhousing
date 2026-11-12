/**
 * /sim's dock tabs (spec Goal 1): the editing face's Transit · Paint · Permits · Protect ·
 * Funding, in that order. Funding is last: money is the newest lever (funding-ui spec 4.3).
 */
import type { DockTab } from '$lib/dock/Dock.svelte';
import { DOCK_ICONS } from '$lib/dock/icons';
import type { Calibration } from '$lib/timelapse/types';

export type SimTabId = 'transit' | 'paint' | 'permits' | 'protect' | 'funding';

export const SIM_TABS: readonly DockTab[] = [
  { id: 'transit', label: 'Transit', icon: DOCK_ICONS.transit },
  { id: 'paint', label: 'Paint', icon: DOCK_ICONS.paint },
  { id: 'permits', label: 'Permits', icon: DOCK_ICONS.permits },
  { id: 'protect', label: 'Protect', icon: DOCK_ICONS.protect },
  { id: 'funding', label: 'Funding', icon: DOCK_ICONS.funding }
] satisfies readonly (DockTab & { id: SimTabId })[];

/**
 * The editing tabs, with no empty face: Permits needs a calibration; Funding needs one with both
 * `market` and `baselineFunding`, the condition on which the engine runs money at all.
 */
export function simTabs(calibration: Calibration | null): readonly DockTab[] {
  const funding = calibration?.market !== undefined && calibration.baselineFunding !== undefined;
  return SIM_TABS.filter(
    (t) => (t.id !== 'permits' || calibration !== null) && (t.id !== 'funding' || funding)
  );
}

/** `tab` if `tabs` offers it, else the first tab's id. */
export function tabOrFirst(tabs: readonly DockTab[], tab: string): string {
  return tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
}

/**
 * The view's (/s/<id>) one tab: the policy summary. Its rail button is named "Policy summary", so
 * it never shares the header Policy button's name.
 */
export const VIEW_TABS: readonly DockTab[] = [
  { id: 'policy', label: 'Policy', icon: DOCK_ICONS.policy, railLabel: 'Policy summary' }
];
