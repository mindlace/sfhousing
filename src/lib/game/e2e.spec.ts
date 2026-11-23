import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { E2E_GAME_KEY, E2E_GOAL_KEY, e2eGoalAmount, e2eOpen } from './e2e';

afterEach(() => vi.unstubAllEnvs());

function throwing(): Storage {
  const s = new MemoryStorage();
  s.getItem = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return s;
}

function goal(value: string): Storage {
  const s = new MemoryStorage();
  s.setItem(E2E_GOAL_KEY, value);
  return s;
}

describe('the e2e seam', () => {
  it('with VITE_E2E unset, e2eOpen is false', () => {
    vi.stubEnv('VITE_E2E', undefined);
    expect(e2eOpen(new MemoryStorage())).toBe(false);
    expect(e2eOpen(null)).toBe(false);
  });
  it('with VITE_E2E unset, e2eGoalAmount is null', () => {
    vi.stubEnv('VITE_E2E', undefined);
    expect(e2eGoalAmount(goal('5000'))).toBeNull();
  });
  it('e2eOpen is true with storage null, empty storage, and a throwing getItem', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eOpen(null)).toBe(true);
    expect(e2eOpen(new MemoryStorage())).toBe(true);
    expect(e2eOpen(throwing())).toBe(true);
  });
  it('e2eOpen is false while E2E_GAME_KEY holds a value', () => {
    vi.stubEnv('VITE_E2E', '1');
    for (const v of ['1', '']) {
      const s = new MemoryStorage();
      s.setItem(E2E_GAME_KEY, v);
      expect(e2eOpen(s)).toBe(false);
    }
  });
  it('e2eGoalAmount reads whole numbers', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eGoalAmount(goal('5000'))).toBe(5000);
    expect(e2eGoalAmount(goal('1'))).toBe(1);
  });
  it('e2eGoalAmount is null for anything else', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eGoalAmount(null)).toBeNull();
    expect(e2eGoalAmount(new MemoryStorage())).toBeNull();
    for (const v of [
      '0',
      '-3',
      '12.5',
      ' 40',
      '1e3',
      'abc',
      '',
      '9007199254740993',
      '00',
      '+5',
      '5\n',
      '0x10'
    ]) {
      expect(e2eGoalAmount(goal(v)), JSON.stringify(v)).toBeNull();
    }
    expect(e2eGoalAmount(throwing())).toBeNull();
  });
  it('e2eGoalAmount takes leading zeros and the largest safe integer', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eGoalAmount(goal('007'))).toBe(7);
    expect(e2eGoalAmount(goal('9007199254740991'))).toBe(9007199254740991);
  });
  it('reads VITE_E2E on every call', () => {
    const s = new MemoryStorage();
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eOpen(s)).toBe(true);
    vi.stubEnv('VITE_E2E', undefined);
    expect(e2eOpen(s)).toBe(false);
    vi.stubEnv('VITE_E2E', '1');
    expect(e2eOpen(s)).toBe(true);
  });
});
