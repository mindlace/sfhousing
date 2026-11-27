// The DGS California Construction Cost Index as a fetched source (building-choice Task 13a, fix
// round 2): fetched into the raw cache and pinned in the lock, never committed. Every value here
// is synthetic.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Http } from '../lib/http';
import { rawPath, type Lock } from '../lib/lock';
import {
  DGS_CCCI_ID,
  DGS_CCCI_URL,
  annualCostIndex,
  ccciCsv,
  fetchDgsCcci,
  parseCcciHtml,
  readCostIndex
} from '../sources/dgs';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'dgs-ccci-'));
  temps.push(d);
  return d;
};

const td = (v: string) => `<td style="text-align: left;">${v}</td>`;
const row = (month: string, cells: string[]) =>
  `<tr><td style="text-align: left;"><strong>${month}</strong></td>${cells.map(td).join('')}</tr>`;
const table = (years: number[], rows: string[]) =>
  `<table class="table"><thead><tr><th><strong>Month</strong></th>${years
    .map((y) => `<th><strong>${y}</strong></th>`)
    .join('')}</tr></thead><tbody>${rows.join('\n')}</tbody></table>`;

/** Two tables in the page's layout: years as columns, months as rows, blanks for the future. */
const PAGE =
  '<html><body><p>CCCI</p>' +
  table([2031, 2030], [row('January', ['', '200']), row('February', ['', '210'])]) +
  table(
    [2029],
    [row('January', ['100']), row('February', ['110']), row('Annual Percent Change', ['4.0%'])]
  ) +
  '</body></html>';

describe('parseCcciHtml', () => {
  it('reads every month of every table, skipping blanks and non-month rows', () => {
    expect(parseCcciHtml(PAGE)).toEqual([
      { year: 2029, month: 1, value: 100 },
      { year: 2029, month: 2, value: 110 },
      { year: 2030, month: 1, value: 200 },
      { year: 2030, month: 2, value: 210 }
    ]);
  });

  it('refuses a page with no month values', () => {
    expect(() => parseCcciHtml('<html></html>')).toThrow(/no CCCI month values/);
  });
});

describe('annualCostIndex', () => {
  it('is the mean of each year’s months, a partial year over the months it has', () => {
    const csv = ccciCsv(parseCcciHtml(PAGE).concat([{ year: 2030, month: 3, value: 230 }]));
    expect(annualCostIndex(csv)).toEqual({ 2029: 105, 2030: 640 / 3 });
  });
});

describe('fetchDgsCcci', () => {
  it('stores the parsed months as a CSV in the raw cache and describes it for the lock', async () => {
    const raw = temp();
    const http: Http = {
      get: async (url) => {
        expect(url).toBe(DGS_CCCI_URL);
        return { status: 200, headers: new Headers(), body: new TextEncoder().encode(PAGE) };
      }
    };
    const e = await fetchDgsCcci(raw, http, new Date('2026-11-27T00:00:00Z'));
    expect(e.id).toBe(DGS_CCCI_ID);
    expect(e.rowCount).toBe(4);
    expect(e.files).toHaveLength(1);
    expect(e.license).toMatch(/not stated/i);
    const csv = readFileSync(rawPath(raw, e.files[0]), 'utf8');
    expect(csv).toBe(ccciCsv(parseCcciHtml(PAGE)));
  });

  it('refuses an HTTP error', async () => {
    const http: Http = {
      get: async () => ({ status: 503, headers: new Headers(), body: new Uint8Array() })
    };
    await expect(fetchDgsCcci(temp(), http)).rejects.toThrow(/HTTP 503/);
  });
});

describe('readCostIndex', () => {
  it('reads the locked CSV into yearly means', async () => {
    const raw = temp();
    const http: Http = {
      get: async () => ({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(PAGE)
      })
    };
    const lock: Lock = { sources: [await fetchDgsCcci(raw, http)] };
    expect(readCostIndex(lock, raw, false)).toEqual({ 2029: 105, 2030: 205 });
  });

  it('refuses a lock without the source, naming the fetch to run', () => {
    expect(() => readCostIndex({ sources: [] }, temp(), false)).toThrow(
      /lock has no dgs-ccci entry \(run fetch --only dgs-ccci\)/
    );
  });
});
