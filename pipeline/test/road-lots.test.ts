import { describe, expect, it } from 'vitest';
import {
  parseRoadLots,
  readRoadLots,
  ROAD_LOTS_JSON,
  ROAD_NAME_WORDS,
  roadNameWords,
  roadWordPattern
} from '../lib/road-lots';
import { openDuck } from '../lib/duck';

// one case per word, each with a live City Lands name (2026-11-07)
const EXAMPLES: [string, string][] = [
  ['RIGHT-OF-WAY', 'CESAR CHAVEZ ST RIGHT-OF-WAY'],
  ['RIGHT OF WAY', 'DPW Right of Way/Remainder'],
  ['ROW', 'Arballo Drive ROW'],
  ['R/W', 'M LINE R/W'],
  ['ROADWAY', 'EMBARCADERO ROADWAY PROJECT'],
  ['OVERPASS', 'JUNIPERO SERRA OVERPASS'],
  ['MERIDIAN', 'Font Blvd Meridian Strips'],
  ['SLOPE PROTECTION', 'SLOPE PROTECTION AT ALEMANY'],
  ['REMAINDER', 'BAY SHORE BLVD (REMAINDER)'],
  ['PEDESTRIAN BRIDGE', 'GENEVA AVE PEDESTRIAN BRIDGE AT OCEAN AVE'],
  ['STRIP ALONG', "20' STRIP ALONG E LINE"],
  ['UNDEDICATED', 'UNDEDICATED ST (VERMONT & 23RD ST)'],
  ['VACATED', 'VACATED COHEN PLACE'],
  ['STREET AREA', 'STREET AREA (NOT DEDICATED)'],
  ['REALIGNMENT', 'MULLEN AVE REALIGNMENT'],
  ['EXCESS PROPERTY', 'EXCESS PROPERTY'],
  ['WALKWAY', 'CHINA BASIN WALKWAY (ADJACENT TO BALL PARK)'],
  ['TRAFFIC ISLAND', 'TRAFFIC ISLAND AT CORBETT'],
  ['FREEWAY', 'MISSION FREEWAY & BERNAL CUT'],
  ['BART TRACKS', 'Parcels btwn I-280 and BART Tracks'],
  ['MEDIAN', 'Vidal Drive Median Strips'],
  ['RELINQUISHMENT', 'STATE RELINQUISHMENT PARCEL'],
  ['CHAVEZ ST CIRCLE', 'CESAR CHAVEZ ST CIRCLE']
];
const WHOLE_WORD_NEGATIVES = [
  'BROADWAY PARCEL (STAIRS)',
  'I-480 BROADWAY PARCEL',
  'HEALTH CENTER 4 (AIR RIGHTS OVER BROADWAY TUNNEL)',
  'ROWING CLUB',
  'MEDIANS'
];
const NAME_NEGATIVES: (string | null)[] = [
  'MOHCD - Parcel E of Ridgetop Plaza',
  'ALTA PLAZA',
  'MINT PLAZA',
  'MISSION-BARTLETT PARKING PLAZA',
  'MARINA GREEN',
  'PARCEL L',
  null
];

describe('road-name words', () => {
  it.each(EXAMPLES)('matches %s', (word, name) => {
    expect(roadNameWords(name)).toContain(word);
  });
  it('has a case for every word', () => {
    expect(EXAMPLES.map(([w]) => w)).toEqual([...ROAD_NAME_WORDS]);
  });
  it('matches whole words only', () => {
    for (const n of WHOLE_WORD_NEGATIVES) expect(roadNameWords(n), n).toEqual([]);
  });
  it('does not match housing and park names', () => {
    for (const n of NAME_NEGATIVES) expect(roadNameWords(n), String(n)).toEqual([]);
  });
  it("DuckDB's regex agrees with roadNameWords", async () => {
    const db = await openDuck();
    try {
      const names = [
        ...EXAMPLES.map(([, n]) => n),
        ...WHOLE_WORD_NEGATIVES,
        ...NAME_NEGATIVES.filter((n): n is string => n !== null)
      ];
      for (const name of names) {
        const viaDuck: string[] = [];
        for (const w of ROAD_NAME_WORDS) {
          const pat = roadWordPattern(w).replace(/'/g, "''");
          const lit = name.replace(/'/g, "''");
          const [r] = await db.all<{ m: boolean }>(
            `SELECT regexp_matches(upper('${lit}'), '${pat}') AS m`
          );
          if (r.m) viaDuck.push(w);
        }
        expect(viaDuck, name).toEqual(roadNameWords(name));
      }
    } finally {
      db.close();
    }
  });
});

describe('parseRoadLots', () => {
  it('accepts both row kinds and rejects a row without a reason', () => {
    const ok = parseRoadLots({
      keep: [
        { parcel: '1234001', reason: 'a house' },
        { block: '1234', reason: 'housing site' }
      ],
      road: [{ parcel: '9999001', reason: 'a street' }]
    });
    expect(ok.keep).toHaveLength(2);
    expect(ok.road).toHaveLength(1);
    expect(() => parseRoadLots({ keep: [{ parcel: 'A', reason: '' }], road: [] })).toThrow();
    expect(() => parseRoadLots({ keep: [{ parcel: 'A', reason: '  ' }], road: [] })).toThrow();
    expect(() => parseRoadLots({ keep: [], road: [{ parcel: 'A' }] })).toThrow();
  });
  it('rejects a keep row with both parcel and block, a 3-character block, a duplicate, a parcel in both lists', () => {
    const bad = (j: unknown) => expect(() => parseRoadLots(j)).toThrow();
    bad({ keep: [{ parcel: 'A', block: '1234', reason: 'x' }], road: [] });
    bad({ keep: [{ reason: 'x' }], road: [] });
    bad({ keep: [{ block: '123', reason: 'x' }], road: [] });
    bad({ keep: [{ block: '026', reason: 'x' }], road: [] });
    bad({ keep: [{ block: '0026TT', reason: 'x' }], road: [] });
    bad({ keep: [{ block: '0026t', reason: 'x' }], road: [] });
    bad({ keep: [{ block: 'A026', reason: 'x' }], road: [] });
    bad({
      keep: [
        { parcel: 'A', reason: 'x' },
        { parcel: 'A', reason: 'y' }
      ],
      road: []
    });
    bad({
      keep: [],
      road: [
        { parcel: 'A', reason: 'x' },
        { parcel: 'A', reason: 'y' }
      ]
    });
    bad({ keep: [{ parcel: 'A', reason: 'x' }], road: [{ parcel: 'A', reason: 'y' }] });
  });
  it('accepts a lettered block (a separate SF block)', () => {
    expect(parseRoadLots({ keep: [{ block: '0026T', reason: 'x' }], road: [] }).keep).toEqual([
      { block: '0026T', reason: 'x' }
    ]);
  });
  it('the live override file parses', () => {
    expect(() => readRoadLots(ROAD_LOTS_JSON.live)).not.toThrow();
  });
  it('a missing file throws', () => {
    expect(() => readRoadLots('/nonexistent/road-lots.json')).toThrow();
  });
});
