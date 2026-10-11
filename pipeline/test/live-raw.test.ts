import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../lib/exec';
import { openDuck } from '../lib/duck';
import { readLock, type Lock } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import { loadNormalised, normalise, normaliseAll } from '../sources/normalise';
import { materialiseFonts } from '../steps/build';
import { MINI } from './helpers';

const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-live-'));

describe('live raw layout (<rawDir>/<sha256>, no extension)', () => {
  it('normalises extensionless GeoJSON pages and a parquet overture file by lock name', async () => {
    const mini = readLock(join(MINI, 'sources.lock.json'));
    const raw = tmp();
    const norm = tmp();
    const db = await openDuck();
    try {
      // Pre-normalise the fixture's overture GeoJSON to the src_overture parquet shape (what
      // fetchOverture writes), then store everything by sha256 like the live fetch does.
      const ov = mini.sources.find((s) => s.id === 'overture-buildings')!;
      const pq = join(tmp(), 'o.parquet');
      await normalise(db, 'overture-buildings', [join(MINI, 'raw', ov.files[0].name)], pq);
      const lock: Lock = { sources: [] };
      for (const s of mini.sources) {
        if (s.id === 'overture-buildings') {
          const f = storeBytes(raw, 'overture-buildings.parquet', 'u', readFileSync(pq));
          lock.sources.push({ ...s, files: [f] });
        } else if (s.id.startsWith('datasf-')) {
          const files = s.files.map((f) =>
            storeBytes(raw, f.name, f.url, readFileSync(join(MINI, 'raw', f.name)))
          );
          lock.sources.push({ ...s, files });
        }
      }
      expect(existsSync(join(raw, lock.sources[0].files[0].sha256))).toBe(true);
      const counts = await normaliseAll(db, lock, raw, norm);
      expect(counts).toEqual({
        'datasf-parcels': 19,
        'datasf-landuse-2023': 15,
        'datasf-footprints': 3,
        'datasf-neighborhoods': 2,
        'overture-buildings': 12
      });
      await loadNormalised(db, norm);
      const [r] = await db.all<{ n: number }>('SELECT count(*) n FROM src_overture');
      expect(r.n).toBe(12);
    } finally {
      db.close();
    }
  });
});

describe('materialiseFonts', () => {
  it('extracts fonts/ from the pinned basemaps-assets tarball', async () => {
    const src = tmp();
    const root = join(src, 'basemaps-assets-abc123');
    mkdirSync(join(root, 'fonts/Noto Sans Regular'), { recursive: true });
    writeFileSync(join(root, 'fonts/Noto Sans Regular/0-255.pbf'), 'pbf');
    writeFileSync(join(root, 'fonts/OFL.txt'), 'licence');
    writeFileSync(join(root, 'README.md'), 'ignored');
    const tgz = join(tmp(), 'f.tgz');
    expect((await run('tar', ['-czf', tgz, '-C', src, 'basemaps-assets-abc123'])).code).toBe(0);
    const raw = tmp();
    const bytes = readFileSync(tgz);
    const f = storeBytes(raw, 'protomaps-fonts.tar.gz', 'u', bytes);
    const lock: Lock = {
      sources: [
        {
          id: 'protomaps-fonts',
          files: [f],
          retrievedAt: 't',
          upstreamVersion: 'c',
          rowCount: 1,
          license: 'OFL-1.1',
          homepage: 'h'
        }
      ]
    };
    const dir = join(tmp(), 'fonts');
    await materialiseFonts(lock, raw, false, dir);
    expect(readFileSync(join(dir, 'Noto Sans Regular/0-255.pbf'), 'utf8')).toBe('pbf');
    expect(readFileSync(join(dir, 'OFL.txt'), 'utf8')).toBe('licence');
    expect(existsSync(join(dir, 'README.md'))).toBe(false);
  });
});
