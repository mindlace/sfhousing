// ExtraChart colours per theme, chosen against the details panel's backgrounds (white in light,
// Tailwind gray-900 in dark). Text needs 4.5:1, the mean line, zero line and now marker 3:1.
import type { Theme } from '$lib/map/types';

export const PANEL_BG: Record<Theme, string> = { light: '#ffffff', dark: '#111827' };

export const CHART_COLORS: Record<
  Theme,
  { text: string; mean: string; band: string; zero: string; now: string; grid: string }
> = {
  light: {
    text: '#374151',
    mean: '#1d4ed8',
    band: '#2563eb',
    zero: '#6b7280',
    now: '#374151',
    grid: '#d1d5db'
  },
  dark: {
    text: '#d1d5db',
    mean: '#93c5fd',
    band: '#60a5fa',
    zero: '#9ca3af',
    now: '#e5e7eb',
    grid: '#4b5563'
  }
};
