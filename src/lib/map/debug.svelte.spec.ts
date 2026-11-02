// The e2e debug hook's synthetic limits take the theme SimMap resolved (its `theme` prop, else the
// system theme), which SimMap hands the hook as `theme`; /sim sets no prop, so a dark system gives
// the dark tokens.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { installDebug } from './debug';
import type { Theme } from './types';

describe('installDebug loadSyntheticLimits', () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const theme of ['light', 'dark'] as Theme[]) {
    it(`draws sim-height-limits in the resolved theme (${theme})`, async () => {
      vi.stubEnv('VITE_E2E', '1');
      const setOverlayLayers = vi.fn<(l: Layer[]) => void>();
      const uninstall = installDebug(
        () => ({ map: null, controller: null, timeline: null, pendingGenerated: 0, theme }),
        {
          applyTimeline: vi.fn(),
          setTime: vi.fn(),
          setTimelineLookups: vi.fn(),
          setOverlayLayers
        }
      );
      try {
        const counts = await window.__sfhMap!.loadSyntheticLimits(1);
        expect(counts.rimPaths).toBeGreaterThan(10_000);
        const layer = setOverlayLayers.mock.calls[0][0][0] as Layer<{ theme: Theme }>;
        expect(layer.id).toBe('sim-height-limits');
        expect(layer.props.theme).toBe(theme);
      } finally {
        uninstall();
      }
    }, 60_000);
  }
});
