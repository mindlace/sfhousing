// Entitlement expiry arithmetic (Rulings IL1, SE1; rule.json modelingRule).
import { describe, expect, it } from 'vitest';
import {
  affordableExempt,
  discretionaryExpiry,
  streamlinedExpiry
} from '../../project-records/entitlement';

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

describe('discretionaryExpiry', () => {
  // Each extension case, with the measurement value where it lists one.
  const TABLE: [string, string, string][] = [
    ['2016-02-05', '2019-02-05', 'plain 3 years'],
    ['2018-06-04', '2022-12-04', 'AB 1561 beats the 365-day ZA overlap'],
    ['2018-12-27', '2023-06-27', 'AB 1561: due 2021-12-27, before 2021-12-31'],
    ['2019-01-07', '2023-01-07', 'ZA overlap 365 days (due after 2021-12-31: no AB 1561)'],
    ['2019-10-23', '2023-10-23', 'ZA overlap 365 days'],
    ['2020-03-04', '2025-09-03', 'ZA 365 days to 2024-03-03, then AB 2729'],
    ['2020-06-24', '2025-09-16', 'ZA overlap from entitled: 266 days, then AB 2729'],
    ['2021-02-12', '2025-09-16', 'ZA overlap 33 days, then AB 2729'],
    ['2021-03-05', '2025-09-17', 'ZA overlap 12 days, then AB 2729'],
    ['2021-05-04', '2025-11-04', 'AB 2729 only'],
    ['2022-01-19', '2026-07-19', 'AB 2729 only'],
    ['2023-01-12', '2026-01-12', 'due 2026-01-12, after 2025-12-31: none'],
    ['2023-10-03', '2026-10-03', 'plain 3 years']
  ];
  it.each(TABLE)('%s -> %s (%s)', (entitled, expiry) => {
    expect(iso(discretionaryExpiry(d(entitled)))).toBe(expiry);
  });

  // Every distinct candidateLapses row of the measurement (evidence/entitlement-expiry, asOf
  // 2026-10-17): entitled -> ruleExpiry.
  const MEASURED: [string, string][] = [
    ['2016-02-05', '2019-02-05'],
    ['2016-05-21', '2019-05-21'],
    ['2016-07-27', '2019-07-27'],
    ['2018-06-04', '2022-12-04'],
    ['2018-06-06', '2022-12-06'],
    ['2018-09-12', '2023-03-12'],
    ['2018-12-19', '2023-06-19'],
    ['2018-12-27', '2023-06-27'],
    ['2019-01-07', '2023-01-07'],
    ['2019-01-11', '2023-01-11'],
    ['2019-02-20', '2023-02-20'],
    ['2019-02-28', '2023-02-28'],
    ['2019-05-06', '2023-05-06'],
    ['2019-10-11', '2023-10-11'],
    ['2019-10-23', '2023-10-23'],
    ['2020-03-04', '2025-09-03'],
    ['2020-06-24', '2025-09-16'],
    ['2020-09-11', '2025-09-16'],
    ['2021-02-12', '2025-09-16'],
    ['2021-03-05', '2025-09-17'],
    ['2021-05-04', '2025-11-04'],
    ['2021-05-12', '2025-11-12'],
    ['2021-06-09', '2025-12-09'],
    ['2022-01-19', '2026-07-19'],
    ['2022-02-01', '2026-08-01'],
    ['2022-02-24', '2026-08-24'],
    ['2023-01-12', '2026-01-12'],
    ['2023-03-09', '2026-03-09'],
    ['2023-03-23', '2026-03-23'],
    ['2023-04-20', '2026-04-20'],
    ['2023-07-31', '2026-07-31'],
    ['2023-08-02', '2026-08-02'],
    ['2023-09-19', '2026-09-19'],
    ['2023-10-03', '2026-10-03']
  ];
  it.each(MEASURED)('measurement: %s -> %s', (entitled, expiry) => {
    expect(iso(discretionaryExpiry(d(entitled)))).toBe(expiry);
  });

  it('adds 18 months clamped to the month end, and Feb 29 + 3 years is Feb 28', () => {
    // 2018-08-31 + 3 y = 2021-08-31 (AB 1561) + 18 months = 2023-02-28; ZA 365 d gives 2022-08-31.
    expect(iso(discretionaryExpiry(d('2018-08-31')))).toBe('2023-02-28');
    expect(iso(discretionaryExpiry(d('2016-02-29')))).toBe('2019-02-28');
  });
});

describe('streamlinedExpiry', () => {
  it('3 years plus the one-time year, with AB 1561 and AB 2729 but no ZA overlap', () => {
    expect(iso(streamlinedExpiry(d('2016-05-01')))).toBe('2020-05-01');
    // AB 1561: due 2021-06-01 -> 2022-12-01, then + 1 y.
    expect(iso(streamlinedExpiry(d('2018-06-01')))).toBe('2023-12-01');
    // No ZA overlap: due 2023-01-07, + 1 y.
    expect(iso(streamlinedExpiry(d('2020-01-07')))).toBe('2024-01-07');
    // AB 2729: due 2024-05-04 -> 2025-11-04, then + 1 y.
    expect(iso(streamlinedExpiry(d('2021-05-04')))).toBe('2026-11-04');
    expect(iso(streamlinedExpiry(d('2023-01-12')))).toBe('2027-01-12');
  });
});

describe('affordableExempt', () => {
  it('half or more affordable is exempt; a missing count or no units is not', () => {
    expect(affordableExempt(119, 119)).toBe(true);
    expect(affordableExempt(5, 10)).toBe(true);
    expect(affordableExempt(4, 10)).toBe(false);
    expect(affordableExempt(null, 10)).toBe(false);
    expect(affordableExempt(3, null)).toBe(false);
    expect(affordableExempt(0, 0)).toBe(false);
  });
});
