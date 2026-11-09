// `node scripts/profile-sim-load.mjs --origin <url> [--runs 3] [--trace]`
// Cold-load profile of the /sim page: publishes scripts/profile-sim-load.policy.json (its
// datasetVersion replaced by the origin's) through POST /api/policies, then loads
//   A  /sim
//   B  /sim?seed=72
//   C  /s/<id>
// each in a fresh headed Chromium context, and prints the median "ready" per case: the first
// `timeline` message the sim worker posts at or after the last initScenario/setLevers the page
// sent, in ms from navigation. A Worker wrapper installed before the page runs timestamps the
// messages both ways. Exit 2 when a load errors or never reaches ready.
// It publishes a new public policy, so it refuses an origin whose host is not localhost or
// 127.0.0.1 (exit 2) unless `--allow-remote` is passed.
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? null);
};
const origin = flag('--origin')?.replace(/\/+$/, '');
const runs = Number(flag('--runs') ?? 3);
const trace = args.includes('--trace');
if (!origin || !Number.isInteger(runs) || runs < 1) {
  console.error(
    'usage: node scripts/profile-sim-load.mjs --origin <url> [--runs 3] [--trace] [--allow-remote]'
  );
  process.exit(2);
}

const allowRemote = args.includes('--allow-remote');
let host = '';
try {
  host = new URL(origin).hostname;
} catch {
  console.error(`invalid --origin: ${origin}`);
  process.exit(2);
}
if (!allowRemote && host !== 'localhost' && host !== '127.0.0.1') {
  console.error(
    `refusing to publish a public policy to ${origin}: host is not localhost or 127.0.0.1. ` +
      'Pass --allow-remote to do it anyway.'
  );
  process.exit(2);
}

/** The dataset version the origin serves: the root layout's data, from SvelteKit's __data.json. */
async function datasetVersionOf() {
  const res = await fetch(`${origin}/sim/__data.json`);
  if (!res.ok) throw new Error(`GET /sim/__data.json: ${res.status}`);
  const json = await res.json();
  for (const node of json.nodes ?? []) {
    const d = node?.data;
    if (!Array.isArray(d) || typeof d[0] !== 'object' || d[0] === null) continue;
    const idx = d[0].datasetVersion;
    if (typeof idx === 'number' && typeof d[idx] === 'string') return d[idx];
  }
  throw new Error('no datasetVersion in /sim/__data.json');
}

async function publish(version) {
  const doc = JSON.parse(readFileSync(join(here, 'profile-sim-load.policy.json'), 'utf8'));
  doc.datasetVersion = version;
  const res = await fetch(`${origin}/api/policies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.id !== 'string') {
    throw new Error(`POST /api/policies: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.id;
}

/** Runs in the page before any script: records what the page sends to and gets from workers. */
const INIT = () => {
  const log = (window.__sfhProf = { msgs: [], sent: [] });
  const Orig = window.Worker;
  window.Worker = class extends Orig {
    constructor(u, o) {
      super(u, o);
      const wid = (log.workers = (log.workers ?? 0) + 1);
      this.addEventListener('message', (e) => {
        const d = e.data || {};
        log.msgs.push({ wid, t: performance.now(), type: d.type, rev: d.rev });
      });
    }
    postMessage(msg, tr) {
      try {
        log.sent.push({ t: performance.now(), type: msg && msg.type, rev: msg && msg.rev });
      } catch {
        // a message that cannot be inspected is still sent
      }
      return super.postMessage(msg, tr);
    }
  };
};

/**
 * ms from navigation to ready, or null: the first timeline received whose rev is at or after the
 * highest rev among the initScenario/setLevers messages the page sent.
 */
const readyOf = (prof) => {
  const revs = (prof?.sent ?? [])
    .filter(
      (s) => (s.type === 'initScenario' || s.type === 'setLevers') && typeof s.rev === 'number'
    )
    .map((s) => s.rev);
  if (revs.length === 0) return null;
  const last = Math.max(...revs);
  const tl = (prof?.msgs ?? []).find(
    (m) => m.type === 'timeline' && typeof m.rev === 'number' && m.rev >= last
  );
  return tl ? tl.t : null;
};

async function load(browser, url, label, n) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (trace) {
    mkdirSync(join(here, '..', 'tmp'), { recursive: true });
    await browser.startTracing(page, {
      path: join(here, '..', 'tmp', `profile-${label}-${n}.trace.json`)
    });
  }
  let ready = null;
  try {
    await page.goto(url, { waitUntil: 'commit' });
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(250);
      const st = await page.evaluate(() => ({
        prof: window.__sfhProf,
        err:
          (window.__sfhProf?.msgs ?? []).some((m) => m.type === 'error') ||
          /couldn.t load|could not load/i.test(document.body.innerText)
      }));
      if (st.err) {
        errors.push('page or worker reported a load error');
        break;
      }
      ready = readyOf(st.prof);
      if (ready !== null) {
        // setLevers can land after an early timeline: settle, then take the final reading
        await page.waitForTimeout(1000);
        ready = readyOf(await page.evaluate(() => window.__sfhProf));
        break;
      }
    }
  } finally {
    if (trace) await browser.stopTracing();
    await context.close();
  }
  if (ready === null && errors.length === 0) errors.push('never reached a timeline');
  return { ready, errors };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

let browser = null;
let failed = false;
try {
  const version = await datasetVersionOf();
  const id = await publish(version);
  console.log(`dataset ${version}, published policy ${id}`);
  const cases = [
    ['A', `${origin}/sim`],
    ['B', `${origin}/sim?seed=72`],
    ['C', `${origin}/s/${id}`]
  ];
  browser = await chromium.launch({ headless: false, args: ['--window-size=1440,960'] });
  for (const [label, url] of cases) {
    const times = [];
    for (let n = 1; n <= runs; n++) {
      const r = await load(browser, url, label, n);
      if (r.errors.length > 0) {
        failed = true;
        console.error(`${label} run ${n}: ${r.errors.join('; ')}`);
      }
      if (r.ready !== null) times.push(r.ready);
    }
    console.log(
      times.length > 0
        ? `${label} ${Math.round(median(times))}ms (${times.map((t) => Math.round(t)).join(', ')})`
        : `${label} no ready`
    );
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  failed = true;
} finally {
  await browser?.close();
}
if (failed) process.exit(2);
