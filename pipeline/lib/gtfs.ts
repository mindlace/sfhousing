// Static GTFS reading (transit spec §4.2): unzip, CSV, times and the service calendar. Pure TS.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/** GTFS table basename (e.g. 'stops.txt') -> file text. */
export type GtfsFiles = Map<string, string>;

const TABLES = new Set([
  'routes.txt',
  'trips.txt',
  'stops.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt'
]);

export function gtfsFromZip(bytes: Uint8Array): GtfsFiles {
  const files = unzipSync(bytes, { filter: (f) => TABLES.has(basename(f.name)) });
  const out: GtfsFiles = new Map();
  for (const [name, data] of Object.entries(files)) out.set(basename(name), strFromU8(data));
  return out;
}

/** One `.zip` (live lock), or loose `<id>/<table>.txt` files (mini fixture). */
export function readGtfs(files: { name: string; path: string }[]): GtfsFiles {
  if (files.length === 1 && files[0].name.endsWith('.zip')) {
    return gtfsFromZip(readFileSync(files[0].path));
  }
  const out: GtfsFiles = new Map();
  for (const f of files) out.set(basename(f.name), readFileSync(f.path, 'utf8'));
  return out;
}

function* records(text: string): Generator<string[]> {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n) {
    const row: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) throw new Error('unterminated quoted CSV field');
          field += text.slice(i, q);
          i = q + 1;
          if (text[i] === '"') {
            field += '"';
            i++;
          } else break;
        }
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') i++;
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        field = text.slice(i, j);
        i = j;
      }
      row.push(field);
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;
      break;
    }
    if (!(row.length === 1 && row[0] === '')) yield row;
  }
}

export interface Csv {
  header: string[];
  col(name: string): number;
  /** Single-use: the data rows after the header. */
  rows(): Generator<string[]>;
}

export function csv(text: string | undefined): Csv {
  const it = records(text ?? '');
  const first = it.next();
  const header = first.done ? [] : first.value.map((h) => h.trim());
  const ix = new Map(header.map((h, k) => [h, k]));
  return { header, col: (name) => ix.get(name) ?? -1, rows: () => it };
}

export function at(row: string[], k: number): string {
  return k < 0 ? '' : (row[k] ?? '').trim();
}

export function parseGtfsTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s.trim());
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

const DAY_MS = 86_400_000;
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toDate = (d: string) =>
  new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)));
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export function activeServices(g: GtfsFiles, date: string): Set<string> {
  const out = new Set<string>();
  const cal = csv(g.get('calendar.txt'));
  const dow = DOW[toDate(date).getUTCDay()];
  const [sid, start, end, day] = ['service_id', 'start_date', 'end_date', dow].map(cal.col);
  for (const r of cal.rows()) {
    if (at(r, start) <= date && date <= at(r, end) && at(r, day) === '1') out.add(at(r, sid));
  }
  const cd = csv(g.get('calendar_dates.txt'));
  const [sid2, d2, type] = ['service_id', 'date', 'exception_type'].map(cd.col);
  for (const r of cd.rows()) {
    if (at(r, d2) !== date) continue;
    if (at(r, type) === '1') out.add(at(r, sid2));
    else if (at(r, type) === '2') out.delete(at(r, sid2));
  }
  return out;
}

export function calendarRange(g: GtfsFiles): { start: string; end: string } | null {
  let start = '';
  let end = '';
  const widen = (a: string, b: string) => {
    if (a && (!start || a < start)) start = a;
    if (b && (!end || b > end)) end = b;
  };
  const cal = csv(g.get('calendar.txt'));
  const [s, e] = ['start_date', 'end_date'].map(cal.col);
  for (const r of cal.rows()) widen(at(r, s), at(r, e));
  const cd = csv(g.get('calendar_dates.txt'));
  const d = cd.col('date');
  for (const r of cd.rows()) widen(at(r, d), at(r, d));
  return start && end ? { start, end } : null;
}

/**
 * Spec §4.2 step 1, per feed: the first Tuesday on or after `target` with any active service. A
 * feed whose calendar ends before `target` uses its last served Tuesday and returns a warning.
 */
export function pickServiceDate(
  g: GtfsFiles,
  target: string
): { date: string; warning: string | null } {
  const range = calendarRange(g);
  if (!range) throw new Error('feed has no calendar');
  let from = target.replaceAll('-', '');
  if (from < range.start) from = range.start;
  const d0 = toDate(from);
  for (
    let t = new Date(d0.getTime() + ((2 - d0.getUTCDay() + 7) % 7) * DAY_MS);
    ymd(t) <= range.end;
    t = new Date(t.getTime() + 7 * DAY_MS)
  ) {
    if (activeServices(g, ymd(t)).size > 0) return { date: iso(ymd(t)), warning: null };
  }
  const e0 = toDate(range.end);
  for (
    let t = new Date(e0.getTime() - ((e0.getUTCDay() - 2 + 7) % 7) * DAY_MS);
    ymd(t) >= range.start;
    t = new Date(t.getTime() - 7 * DAY_MS)
  ) {
    if (activeServices(g, ymd(t)).size > 0) {
      return {
        date: iso(ymd(t)),
        warning: `calendar ends ${range.end}, before ${target}: using ${iso(ymd(t))}`
      };
    }
  }
  throw new Error(`no Tuesday with service in ${range.start}..${range.end}`);
}

export function feedVersion(g: GtfsFiles): string {
  const fi = csv(g.get('feed_info.txt'));
  const k = fi.col('feed_version');
  for (const r of fi.rows()) if (at(r, k)) return at(r, k);
  const range = calendarRange(g);
  return range ? `${range.start}..${range.end}` : 'unknown';
}
