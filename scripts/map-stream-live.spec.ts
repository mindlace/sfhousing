import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/lib/data/manifest';
import { scenarioUrls } from '../src/lib/sim/scenario/load';
import { liveFiles } from './map-stream-live';

const manifest = parseManifest(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../e2e/fixtures/data/fixture-0/manifest.json', import.meta.url)),
      'utf8'
    )
  )
);

describe('liveFiles', () => {
  it('lists the manifest, the scenario files and every chunk, relative to the version', () => {
    const files = liveFiles(manifest);
    const prefix = `/data/${manifest.datasetVersion}/`;
    const urls = scenarioUrls(manifest)!;
    expect(files).toContain('manifest.json');
    for (const u of [urls.parcels, urls.projects, urls.calibration]) {
      expect(files).toContain(u.slice(prefix.length));
    }
    for (const c of manifest.chunks) expect(files).toContain(c.url.slice(prefix.length));
    expect(new Set(files).size).toBe(files.length);
  });

  it('throws on a chunk URL naming another version', () => {
    const bad = structuredClone(manifest);
    bad.chunks[0].url = '/data/other-version/parcels/x.json';
    expect(() => liveFiles(bad)).toThrow();
  });
});
