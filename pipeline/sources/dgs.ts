/**
 * The DGS California Construction Cost Index (building-choice plan, Task 13a, fix round 2): the
 * cost index the choice-spread fit prices each record's own year with (era-market.ts). Its page
 * states no terms of use and the index derives from ENR's Building Cost Index, so it is fetched
 * into the raw cache and pinned in the lock by hash, never committed and never shipped: `fetch`
 * parses the page's tables into a `year,month,ccci` CSV, and the calibration step reads the
 * yearly means from the locked file.
 */
import { readFileSync } from 'node:fs';
import { BuildError } from '../lib/build-error';
import type { Http } from '../lib/http';
import { rawPath, type Lock, type LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';

export const DGS_CCCI_ID = 'dgs-ccci';
export const DGS_CCCI_URL =
  'https://www.dgs.ca.gov/RESD/Resources/Page-Content/Real-Estate-Services-Division-Resources-List-Folder/DGS-California-Construction-Cost-Index-CCCI';
export const DGS_CCCI_LABEL = 'DGS California Construction Cost Index (CCCI), monthly';
export const DGS_CCCI_LICENSE =
  "Not stated by DGS; derived from ENR's Building Cost Index. Read by the choice-spread fit " +
  'only, never committed or shipped.';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
const cells = (tr: string, tag: 'td' | 'th'): string[] =>
  [...tr.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => text(m[1]));

export interface CcciMonth {
  year: number;
  month: number;
  value: number;
}

/**
 * Every month value in the page's tables (years as columns, months as rows; blank cells and rows
 * that are not a month, such as the annual percentage, are skipped), sorted by year and month.
 */
export function parseCcciHtml(html: string): CcciMonth[] {
  const out: CcciMonth[] = [];
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const head = rows.find((r) => /<th/i.test(r));
    if (!head) continue;
    const years = cells(head, 'th').map((c) => (/^\d{4}$/.test(c) ? Number(c) : null));
    for (const r of rows) {
      const c = cells(r, 'td');
      const month = MONTHS.indexOf((c[0] ?? '').toLowerCase()) + 1;
      if (month === 0) continue;
      for (let i = 1; i < c.length; i++) {
        const year = years[i];
        const v = Number(c[i].replace(/,/g, ''));
        if (year === null || year === undefined || c[i] === '' || !Number.isFinite(v)) continue;
        out.push({ year, month, value: v });
      }
    }
  }
  if (out.length === 0) throw new Error('DGS CCCI page: no CCCI month values found');
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

/** The months as `year,month,ccci` CSV, one line each. */
export function ccciCsv(rows: readonly CcciMonth[]): string {
  return (
    ['year,month,ccci', ...rows.map((r) => `${r.year},${r.month},${r.value}`)].join('\n') + '\n'
  );
}

/** Per year, the mean of the months the CSV has for it. */
export function annualCostIndex(csv: string): Record<number, number> {
  const sum = new Map<number, { s: number; n: number }>();
  for (const line of csv.trim().split('\n').slice(1)) {
    const [y, , v] = line.split(',').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(v)) throw new Error(`bad CCCI line: ${line}`);
    const a = sum.get(y) ?? { s: 0, n: 0 };
    a.s += v;
    a.n++;
    sum.set(y, a);
  }
  return Object.fromEntries([...sum].map(([y, a]) => [y, a.s / a.n]));
}

/** Downloads the DGS page and stores its months as `dgs-ccci.csv` in the raw cache. */
export async function fetchDgsCcci(
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const res = await http.get(DGS_CCCI_URL);
  if (res.status !== 200) throw new Error(`GET ${DGS_CCCI_URL}: HTTP ${res.status}`);
  const rows = parseCcciHtml(new TextDecoder().decode(res.body));
  const f = storeBytes(
    rawDir,
    `${DGS_CCCI_ID}.csv`,
    DGS_CCCI_URL,
    new TextEncoder().encode(ccciCsv(rows))
  );
  const last = rows[rows.length - 1];
  return {
    id: DGS_CCCI_ID,
    files: [f],
    retrievedAt: now.toISOString(),
    upstreamVersion: `${last.year}-${String(last.month).padStart(2, '0')}`,
    rowCount: rows.length,
    license: DGS_CCCI_LICENSE,
    label: DGS_CCCI_LABEL,
    homepage: DGS_CCCI_URL
  };
}

/** The locked CCCI's yearly means; a lock without the source is refused. */
export function readCostIndex(lock: Lock, rawDir: string, byName: boolean): Record<number, number> {
  const entry = lock.sources.find((s) => s.id === DGS_CCCI_ID);
  if (!entry)
    throw new BuildError(`lock has no ${DGS_CCCI_ID} entry (run fetch --only ${DGS_CCCI_ID})`);
  return annualCostIndex(readFileSync(rawPath(rawDir, entry.files[0], byName), 'utf8'));
}
