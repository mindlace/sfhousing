import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BBOX, FONTS_COMMIT } from '../config';
import { run as defaultRun } from '../lib/exec';
import type { Http } from '../lib/http';
import type { LockEntry } from '../lib/lock';
import { storeBytes, storeFile } from '../lib/raw';
import type { RunFn } from '../lib/r2';

const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

/**
 * Spec §4.1: `pmtiles extract` of a Protomaps daily build over the SF bbox. Without an explicit
 * date it starts at yesterday (UTC) and steps back a day on a 404, up to 7 days.
 */
export async function fetchBasemap(
  date: string | undefined,
  rawDir: string,
  now: Date,
  run: RunFn = defaultRun
): Promise<LockEntry> {
  const candidates: string[] = [];
  if (date) candidates.push(date);
  else {
    for (let back = 1; back <= 8; back++) {
      candidates.push(yyyymmdd(new Date(now.getTime() - back * 86400000)));
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'sfh-basemap-'));
  try {
    for (const d of candidates) {
      const url = `https://build.protomaps.com/${d}.pmtiles`;
      const out = join(dir, `${d}.pmtiles`);
      const r = await run('pmtiles', [
        'extract',
        url,
        out,
        `--bbox=${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n}`,
        '--maxzoom=15'
      ]);
      if (r.code === 0) {
        const file = await storeFile(rawDir, 'protomaps-basemap.pmtiles', url, out);
        return {
          id: 'protomaps-basemap',
          files: [file],
          retrievedAt: new Date().toISOString(),
          upstreamVersion: d,
          rowCount: 1,
          license: 'ODbL-1.0',
          label: 'Protomaps basemap (OpenStreetMap)',
          homepage: 'https://protomaps.com'
        };
      }
      if (!/\b404\b/.test(r.stderr) || date) {
        throw new Error(`pmtiles extract ${url} failed (exit ${r.code}): ${r.stderr.trim()}`);
      }
    }
    throw new Error(`no protomaps build found in the last ${candidates.length} days`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The pinned basemaps-assets tarball; `build` extracts `fonts/` from it. */
export async function fetchFonts(rawDir: string, http: Http): Promise<LockEntry> {
  const url = `https://codeload.github.com/protomaps/basemaps-assets/tar.gz/${FONTS_COMMIT}`;
  const res = await http.get(url);
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return {
    id: 'protomaps-fonts',
    files: [storeBytes(rawDir, 'protomaps-fonts.tar.gz', url, res.body)],
    retrievedAt: new Date().toISOString(),
    upstreamVersion: FONTS_COMMIT,
    rowCount: 1,
    license: 'OFL-1.1',
    label: 'Noto Sans glyphs',
    homepage: 'https://github.com/protomaps/basemaps-assets'
  };
}
