import { describe, expect, it } from 'vitest';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { TOKENS, timelineTokenCss } from '$lib/map/palette';
import { TYPOLOGY_ORDER } from '$lib/map/types';
import { HALO_TOKEN } from '$lib/map/timelapse/halos';
import { CITY_KIND_TOKEN } from '$lib/map/timelapse/city';
import { AREA_SWATCH, EDGE_SWATCH } from '$lib/timeline/SimKey.svelte';
import { STAGE_KEY, TYPE_KEY } from './rows';

const prop = (name: string) => `--map-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;

describe('STAGE_KEY', () => {
  it('STAGE_KEY covers every open stage exactly once', () => {
    const open = STAGE_ORDER.filter((s) => s !== 'complete');
    const summed = STAGE_KEY.flatMap((r) => r.stages);
    expect([...summed].sort()).toEqual([...open].sort());
    expect(new Set(summed).size).toBe(summed.length);
    expect(STAGE_KEY.map((r) => r.id)).toEqual([
      'planning',
      'approved',
      'issued',
      'building',
      'completed',
      'stopped'
    ]);
    expect(STAGE_KEY.map((r) => r.label)).toEqual([
      'Planning review',
      'Approved',
      'Permit issued',
      'Building',
      'Completed',
      'Stopped'
    ]);
    expect(STAGE_KEY.find((r) => r.id === 'completed')!.stages).toEqual([]);
    expect(STAGE_KEY.find((r) => r.id === 'stopped')!.stages).toEqual([]);
  });

  it('every STAGE_KEY and TYPE_KEY token resolves in timelineTokenCss, light and dark', () => {
    const css = timelineTokenCss('.x');
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    const tokens = [...STAGE_KEY.flatMap((r) => r.swatch.tokens), ...TYPE_KEY.map((t) => t.token)];
    expect(tokens.length).toBeGreaterThan(10);
    for (const t of tokens) {
      expect(light, `${t} light`).toContain(`${prop(t)}: ${TOKENS.light[t]}`);
      expect(dark, `${t} dark`).toContain(`${prop(t)}: ${TOKENS.dark[t]}`);
    }
  });

  it('the area and edge swatch kinds draw from tokens that exist in both themes', () => {
    const css = timelineTokenCss('.x');
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    // The city layer's own tones (CITY_KIND_TOKEN): the halo tones and the policy accent.
    const tones = [
      HALO_TOKEN.approved,
      HALO_TOKEN.started,
      HALO_TOKEN.completed,
      'tl-halo-policy'
    ] as const;
    expect(tones).toEqual(CITY_KIND_TOKEN);
    expect(AREA_SWATCH).toEqual({ kind: 'area', tokens: tones });
    expect(EDGE_SWATCH).toEqual({ kind: 'edge', tokens: tones });
    for (const t of tones) {
      expect(light, `${t} light`).toContain(`${prop(t)}: ${TOKENS.light[t]}`);
      expect(dark, `${t} dark`).toContain(`${prop(t)}: ${TOKENS.dark[t]}`);
    }
  });
});

describe('TYPE_KEY', () => {
  it("lists the building types in TYPOLOGY_ORDER with the tooltip's words", () => {
    expect(TYPE_KEY.map((t) => t.typology)).toEqual([...TYPOLOGY_ORDER]);
    expect(TYPE_KEY.map((t) => t.label)).toEqual([
      'ADU',
      'House or plex',
      'Walk-up',
      '5-over-1',
      'Mid-rise',
      'Tower'
    ]);
    expect(TYPE_KEY.map((t) => t.token)).toEqual(TYPOLOGY_ORDER.map((t) => `gen-${t}`));
  });
});
