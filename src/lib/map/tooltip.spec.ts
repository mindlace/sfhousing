import { describe, expect, it } from 'vitest';
import { tooltipLines, typologyLabel, type TooltipHit } from './tooltip';
import type { TypologyId } from '$lib/generator';

const P = '3512008';
const gen = (typology: TypologyId, stories: number, units: number, existingUnits: number) =>
  ({ kind: 'generated', parcelId: P, typology, stories, units, existingUnits }) as TooltipHit;
const ex = (
  summary: { eligible: boolean; n: number; underwater?: boolean } | null,
  chunk: 'ready' | 'loading' | 'error' | 'unknown'
) =>
  ({
    kind: 'existing',
    parcelId: P,
    chunk,
    summary: summary && {
      parcelId: P,
      eligible: summary.eligible,
      ...(summary.underwater ? { underwater: true } : {}),
      existingUnits: summary.n,
      generated: null
    }
  }) as TooltipHit;

const cases: [string, TooltipHit, [string, string]][] = [
  [
    'midrise',
    gen('midrise', 8, 64, 3),
    [`Parcel ${P}`, 'Mid-rise · 8 stories · 64 units · replaces 3 (net +61)']
  ],
  ['adu', gen('adu', 1, 1, 2), [`Parcel ${P}`, 'ADU · adds 1 unit to 2 existing (net +1)']],
  [
    'house',
    gen('plex', 2, 1, 0),
    [`Parcel ${P}`, 'House · 2 stories · 1 unit · replaces 0 (net +1)']
  ],
  [
    'duplex',
    gen('plex', 2, 2, 1),
    [`Parcel ${P}`, 'Duplex · 2 stories · 2 units · replaces 1 (net +1)']
  ],
  [
    'plex3',
    gen('plex', 3, 3, 1),
    [`Parcel ${P}`, 'Plex · 3 stories · 3 units · replaces 1 (net +2)']
  ],
  [
    'plex4',
    gen('plex', 3, 4, 0),
    [`Parcel ${P}`, 'Plex · 3 stories · 4 units · replaces 0 (net +4)']
  ],
  [
    'tower',
    gen('tower', 40, 1234, 12),
    [`Parcel ${P}`, 'Tower · 40 stories · 1,234 units · replaces 12 (net +1,222)']
  ],
  [
    'walkup 1 story',
    gen('walkup', 1, 4, 1),
    [`Parcel ${P}`, 'Walk-up · 1 story · 4 units · replaces 1 (net +3)']
  ],
  [
    'podium',
    gen('podium', 6, 50, 2),
    [`Parcel ${P}`, '5-over-1 · 6 stories · 50 units · replaces 2 (net +48)']
  ],
  [
    'existing eligible',
    ex({ eligible: true, n: 3 }, 'ready'),
    [`Parcel ${P}`, 'Existing building · 3 units']
  ],
  [
    'existing 1 unit',
    ex({ eligible: true, n: 1 }, 'ready'),
    [`Parcel ${P}`, 'Existing building · 1 unit']
  ],
  [
    'existing ineligible',
    ex({ eligible: false, n: 4 }, 'ready'),
    [`Parcel ${P}`, 'Existing building · 4 units · not eligible for change']
  ],
  [
    'existing in the Bay',
    ex({ eligible: false, underwater: true, n: 0 }, 'ready'),
    [`Parcel ${P}`, 'Existing building · 0 units · in the Bay']
  ],
  ['loading', ex(null, 'loading'), [`Parcel ${P}`, 'Existing building · units loading…']],
  ['unknown', ex(null, 'unknown'), [`Parcel ${P}`, 'Existing building · units loading…']],
  ['ready no summary', ex(null, 'ready'), [`Parcel ${P}`, 'Existing building · units loading…']],
  ['error', ex(null, 'error'), [`Parcel ${P}`, 'Existing building · units unavailable']],
  [
    'no parcel',
    { kind: 'existing', parcelId: null, chunk: 'ready', summary: null },
    ['Existing building', 'Not matched to a parcel']
  ],
  [
    'existing with generated summary',
    {
      kind: 'existing',
      parcelId: P,
      chunk: 'ready',
      summary: {
        parcelId: P,
        eligible: true,
        existingUnits: 3,
        generated: { typology: 'midrise', stories: 8, units: 64 }
      }
    },
    [`Parcel ${P}`, 'Mid-rise · 8 stories · 64 units · replaces 3 (net +61)']
  ]
];

describe('tooltipLines', () => {
  it('passes stop lines through', () => {
    expect(tooltipLines({ kind: 'stop', lines: ['Powell', 'BART Red'] })).toEqual([
      'Powell',
      'BART Red'
    ]);
  });
  it.each(cases)('%s', (_name, hit, expected) => {
    expect(tooltipLines(hit)).toEqual(expected);
  });
});

describe('typologyLabel', () => {
  it('labels plex by units', () => {
    expect([1, 2, 3, 4].map((u) => typologyLabel('plex', u))).toEqual([
      'House',
      'Duplex',
      'Plex',
      'Plex'
    ]);
  });
  it('labels the other typologies', () => {
    expect(
      (['adu', 'walkup', 'podium', 'midrise', 'tower'] as const).map((t) => typologyLabel(t, 5))
    ).toEqual(['ADU', 'Walk-up', '5-over-1', 'Mid-rise', 'Tower']);
  });
});
