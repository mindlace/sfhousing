import { describe, expect, it } from 'vitest';
import {
  COLLECT_KEY,
  DEFAULT_COLLECT,
  DEFAULT_MUTED,
  MUTED_KEY,
  onPrefs,
  readCollectForMe,
  readMuted,
  writeCollectForMe,
  writeMuted
} from './prefs';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v)
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail
  };
}

/** Run `body` with listeners; every one added is removed afterwards. */
function withListeners(body: (add: (fn: () => void) => void) => void): void {
  const removers: Array<() => void> = [];
  try {
    body((fn) => removers.push(onPrefs(fn)));
  } finally {
    for (const remove of removers) remove();
  }
}

describe('prefs reads', () => {
  it('has the documented keys and defaults', () => {
    expect(COLLECT_KEY).toBe('sfhousing:run:collect');
    expect(MUTED_KEY).toBe('sfhousing:run:muted');
    expect(DEFAULT_COLLECT).toBe(false);
    expect(DEFAULT_MUTED).toBe(false);
  });

  it('reads the defaults: null storage, missing key, bad value, throwing storage', () => {
    const bad = memoryStorage({ [COLLECT_KEY]: 'true', [MUTED_KEY]: 'true' });
    for (const s of [null, memoryStorage(), bad, throwingStorage()]) {
      expect(readCollectForMe(s)).toBe(false);
      expect(readMuted(s)).toBe(false);
    }
  });

  it("round-trips '1' and '0' for both keys", () => {
    const s = memoryStorage();
    writeCollectForMe(s, true);
    expect(s.getItem(COLLECT_KEY)).toBe('1');
    expect(readCollectForMe(s)).toBe(true);
    writeCollectForMe(s, false);
    expect(s.getItem(COLLECT_KEY)).toBe('0');
    expect(readCollectForMe(s)).toBe(false);
    writeMuted(s, true);
    expect(s.getItem(MUTED_KEY)).toBe('1');
    expect(readMuted(s)).toBe(true);
    writeMuted(s, false);
    expect(s.getItem(MUTED_KEY)).toBe('0');
    expect(readMuted(s)).toBe(false);
  });

  it('keeps the two keys apart', () => {
    const s = memoryStorage();
    writeMuted(s, true);
    expect(readCollectForMe(s)).toBe(false);
    expect(readMuted(s)).toBe(true);
  });

  it('swallows a throwing write', () => {
    expect(() => writeMuted(throwingStorage(), true)).not.toThrow();
    expect(() => writeCollectForMe(throwingStorage(), true)).not.toThrow();
    expect(() => writeMuted(null, true)).not.toThrow();
  });
});

describe('onPrefs', () => {
  it('calls every listener once per write, in order added', () => {
    const order: string[] = [];
    withListeners((add) => {
      add(() => order.push('a'));
      add(() => order.push('b'));
      writeCollectForMe(memoryStorage(), true);
      expect(order).toEqual(['a', 'b']);
      writeMuted(memoryStorage(), true);
      expect(order).toEqual(['a', 'b', 'a', 'b']);
    });
  });

  it('notifies with null storage and with a throwing storage', () => {
    let calls = 0;
    withListeners((add) => {
      add(() => calls++);
      writeCollectForMe(null, true);
      writeMuted(null, true);
      writeCollectForMe(throwingStorage(), true);
      writeMuted(throwingStorage(), true);
      expect(calls).toBe(4);
    });
  });

  it('a throwing listener does not stop the next', () => {
    const order: string[] = [];
    withListeners((add) => {
      add(() => {
        throw new Error('listener failed');
      });
      add(() => order.push('next'));
      expect(() => writeMuted(memoryStorage(), true)).not.toThrow();
      expect(order).toEqual(['next']);
    });
  });

  it('the returned function removes the listener', () => {
    let calls = 0;
    const remove = onPrefs(() => calls++);
    try {
      writeMuted(null, true);
      expect(calls).toBe(1);
    } finally {
      remove();
    }
    writeMuted(null, true);
    expect(calls).toBe(1);
  });
});
