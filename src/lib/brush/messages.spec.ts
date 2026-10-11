import { describe, expect, it } from 'vitest';
import type { OpStats } from '$lib/sim/protocol';
import type { PlanOp } from '$lib/plan';
import {
  ANNOUNCE_MS,
  MSG,
  TOO_LARGE_MS,
  radiusValueText,
  strokeMessage,
  undoMessage
} from './messages';

const base: OpStats = {
  opId: 'x',
  kind: 'paint',
  stories: 6,
  covered: 143,
  ineligible: 0,
  built: 97,
  notBigger: 46,
  removed: 0,
  partial: false
};

describe('strokeMessage', () => {
  it('formats paint', () => {
    expect(strokeMessage(base)).toBe(
      'Painted 6 stories on 143 parcels · 97 new buildings · 46 already as big or bigger'
    );
  });
  it('uses singulars', () => {
    expect(strokeMessage({ ...base, stories: 1, covered: 1, built: 1, notBigger: 0 })).toBe(
      'Painted 1 story on 1 parcel · 1 new building · 0 already as big or bigger'
    );
  });
  it('groups thousands', () => {
    expect(strokeMessage({ ...base, covered: 1234, built: 1000 })).toContain(
      'on 1,234 parcels · 1,000 new buildings'
    );
  });
  it('formats erase', () => {
    expect(strokeMessage({ ...base, kind: 'erase', stories: undefined, removed: 97 })).toBe(
      'Erased 143 parcels · 97 generated buildings removed'
    );
    expect(strokeMessage({ ...base, kind: 'erase', covered: 1, removed: 1 })).toBe(
      'Erased 1 parcel · 1 generated building removed'
    );
  });
  it('appends ineligible and partial suffixes', () => {
    expect(strokeMessage({ ...base, ineligible: 12, partial: true })).toBe(
      'Painted 6 stories on 143 parcels · 97 new buildings · 46 already as big or bigger' +
        ' · 12 not eligible (open space or unmapped lots) · some areas still loading'
    );
  });
  it('handles nothing covered', () => {
    expect(strokeMessage({ ...base, covered: 0 })).toBe('No parcels under that stroke');
    expect(strokeMessage({ ...base, covered: 0, ineligible: 1234 })).toBe(
      'No eligible parcels under that stroke · 1,234 not eligible (open space or unmapped lots)'
    );
    expect(strokeMessage({ ...base, covered: 0, partial: true })).toBe(
      'No parcels under that stroke · some areas still loading'
    );
  });
});

describe('undoMessage', () => {
  const paint: PlanOp = { kind: 'paint', stories: 6, radiusM: 30, path: [[0, 0]], id: 'a' };
  const erase: PlanOp = { kind: 'erase', radiusM: 30, path: [[0, 0]], id: 'b' };
  it('describes ops', () => {
    expect(undoMessage(paint, 'Undid')).toBe('Undid paint, 6 stories');
    expect(undoMessage(erase, 'Undid')).toBe('Undid erase');
    expect(undoMessage({ ...paint, stories: 1 }, 'Redid')).toBe('Redid paint, 1 story');
  });
});

describe('constants', () => {
  it('has verbatim copy', () => {
    expect(MSG.loadingCity).toBe('Loading city data…');
    expect(MSG.cityFailed).toBe("Couldn't load city data.");
    expect(MSG.loadingParcels).toBe('Loading parcels…');
    expect(MSG.zoomIn).toBe('Zoom in to see the brush');
    expect(MSG.readOnly).toBe('Read-only — Remix to edit');
    expect(MSG.eraseHint).toBe('Erase removes painted height');
    expect(MSG.tooLarge).toBe(
      'This stroke would make the plan too large to save (256 KB limit). Undo some strokes or start a new plan.'
    );
    expect(MSG.mapLabel).toBe(
      'Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair.'
    );
    expect(ANNOUNCE_MS).toBe(4000);
    expect(TOO_LARGE_MS).toBe(6000);
  });
  it('formats radius value text', () => {
    expect(radiusValueText(30)).toBe('Brush radius 30 metres');
  });
});
