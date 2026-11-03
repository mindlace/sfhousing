/**
 * /sim's dock tabs (spec Goal 1): the editing face's Transit · Paint · Permits · Protect, in that
 * order. Plans 3 and 4 replace the Paint and Transit panels; the ids stay.
 */
import type { DockTab } from '$lib/dock/Dock.svelte';
import { DOCK_ICONS } from '$lib/dock/icons';

export type SimTabId = 'transit' | 'paint' | 'permits' | 'protect';

export const SIM_TABS: readonly DockTab[] = [
  { id: 'transit', label: 'Transit', icon: DOCK_ICONS.transit },
  { id: 'paint', label: 'Paint', icon: DOCK_ICONS.paint },
  { id: 'permits', label: 'Permits', icon: DOCK_ICONS.permits },
  { id: 'protect', label: 'Protect', icon: DOCK_ICONS.protect }
] satisfies readonly (DockTab & { id: SimTabId })[];

/** The view's (/s/<id>) one tab: the policy summary (plan 2, Task 6 restyles it). */
export const VIEW_TABS: readonly DockTab[] = [
  { id: 'policy', label: 'Policy', icon: DOCK_ICONS.policy }
];
