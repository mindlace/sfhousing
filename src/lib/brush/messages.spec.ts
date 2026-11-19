import { describe, expect, it } from 'vitest';
import type { OpStats } from '$lib/sim/protocol';
import type { PlanOp } from '$lib/plan';
import {
  ANNOUNCE_MS,
  MSG,
  TOO_LARGE_MS,
  radiusValueText,
  rowStepMessage,
  strokeMessage,
  undoMessage
} from './messages';

const base: OpStats = {
  opId: 'x',
  kind: 'paint',
  stories: 6,
  covered: 143,
  ineligible: 0,
  underwater: 0,
  built: 97,
  notBigger: 46,
  removed: 0,
  partial: false
};

describe('strokeMessage', () => {
  it('a paint stroke: stories on lots', () => {
    expect(strokeMessage(base)).toBe('6 stories on 143 lots');
    expect(strokeMessage({ ...base, stories: 1, covered: 1, built: 1, notBigger: 0 })).toBe(
      '1 story on 1 lot'
    );
    expect(strokeMessage({ ...base, covered: 1234, built: 1000 })).toBe('6 stories on 1,234 lots');
  });
  it('appends not eligible, in the Bay and still loading, in that order', () => {
    expect(
      strokeMessage({ ...base, covered: 42, ineligible: 3, underwater: 2, partial: true })
    ).toBe('6 stories on 42 lots · 3 not eligible · 2 in the Bay · still loading');
  });
  it('an erase', () => {
    expect(
      strokeMessage({ ...base, kind: 'erase', stories: undefined, covered: 42, removed: 97 })
    ).toBe('Erased 42 lots');
    expect(strokeMessage({ ...base, kind: 'erase', covered: 1, removed: 1, ineligible: 3 })).toBe(
      'Erased 1 lot · 3 not eligible'
    );
  });
  it('nothing under the stroke', () => {
    expect(strokeMessage({ ...base, covered: 0 })).toBe('No lots under that stroke');
    expect(strokeMessage({ ...base, covered: 0, ineligible: 3 })).toBe(
      'No eligible lots under that stroke · 3 not eligible'
    );
    expect(strokeMessage({ ...base, covered: 0, partial: true })).toBe(
      'No lots under that stroke · still loading'
    );
  });
  it('the refusal says what to do', () => {
    expect(MSG.tooLarge).toBe('Plan too large to save. Undo some strokes.');
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

describe('rowStepMessage', () => {
  it('names the removal being undone or redone', () => {
    const step = { label: 'Removed 8 stories' };
    expect(rowStepMessage(step, 'Undid')).toBe('Undid: Removed 8 stories');
    expect(rowStepMessage(step, 'Redid')).toBe('Redid: Removed 8 stories');
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
    expect(MSG.tooLarge).toBe('Plan too large to save. Undo some strokes.');
    expect(MSG.mapLabel).toBe(
      'Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair.'
    );
    expect(ANNOUNCE_MS).toBe(4000);
    expect(TOO_LARGE_MS).toBe(6000);
  });
  it('counts lots in the Bay apart from ineligible ones', () => {
    expect(
      strokeMessage({
        ...base,
        covered: 2,
        built: 1,
        notBigger: 1,
        ineligible: 1,
        underwater: 3,
        stories: 4
      })
    ).toBe('4 stories on 2 lots · 1 not eligible · 3 in the Bay');
  });
  it('says no eligible lots when the stroke is all water', () => {
    expect(strokeMessage({ ...base, covered: 0, built: 0, notBigger: 0, underwater: 2 })).toBe(
      'No eligible lots under that stroke · 2 in the Bay'
    );
  });
  it('formats radius value text', () => {
    expect(radiusValueText(30)).toBe('Brush radius 30 metres');
  });
});
