import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  activeServices,
  at,
  calendarRange,
  csv,
  feedVersion,
  gtfsFromZip,
  parseGtfsTime,
  pickServiceDate,
  readGtfs,
  type GtfsFiles
} from '../lib/gtfs';

const CAL =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'WK,1,1,1,1,1,0,0,20260901,20261231\nSA,0,0,0,0,0,1,0,20260901,20261231\n';
const files = (extra: Record<string, string> = {}): GtfsFiles =>
  new Map(Object.entries({ 'calendar.txt': CAL, ...extra }));

describe('csv', () => {
  it('handles a BOM, quotes, escaped quotes, CRLF and a trailing newline', () => {
    const c = csv('﻿a,b,c\r\n1,"x, ""y""",3 \r\n\r\n4,5,6\n');
    expect(c.header).toEqual(['a', 'b', 'c']);
    const rows = [...c.rows()];
    expect(rows).toEqual([
      ['1', 'x, "y"', '3 '],
      ['4', '5', '6']
    ]);
    expect(at(rows[0], c.col('c'))).toBe('3');
    expect(at(rows[0], c.col('missing'))).toBe('');
  });

  it('treats a missing file as empty', () => {
    expect(csv(undefined).header).toEqual([]);
  });
});

describe('parseGtfsTime', () => {
  it('parses times past midnight and rejects blanks', () => {
    expect(parseGtfsTime('07:30:15')).toBe(7 * 3600 + 30 * 60 + 15);
    expect(parseGtfsTime('25:10:00')).toBe(25 * 3600 + 600);
    expect(parseGtfsTime(' 7:05:00')).toBe(7 * 3600 + 300);
    expect(parseGtfsTime('')).toBeNull();
  });
});

describe('service calendar', () => {
  it('honours weekday flags, ranges and calendar_dates exceptions', () => {
    const g = files({
      'calendar_dates.txt':
        'service_id,date,exception_type\nWK,20261013,2\nHOL,20261013,1\nWK,20261014,2\n'
    });
    expect([...activeServices(g, '20261013')]).toEqual(['HOL']);
    expect([...activeServices(g, '20261020')]).toEqual(['WK']);
    expect([...activeServices(g, '20261017')]).toEqual(['SA']);
    expect([...activeServices(g, '20270105')]).toEqual([]);
  });

  it('works for a feed with only calendar_dates', () => {
    const g: GtfsFiles = new Map([
      ['calendar_dates.txt', 'service_id,date,exception_type\nX,20261013,1\n']
    ]);
    expect(calendarRange(g)).toEqual({ start: '20261013', end: '20261013' });
    expect([...activeServices(g, '20261013')]).toEqual(['X']);
  });
});

describe('pickServiceDate', () => {
  it('picks the first Tuesday on or after the target with service', () => {
    expect(pickServiceDate(files(), '2026-10-10')).toEqual({ date: '2026-10-13', warning: null });
    expect(pickServiceDate(files(), '2026-10-13')).toEqual({ date: '2026-10-13', warning: null });
  });

  it('skips a Tuesday removed by calendar_dates', () => {
    const g = files({ 'calendar_dates.txt': 'service_id,date,exception_type\nWK,20261013,2\n' });
    expect(pickServiceDate(g, '2026-10-10').date).toBe('2026-10-20');
  });

  it('starts at the feed start when the target is earlier', () => {
    expect(pickServiceDate(files(), '2026-01-01').date).toBe('2026-09-01');
  });

  it('falls back to the last served Tuesday, with a warning, when the calendar has ended', () => {
    const g = files({
      'calendar.txt':
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
        '1,1,1,1,1,1,0,0,20260723,20260828\n'
    });
    const r = pickServiceDate(g, '2026-10-14');
    expect(r.date).toBe('2026-08-25');
    expect(r.warning).toMatch(/calendar ends 20260828/);
  });

  it('throws when no Tuesday has service', () => {
    const g = files({
      'calendar.txt':
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
        'SA,0,0,0,0,0,1,0,20260901,20261231\n'
    });
    expect(() => pickServiceDate(g, '2026-10-10')).toThrow(/no Tuesday/);
  });
});

describe('reading feeds', () => {
  it('reads a zip (keeping only GTFS tables) and loose files the same way', () => {
    const zip = zipSync({
      'stops.txt': strToU8('stop_id\n1\n'),
      'shapes.txt': strToU8('ignored'),
      'nested/calendar.txt': strToU8(CAL)
    });
    const z = gtfsFromZip(zip);
    expect([...z.keys()].sort()).toEqual(['calendar.txt', 'stops.txt']);
    const dir = mkdtempSync(join(tmpdir(), 'sfh-gtfs-'));
    writeFileSync(join(dir, 'feed.zip'), zip);
    writeFileSync(join(dir, 'stops.txt'), 'stop_id\n1\n');
    expect(readGtfs([{ name: 'gtfs-x.zip', path: join(dir, 'feed.zip') }]).get('stops.txt')).toBe(
      'stop_id\n1\n'
    );
    expect(
      readGtfs([{ name: 'gtfs-x/stops.txt', path: join(dir, 'stops.txt') }]).get('stops.txt')
    ).toBe('stop_id\n1\n');
  });

  it('versions a feed by feed_info.feed_version, else by calendar range', () => {
    expect(
      feedVersion(files({ 'feed_info.txt': 'feed_publisher_name,feed_version\nX,72\n' }))
    ).toBe('72');
    expect(feedVersion(files())).toBe('20260901..20261231');
  });
});
