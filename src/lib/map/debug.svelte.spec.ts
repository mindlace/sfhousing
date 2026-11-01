// The e2e debug hook's synthetic fog takes the theme SimMap resolved (its `theme` prop, else the
// system theme), which SimMap hands the hook as `theme`; /sim sets no prop, so a dark system gives
// the dark token.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { installDebug } from './debug';
import { TOKENS, hexToRgba } from './palette';
import type { Theme } from './types';

describe('installDebug loadSyntheticFog', () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const theme of ['light', 'dark'] as Theme[]) {
    it(`draws the fog in the resolved theme (${theme})`, async () => {
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
        await window.__sfhMap!.loadSyntheticFog(1);
        const layer = setOverlayLayers.mock.calls[0][0][0] as Layer<{ color: number[] }>;
        expect(layer.props.color).toEqual(hexToRgba(TOKENS[theme]['height-fog']));
      } finally {
        uninstall();
      }
    });
  }
});
