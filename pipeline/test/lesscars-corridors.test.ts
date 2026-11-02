import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COUNTY_LINE,
  CorridorError,
  resolveCorridor,
  resolveCorridors,
  type CorridorSelector,
  type StreetSeg
} from '../lib/lesscars/corridors';
import { readLock, type Lock } from '../lib/lock';
import { CORRIDORS_JSON, lesscarsCnns, parseCorridorsFile } from '../steps/lesscars-cnns';
import { MINI } from './helpers';

// Synthetic segments in metres.
const seg = (
  cnn: string,
  streetname: string,
  pts: [number, number][],
  fSt: string | null = null,
  tSt: string | null = null
): StreetSeg => ({ cnn, streetname, fSt, tSt, lines: [pts] });
const sel = (street: string, from: string, to: string, owner = 'x'): CorridorSelector => ({
  owner,
  street,
  from,
  to
});
const cross = (cnn: string, name: string, x: number): StreetSeg =>
  seg(cnn, name, [
    [x, -60],
    [x, 60]
  ]);

const grid: StreetSeg[] = [
  seg('m-za', 'MAIN ST', [
    [-100, 0],
    [0, 0]
  ]),
  seg('m-ab', 'MAIN ST', [
    [0, 0],
    [100, 0]
  ]),
  seg('m-bc', 'MAIN ST', [
    [100, 0],
    [200, 0]
  ]),
  seg('m-cd', 'MAIN ST', [
    [200, 0],
    [300, 0]
  ]),
  cross('a', 'A ST', 0),
  cross('b', 'B ST', 100),
  cross('c', 'C ST', 200),
  cross('d', 'D ST', 300)
];

const divided: StreetSeg[] = [
  seg('w-n', 'WIDE BLVD', [
    [0, 15],
    [120, 15]
  ]),
  // Shared-centreline twin: the same geometry as w-n under another CNN.
  seg('w-twin', 'WIDE BLVD', [
    [0, 15],
    [120, 15]
  ]),
  seg('w-s', 'WIDE BLVD', [
    [120, -15],
    [0, -15]
  ]),
  seg('w-n2', 'WIDE BLVD', [
    [120, 15],
    [240, 15]
  ]),
  seg('w-s2', 'WIDE BLVD', [
    [240, -15],
    [120, -15]
  ]),
  cross('a', 'A ST', 0),
  cross('b', 'B ST', 120),
  cross('c', 'C ST', 240)
];

const twoTowns: StreetSeg[] = [
  seg('near-main', 'MAIN ST', [
    [0, 0],
    [100, 0]
  ]),
  seg('far-main', 'MAIN ST', [
    [5000, 0],
    [5100, 0]
  ]),
  cross('a', 'A ST', 0),
  cross('b', 'B ST', 100)
];

const county: StreetSeg[] = [
  seg(
    'l-0',
    'LONG BLVD',
    [
      [-100, 0],
      [0, 0]
    ],
    'Z ST',
    'A ST'
  ),
  seg(
    'l-1',
    'LONG BLVD',
    [
      [0, 0],
      [100, 0]
    ],
    'A ST',
    'B ST'
  ),
  seg(
    'l-2',
    'LONG BLVD',
    [
      [100, 0],
      [200, 0]
    ],
    'B ST',
    'COUNTY LINE'
  ),
  cross('a', 'A ST', 0)
];

describe('resolveCorridor', () => {
  it('resolves a straight chain between two cross streets', () => {
    expect(resolveCorridor(grid, sel('MAIN ST', 'A ST', 'C ST')).cnn).toEqual(['m-ab', 'm-bc']);
  });

  it('a segment past TO is excluded', () => {
    expect(resolveCorridor(grid, sel('MAIN ST', 'A ST', 'C ST')).cnn).not.toContain('m-cd');
  });

  it('a segment before FROM is excluded, and FROM/TO order does not matter', () => {
    expect(resolveCorridor(grid, sel('MAIN ST', 'C ST', 'A ST')).cnn).toEqual(['m-ab', 'm-bc']);
  });

  it('lengthM sums the corridor segments, rounded to 0.1', () => {
    const r = resolveCorridor(divided, sel('WIDE BLVD', 'A ST', 'B ST'));
    expect(r.lengthM).toBe(360);
    expect(r).toMatchObject({ owner: 'x', street: 'WIDE BLVD', from: 'A ST', to: 'B ST' });
  });

  it('both carriageways and a shared-centreline twin are included', () => {
    expect(resolveCorridor(divided, sel('WIDE BLVD', 'A ST', 'B ST')).cnn).toEqual([
      'w-n',
      'w-s',
      'w-twin'
    ]);
  });

  it('a same-named street elsewhere is excluded', () => {
    expect(resolveCorridor(twoTowns, sel('MAIN ST', 'A ST', 'B ST')).cnn).not.toContain('far-main');
  });

  it('COUNTY LINE ends at the dead end whose t_st says so', () => {
    expect(resolveCorridor(county, sel('LONG BLVD', 'A ST', COUNTY_LINE)).cnn).toEqual([
      'l-1',
      'l-2'
    ]);
  });

  it('endpoints within snapM join (coordinate noise in real centrelines)', () => {
    const noisy = grid.map((s) =>
      s.cnn === 'm-bc'
        ? seg('m-bc', 'MAIN ST', [
            [100.3, 0.2],
            [200, 0]
          ])
        : s
    );
    expect(resolveCorridor(noisy, sel('MAIN ST', 'A ST', 'C ST')).cnn).toEqual(['m-ab', 'm-bc']);
  });

  it('a multi-part segment is walked part by part', () => {
    const parts: StreetSeg[] = [
      {
        cnn: 'mp',
        streetname: 'MAIN ST',
        fSt: null,
        tSt: null,
        lines: [
          [
            [0, 0],
            [50, 0]
          ],
          [
            [50, 0],
            [100, 0]
          ]
        ]
      },
      cross('a', 'A ST', 0),
      cross('b', 'B ST', 100)
    ];
    const r = resolveCorridor(parts, sel('MAIN ST', 'A ST', 'B ST'));
    expect(r).toMatchObject({ cnn: ['mp'], lengthM: 100 });
  });

  it('a divided cross street: the median piece is kept, the block past it is not', () => {
    const segs: StreetSeg[] = [
      seg('m-1', 'MAIN ST', [
        [0, 0],
        [100, 0]
      ]),
      seg('m-med', 'MAIN ST', [
        [100, 0],
        [112, 0]
      ]),
      seg('m-next', 'MAIN ST', [
        [112, 0],
        [212, 0]
      ]),
      cross('a', 'A ST', 0),
      cross('b1', 'B ST', 100),
      cross('b2', 'B ST', 112)
    ];
    const r = resolveCorridor(segs, sel('MAIN ST', 'A ST', 'B ST'));
    expect(r.cnn).toEqual(['m-1', 'm-med']);
  });

  it('a parallel same-name segment beyond bandM is excluded', () => {
    const segs = [
      ...grid,
      seg('m-far', 'MAIN ST', [
        [0, 90],
        [100, 90]
      ])
    ];
    expect(resolveCorridor(segs, sel('MAIN ST', 'A ST', 'B ST')).cnn).toEqual(['m-ab']);
  });

  it('no crossing or no path throws naming the owner and the selector', () => {
    expect(() => resolveCorridor(grid, sel('MAIN ST', 'NOPE ST', 'C ST'))).toThrow(
      /x: MAIN ST, NOPE ST → C ST: no crossing with NOPE ST/
    );
    expect(() => resolveCorridor(grid, sel('MAIN ST', 'A ST', 'NOPE ST'))).toThrow(
      /x: MAIN ST, A ST → NOPE ST: no crossing with NOPE ST/
    );
    const gap = grid.filter((s) => s.cnn !== 'm-ab');
    expect(() => resolveCorridor(gap, sel('MAIN ST', 'A ST', 'C ST'))).toThrow(
      /x: MAIN ST, A ST → C ST: no path/
    );
    expect(() => resolveCorridor(grid, sel('NOPE AVE', 'A ST', 'C ST'))).toThrow(CorridorError);
  });

  it('FROM and TO at the same node is no path, not an empty corridor', () => {
    const segs = [...grid, cross('a2', 'AA ST', 0)];
    expect(() => resolveCorridor(segs, sel('MAIN ST', 'A ST', 'AA ST'))).toThrow(/no path/);
  });

  it('COUNTY LINE with no such dead end is no crossing', () => {
    expect(() => resolveCorridor(grid, sel('MAIN ST', 'A ST', COUNTY_LINE))).toThrow(
      /no crossing with COUNTY LINE/
    );
  });
});

describe('resolveCorridors', () => {
  it('resolves every selector in order', () => {
    const r = resolveCorridors(grid, [
      sel('MAIN ST', 'A ST', 'B ST'),
      sel('MAIN ST', 'B ST', 'C ST')
    ]);
    expect(r.map((c) => c.cnn)).toEqual([['m-ab'], ['m-bc']]);
  });

  it('resolveCorridors lists every failure in one error', () => {
    const bad1 = sel('MAIN ST', 'NOPE ST', 'C ST', 'bad1');
    const bad2 = sel('MAIN ST', 'A ST', 'NOPE ST', 'bad2');
    expect(() => resolveCorridors(grid, [bad1, sel('MAIN ST', 'A ST', 'B ST'), bad2])).toThrow(
      /bad1[\s\S]*bad2/
    );
  });
});

// lon/lat near SF: 1e-3 deg lng ≈ 88 m, 1e-3 deg lat ≈ 111 m.
const LNG = -122.44;
const LAT = 37.77;
const feature = (cnn: string, name: string, pts: [number, number][], tSt?: string) => ({
  type: 'Feature',
  properties: { cnn, streetname: name, f_st: null, t_st: tSt ?? null, active: true },
  geometry: { type: 'MultiLineString', coordinates: [pts.map(([x, y]) => [LNG + x, LAT + y])] }
});

function streetsLock(dir: string, features: unknown[]): Lock {
  const body = JSON.stringify({ type: 'FeatureCollection', features });
  const sha256 = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(dir, sha256), body);
  const lock: Lock = {
    sources: [
      {
        id: 'datasf-streets',
        files: [{ url: 'x', sha256, bytes: body.length, archiveKey: 'x', name: 'p.geojson' }],
        retrievedAt: '2026-11-01T00:00:00.000Z',
        upstreamVersion: 'test',
        rowCount: features.length,
        license: 'PDDL-1.0',
        homepage: 'x'
      }
    ]
  };
  writeFileSync(join(dir, 'lock.json'), JSON.stringify(lock));
  return lock;
}

const synthetic = [
  feature('10', 'MAIN ST', [
    [0, 0],
    [0.001, 0]
  ]),
  feature('11', 'MAIN ST', [
    [0.001, 0],
    [0.002, 0]
  ]),
  feature('12', 'MAIN ST', [
    [0.002, 0],
    [0.003, 0]
  ]),
  feature('20', 'A ST', [
    [0, -0.0005],
    [0, 0.0005]
  ]),
  feature('21', 'C ST', [
    [0.002, -0.0005],
    [0.002, 0.0005]
  ])
];

describe('lesscarsCnns', () => {
  it('writes the resolved corridors with the source hashes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-lc-cnn-'));
    const lock = streetsLock(dir, synthetic);
    const inPath = join(dir, 'corridors.json');
    const outPath = join(dir, 'corridors.resolved.json');
    writeFileSync(
      inPath,
      JSON.stringify({ schema: 1, corridors: [sel('MAIN ST', 'C ST', 'A ST', 'p')] })
    );
    const code = await lesscarsCnns({
      lockPath: join(dir, 'lock.json'),
      rawDir: dir,
      inPath,
      outPath
    });
    expect(code).toBe(0);
    const out = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(out.schema).toBe(1);
    expect(out.source).toEqual({ id: 'datasf-streets', sha256: [lock.sources[0].files[0].sha256] });
    expect(out.corridors).toHaveLength(1);
    expect(out.corridors[0]).toMatchObject({
      owner: 'p',
      street: 'MAIN ST',
      from: 'C ST',
      to: 'A ST',
      cnn: ['10', '11']
    });
    // Two blocks of 1e-3 deg lng at 37.77 N: about 176 m.
    expect(out.corridors[0].lengthM).toBeGreaterThan(170);
    expect(out.corridors[0].lengthM).toBeLessThan(182);
  });

  it('an unresolved selector exits 1 and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-lc-cnn-'));
    streetsLock(dir, synthetic);
    const inPath = join(dir, 'corridors.json');
    const outPath = join(dir, 'corridors.resolved.json');
    writeFileSync(
      inPath,
      JSON.stringify({
        schema: 1,
        corridors: [sel('MAIN ST', 'A ST', 'C ST', 'ok'), sel('MAIN ST', 'A ST', 'Q ST', 'bad')]
      })
    );
    const code = await lesscarsCnns({
      lockPath: join(dir, 'lock.json'),
      rawDir: dir,
      inPath,
      outPath
    });
    expect(code).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });

  it('reads the mini fixture streets by name; a selector with no crossing there exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-lc-cnn-'));
    const inPath = join(dir, 'corridors.json');
    const outPath = join(dir, 'corridors.resolved.json');
    // MISSION ST 1000-1001 ends at FIXTURE AVE; nothing crosses its west end.
    writeFileSync(
      inPath,
      JSON.stringify({ schema: 1, corridors: [sel('MISSION ST', 'FIXTURE AVE', 'NOPE ST', 'm')] })
    );
    const code = await lesscarsCnns({
      lockPath: join(MINI, 'sources.lock.json'),
      rawDir: join(MINI, 'raw'),
      byName: true,
      inPath,
      outPath
    });
    expect(code).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });

  it('a lock without datasf-streets, or a missing raw file, exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-lc-cnn-'));
    const lock = readLock(join(MINI, 'sources.lock.json'));
    lock.sources = lock.sources.filter((s) => s.id !== 'datasf-streets');
    writeFileSync(join(dir, 'no-streets.json'), JSON.stringify(lock));
    const outPath = join(dir, 'out.json');
    expect(
      await lesscarsCnns({ lockPath: join(dir, 'no-streets.json'), rawDir: dir, outPath })
    ).toBe(1);
    // The mini lock by sha256 in an empty raw dir: the file is missing.
    expect(
      await lesscarsCnns({ lockPath: join(MINI, 'sources.lock.json'), rawDir: dir, outPath })
    ).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });
});

describe('corridors.json', () => {
  it('holds the 20 selectors: Appendix A order, then the Masonic display', () => {
    const { corridors } = parseCorridorsFile(readFileSync(CORRIDORS_JSON, 'utf8'));
    expect(corridors).toHaveLength(20);
    const owners = [...new Set(corridors.map((c) => c.owner))];
    expect(owners).toEqual([
      'fulton-brt',
      '19th-ave-brt',
      'lombard-bus-lane',
      'n-judah-priority',
      'j-church-priority',
      'k-ocean-priority',
      'van-ness-street',
      'fell-oak-street',
      'irving-pedestrian',
      'columbus-pedestrian',
      'masonic-station'
    ]);
    expect(corridors.at(-1)).toEqual({
      owner: 'masonic-station',
      street: 'GEARY BLVD',
      from: 'PRESIDIO AVE',
      to: 'WOOD ST'
    });
    expect(corridors.find((c) => c.to === COUNTY_LINE)?.street).toBe('JUNIPERO SERRA BLVD');
  });

  it('a malformed entry is rejected with its index', () => {
    expect(() =>
      parseCorridorsFile(JSON.stringify({ schema: 1, corridors: [{ owner: 'a', street: 'B' }] }))
    ).toThrow(/corridors\[0\]\.from/);
  });
});
