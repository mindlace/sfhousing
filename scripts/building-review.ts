// Review script for the building boxes (docs/dev/building-boxes.md "Review a round"): before and
// after street-level captures of the spec's ten review areas, a phantom-step spot-check sample and
// the stats, as one static page. Drives the VITE_E2E build against two dataset versions already in
// local R2.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { openDuck } from '../pipeline/lib/duck';
import type { SfhMapDebug } from '../src/lib/map/debug';

export interface ReviewView {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

const view = (
  id: string,
  name: string,
  center: [number, number],
  zoom = 16.5,
  pitch = 65,
  bearing = 0
): ReviewView => ({ id, name, center, zoom, pitch, bearing });

/** The spec's ten review areas. Centres are approximate: nudge one when its buildings are out of frame. */
export const REVIEW_VIEWS: ReviewView[] = [
  view(
    'downtown-rincon',
    'Rincon Hill (Salesforce, 181 Fremont, Millennium)',
    [-122.3955, 37.7895]
  ),
  view('transamerica-fidi', 'Transamerica and the Financial District', [-122.4028, 37.7952]),
  view('sutro', 'Sutro Tower', [-122.4528, 37.7552], 16, 65),
  view('civic-center', 'Civic Center (City Hall)', [-122.4193, 37.7793]),
  view('ferry-building', 'Ferry Building', [-122.3937, 37.7955], 17),
  view('ucsf-parnassus', 'UCSF Parnassus', [-122.458, 37.7631], 16),
  view(
    'noe-false-fronts',
    'Noe Valley false fronts (24th-25th, Noe-Sanchez)',
    [-122.431, 37.7505],
    17
  ),
  view('outer-sunset-rows', 'Outer Sunset rowhouses', [-122.49858, 37.7542], 17),
  view('presidio-heights-trees', 'Presidio Heights (tree cover)', [-122.449, 37.7895], 17),
  view('russian-hill-slope', 'Russian Hill slope', [-122.4187, 37.8015], 17, 68)
];

/** The columns of building-roofs.parquet this script reads. */
export interface RoofRow {
  bid: string;
  lng: number;
  lat: number;
  n_step: number;
  n_front: number;
}

export interface ReviewStats {
  buildings: number;
  /** Share of the five `src` values, over all boxes. */
  srcShares: Record<'box' | 'base' | 'front' | 'step' | 'part', number>;
  /** Registration outcome shares, over `boxes.reg.clusters`. */
  reg: Record<'fit' | 'none' | 'zero' | 'flagged' | 'frame_nad83' | 'frame_wgs84', number>;
  /** Fallback buildings over all buildings. */
  fallbackShare: number;
  stepBuildings: number;
  stepBoxes: number;
  frontBuildings: number;
  frontBoxes: number;
  uncoveredDropped: number;
  drops: number;
}

const SRC = ['box', 'base', 'front', 'step', 'part'] as const;
const REG = ['fit', 'none', 'zero', 'flagged', 'frame_nad83', 'frame_wgs84'] as const;

/** The review numbers from a build's report.json counts. */
export function reviewStats(report: { counts: Record<string, number> }): ReviewStats {
  const c = report.counts;
  const n = (k: string): number => c[k] ?? 0;
  const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);
  const boxes = SRC.reduce((a, s) => a + n(`boxes.src.${s}`), 0);
  const fallback = Object.keys(c)
    .filter((k) => k.startsWith('boxes.fallback.'))
    .reduce((a, k) => a + c[k], 0);
  return {
    buildings: n('boxes.buildings'),
    srcShares: Object.fromEntries(SRC.map((s) => [s, ratio(n(`boxes.src.${s}`), boxes)])) as Record<
      (typeof SRC)[number],
      number
    >,
    reg: Object.fromEntries(
      REG.map((k) => [k, ratio(n(`boxes.reg.${k}`), n('boxes.reg.clusters'))])
    ) as Record<(typeof REG)[number], number>,
    fallbackShare: ratio(fallback, n('boxes.buildings')),
    stepBuildings: n('boxes.step.buildings'),
    stepBoxes: n('boxes.src.step'),
    frontBuildings: n('boxes.front.buildings'),
    frontBoxes: n('boxes.src.front'),
    uncoveredDropped: n('boxes.parts.uncovered_dropped'),
    drops: n('tiles.buildings.drops_z14plus')
  };
}

/**
 * `n` buildings with steps (or, with kind 'front', false fronts), in a fixed order per version:
 * sorted by md5(bid + version), so a re-run of the same round samples the same buildings.
 */
export function sampleBuildings(
  roofs: RoofRow[],
  version: string,
  n: number,
  kind: 'step' | 'front' = 'step'
): RoofRow[] {
  const key = (r: RoofRow): string =>
    createHash('md5')
      .update(r.bid + version)
      .digest('hex');
  return roofs
    .filter((r) => (kind === 'step' ? r.n_step : r.n_front) > 0)
    .map((r) => ({ r, k: key(r) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, n)
    .map((x) => x.r);
}

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Relative image name of a sampled building's capture. */
export const sampleImage = (bid: string): string =>
  `sample-${bid.replace(/[^A-Za-z0-9_.-]/g, '_')}.png`;

/** The review page: view pairs, then the sample with a phantom-step column, then the stats. */
export function renderReviewHtml(r: {
  before: string;
  after: string;
  views: ReviewView[];
  sample: RoofRow[];
  stats: ReviewStats;
  tiles: { before: number; after: number };
}): string {
  const pair = (name: string, file: string, extra = ''): string => `
    <figure><figcaption>${esc(name)}${extra}</figcaption>
      <div class="pair">
        <div><b>before</b> ${esc(r.before)}<img loading="lazy" src="before/${file}" alt="before: ${esc(name)}"></div>
        <div><b>after</b> ${esc(r.after)}<img loading="lazy" src="after/${file}" alt="after: ${esc(name)}"></div>
      </div></figure>`;
  const views = r.views.map((v) => pair(v.name, `${v.id}.png`)).join('');
  const sample = r.sample
    .map((s) => {
      const kind = s.n_step > 0 ? `${s.n_step} step(s)` : `${s.n_front} front(s)`;
      const lnglat = `${s.lng.toFixed(5)}, ${s.lat.toFixed(5)}`;
      return `<tr><td>${esc(s.bid)}<br>${kind}<br>${lnglat}</td>
        <td><img loading="lazy" src="before/${sampleImage(s.bid)}" alt="before"></td>
        <td><img loading="lazy" src="after/${sampleImage(s.bid)}" alt="after"></td>
        <td><label><input type="checkbox"> phantom step</label></td></tr>`;
    })
    .join('');
  const s = r.stats;
  const change = r.tiles.before > 0 ? (r.tiles.after - r.tiles.before) / r.tiles.before : 0;
  const rows: [string, string][] = [
    ['buildings', String(s.buildings)],
    ...SRC.map((k): [string, string] => [`src ${k}`, pct(s.srcShares[k])]),
    ['fallback buildings', pct(s.fallbackShare)],
    ...REG.map((k): [string, string] => [`registration ${k}`, pct(s.reg[k])]),
    ['step buildings / boxes', `${s.stepBuildings} / ${s.stepBoxes}`],
    ['front buildings / boxes', `${s.frontBuildings} / ${s.frontBoxes}`],
    ['uncovered area dropped (m2)', String(s.uncoveredDropped)],
    ['tile drops at z14+', String(s.drops)],
    ['buildings.pmtiles before (bytes)', String(r.tiles.before)],
    ['buildings.pmtiles after (bytes)', String(r.tiles.after)],
    ['buildings.pmtiles change', `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`]
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Building review: ${esc(r.after)}</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 1rem 2rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  img { width: 100%; height: auto; display: block; background: #eee; }
  figure { margin: 0 0 2rem; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
  .sample img { width: 480px; }
</style></head><body>
<h1>Building review</h1>
<p>before ${esc(r.before)}, after ${esc(r.after)}</p>
<h2>Review areas</h2>${views}
<h2>Spot-check sample</h2>
<table class="sample"><tr><th>Building</th><th>Before</th><th>After</th><th>Check</th></tr>${sample}</table>
<h2>Stats</h2>
<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
</body></html>
`;
}

// ---- capture ------------------------------------------------------------------------------------

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

type Win = Window & { __sfhMap?: SfhMapDebug };

/** wrangler dev serving `version` on PORT; stop() always kills the whole process group. */
async function startServer(version: string): Promise<{ stop: () => void }> {
  if (
    await fetch(`${BASE}/about`).then(
      () => true,
      () => false
    )
  )
    throw new Error(`port ${PORT} is already serving something`);
  const child: ChildProcess = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--var',
      'ENVIRONMENT:development',
      '--var',
      `PUBLIC_DATASET_VERSION:${version}`
    ],
    { stdio: 'ignore', detached: true }
  );
  const stop = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };
  process.once('exit', stop);
  try {
    for (let i = 0; i < 180; i++) {
      if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode})`);
      if (
        await fetch(`${BASE}/about`).then(
          (r) => r.ok,
          () => false
        )
      )
        return { stop };
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('wrangler dev did not start in 180 s');
  } catch (e) {
    stop();
    throw e;
  }
}

async function jumpAndIdle(page: Page, f: Omit<ReviewView, 'id' | 'name'>): Promise<void> {
  await page.evaluate(
    (frame) =>
      new Promise<void>((resolve, reject) => {
        const map = (window as Win).__sfhMap!.map!;
        const t = setTimeout(() => reject(new Error('map did not go idle in 60 s')), 60_000);
        map.once('idle', () => {
          clearTimeout(t);
          resolve();
        });
        map.jumpTo(frame);
      }),
    f
  );
}

/** Capture every frame of `frames` into `<out>/<tag>/`; returns the buildings.pmtiles byte size. */
async function captureVersion(
  version: string,
  out: string,
  frames: { file: string; v: Omit<ReviewView, 'id' | 'name'> }[]
): Promise<number> {
  const server = await startServer(version);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.waitForSelector('[data-testid=map-root][data-state=ready]', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as Win).__sfhMap?.map);
    // The editor's side panel and the map controls sit over the map: capture the canvas alone.
    await page.addStyleTag({
      content: `body * { visibility: hidden !important; }
        [data-testid=map-root], [data-testid=map-root] * { visibility: visible !important; }
        .maplibregl-control-container { display: none !important; }`
    });
    mkdirSync(out, { recursive: true });
    for (const f of frames) {
      await jumpAndIdle(page, f.v);
      await page.locator('canvas.maplibregl-canvas').screenshot({ path: join(out, f.file) });
    }
    const head = await fetch(`${BASE}/data/${version}/buildings.pmtiles`, { method: 'HEAD' });
    const len = Number(head.headers.get('content-length'));
    if (Number.isFinite(len) && len > 0) return len;
    return (await (await fetch(`${BASE}/data/${version}/buildings.pmtiles`)).arrayBuffer())
      .byteLength;
  } finally {
    await browser.close();
    server.stop();
  }
}

async function readRoofs(path: string): Promise<RoofRow[]> {
  if (!existsSync(path)) {
    console.warn(`no ${path}: the sample is empty (run the build with the building-boxes lock)`);
    return [];
  }
  const db = await openDuck();
  try {
    return await db.all<RoofRow>(
      `SELECT bid, lng, lat, n_step::INTEGER AS n_step, n_front::INTEGER AS n_front
       FROM read_parquet('${path.replaceAll("'", "''")}') ORDER BY bid`
    );
  } finally {
    db.close();
  }
}

function readReport(version: string): { counts: Record<string, number> } {
  for (const p of [
    `pipeline/out/${version}/report.json`,
    `e2e/fixtures/data/${version}/report.json`
  ]) {
    if (existsSync(p))
      return JSON.parse(readFileSync(p, 'utf8')) as { counts: Record<string, number> };
  }
  console.warn(`no report.json for ${version}: stats are zero`);
  return { counts: {} };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const before = flag(args, '--before');
  const after = flag(args, '--after');
  if (!before || !after) {
    console.error(
      'usage: building-review.ts --before <v> --after <v> [--out <dir>] [--sample 20] [--roofs <parquet>]'
    );
    process.exit(2);
  }
  const out = flag(args, '--out') ?? `pipeline/.cache/review/${after}`;
  const n = Number(flag(args, '--sample') ?? 20);
  const roofs = await readRoofs(
    flag(args, '--roofs') ?? `pipeline/.cache/derived/${after}/building-roofs.parquet`
  );
  const sample = [
    ...sampleBuildings(roofs, after, n, 'step'),
    ...sampleBuildings(roofs, after, 10, 'front')
  ];

  console.log('building (VITE_E2E=1 npm run build)');
  const built = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_E2E: '1' }
  });
  if (built.status !== 0) throw new Error('build failed');

  const frames = [
    ...REVIEW_VIEWS.map((v) => ({ file: `${v.id}.png`, v })),
    ...sample.map((s) => ({
      file: sampleImage(s.bid),
      v: { center: [s.lng, s.lat] as [number, number], zoom: 17, pitch: 65, bearing: 0 }
    }))
  ];
  const tiles = { before: 0, after: 0 };
  tiles.before = await captureVersion(before, join(out, 'before'), frames);
  tiles.after = await captureVersion(after, join(out, 'after'), frames);

  const stats = reviewStats(readReport(after));
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'index.html'),
    renderReviewHtml({ before, after, views: REVIEW_VIEWS, sample, stats, tiles })
  );
  writeFileSync(
    join(out, 'stats.json'),
    JSON.stringify({ before, after, tiles, stats, sample: sample.map((s) => s.bid) }, null, 2)
  );
  console.log(`wrote ${join(out, 'index.html')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    }
  );
