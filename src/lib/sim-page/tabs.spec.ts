import { describe, expect, it } from 'vitest';
import { SIM_TABS, simTabs, tabOrFirst } from './tabs';

describe('simTabs', () => {
  it('offers all four tabs with a calibration', () => {
    expect(simTabs(true).map((t) => t.id)).toEqual(['transit', 'paint', 'permits', 'protect']);
    expect(simTabs(true)).toEqual([...SIM_TABS]);
  });

  it('drops Permits without a calibration', () => {
    expect(simTabs(false).map((t) => t.id)).toEqual(['transit', 'paint', 'protect']);
  });
});

describe('tabOrFirst', () => {
  it('keeps a tab that is offered', () => {
    expect(tabOrFirst(simTabs(true), 'permits')).toBe('permits');
  });

  it('falls back to the first tab when the active one is gone', () => {
    expect(tabOrFirst(simTabs(false), 'permits')).toBe('transit');
  });
});
