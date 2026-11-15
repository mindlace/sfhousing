import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/environment', () => ({
  get dev() {
    return flags.dev;
  }
}));

import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { fakeSimEnv } from '$lib/server/test/sim-env';
import type { SimEnv } from '$lib/server/sim-object/stub';
import { addMemberById, getRole } from './sim-index';
import { removeSimMember } from './sims';
import {
  REREAD_ATTEMPTS,
  REREAD_TIMEOUT_MS,
  ROSTER_FANOUT,
  onSimRosterChanged,
  rosterChangedAll
} from './roster-hook';

function fakeSim(reread: () => Promise<void>) {
  const names: string[] = [];
  const env = fakeSimEnv((n) => (names.push(n), { rereadRoles: reread }));
  return { env, names };
}

afterEach(() => {
  flags.dev = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('onSimRosterChanged', () => {
  it('does nothing without the binding', async () => {
    const { error } = mockConsole('error');
    // An env from a deployment without the binding.
    const noBinding = {} as NonNullable<SimEnv>;
    await expect(onSimRosterChanged(noBinding, 'sim-1')).resolves.toBeUndefined();
    await expect(onSimRosterChanged(undefined, 'sim-1')).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('does nothing under npm run dev, even with a binding', async () => {
    flags.dev = true;
    const { error } = mockConsole('error');
    const reread = vi.fn(async () => {});
    await onSimRosterChanged(fakeSim(reread).env, 'sim-1');
    expect(reread).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('re-reads once on success, on the named object', async () => {
    const reread = vi.fn(async () => {});
    const { env, names } = fakeSim(reread);
    await onSimRosterChanged(env, 'sim-1');
    expect(reread).toHaveBeenCalledOnce();
    expect(names).toEqual(['sim-1']);
  });

  it('retries once on a fresh stub, and logs nothing when the retry succeeds', async () => {
    const { error } = mockConsole('error');
    const reread = vi
      .fn()
      .mockRejectedValueOnce(new Error('role read failed'))
      .mockResolvedValue(undefined);
    const { env, names } = fakeSim(reread);
    await onSimRosterChanged(env, 'sim-1');
    expect(names).toEqual(['sim-1', 'sim-1']);
    expect(error).not.toHaveBeenCalled();
  });

  it('never rejects: after the last failure it logs the sim id and safe text only', async () => {
    const { error } = mockConsole('error');
    const reread = vi.fn(async () => {
      throw new Error('role read failed');
    });
    await expect(onSimRosterChanged(fakeSim(reread).env, 'sim-1')).resolves.toBeUndefined();
    expect(reread).toHaveBeenCalledTimes(REREAD_ATTEMPTS);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]).toEqual([
      '[roster-hook] reread failed',
      'sim-1',
      'role read failed'
    ]);
  });

  it('never rejects when getting the stub itself throws', async () => {
    const { error } = mockConsole('error');
    const getByName = vi.fn(() => {
      throw new Error('no such namespace');
    });
    await expect(onSimRosterChanged(fakeSimEnv(getByName), 'sim-1')).resolves.toBeUndefined();
    expect(getByName).toHaveBeenCalledTimes(REREAD_ATTEMPTS);
    expect(error).toHaveBeenCalledOnce();
  });

  it('does not retry an overloaded object', async () => {
    const { error } = mockConsole('error');
    const reread = vi.fn(async () => {
      throw Object.assign(new Error('Durable Object is overloaded.'), { overloaded: true });
    });
    await onSimRosterChanged(fakeSim(reread).env, 'sim-1');
    expect(reread).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('bounds each attempt: a call that never settles times out, and the hook still resolves', async () => {
    vi.useFakeTimers();
    const { error } = mockConsole('error');
    const reread = vi.fn(() => new Promise<void>(() => {}));
    const { env, names } = fakeSim(reread);
    let settled = false;
    const done = onSimRosterChanged(env, 'sim-1').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REREAD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(names).toEqual(['sim-1']);
    await vi.advanceTimersByTimeAsync(REREAD_TIMEOUT_MS * REREAD_ATTEMPTS);
    await done;
    expect(settled).toBe(true);
    expect(names).toEqual(['sim-1', 'sim-1']);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]).toEqual([
      '[roster-hook] reread failed',
      'sim-1',
      'reread timed out'
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind after a successful attempt', async () => {
    vi.useFakeTimers();
    const reread = vi.fn(async () => {});
    await onSimRosterChanged(fakeSim(reread).env, 'sim-1');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('rosterChangedAll', () => {
  it('tells every sim, at most ROSTER_FANOUT at a time, and never rejects', async () => {
    mockConsole('error');
    let running = 0;
    let peak = 0;
    const reread = vi.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      throw new Error('role read failed');
    });
    const ids = Array.from({ length: 20 }, (_, i) => `sim-${i}`);
    const { env, names } = fakeSim(reread);
    await expect(rosterChangedAll(env, ids)).resolves.toBeUndefined();
    expect(new Set(names)).toEqual(new Set(ids));
    expect(peak).toBeLessThanOrEqual(ROSTER_FANOUT);
    expect(peak).toBeGreaterThan(1);
  });

  it('resolves at once for no sims', async () => {
    const reread = vi.fn(async () => {});
    await expect(rosterChangedAll(fakeSim(reread).env, [])).resolves.toBeUndefined();
    expect(reread).not.toHaveBeenCalled();
  });
});

describe('the roster change stands', () => {
  it('a removal stands when every re-read fails', async () => {
    mockConsole('error');
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    const reread = vi.fn(async () => {
      throw new Error('role read failed');
    });
    const { env, names } = fakeSim(reread);
    await expect(removeSimMember({ db, env, simId, userId: 'ed' })).resolves.toEqual({
      empty: false
    });
    expect(await getRole({ db, simId, userId: 'ed' })).toBeNull();
    expect(names).toEqual([simId, simId]);
  });

  it('the roster is written before the object is asked to re-read it', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    await seedUser(db, { id: 'ed', email: 'e@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    await addMemberById({ db, simId, userId: 'ed', role: 'editor' });
    const seen: (string | null)[] = [];
    const { env } = fakeSim(async () => {
      seen.push(await getRole({ db, simId, userId: 'ed' }));
    });
    await removeSimMember({ db, env, simId, userId: 'ed' });
    expect(seen).toEqual([null]);
  });

  it('the last member leaving still asks the object to re-read, after the change is written', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'owner1', email: 'm@test.com' });
    const simId = await seedSim(db, { title: 'Q', managerId: 'owner1' });
    const seen: (string | null)[] = [];
    const { env, names } = fakeSim(async () => {
      seen.push(await getRole({ db, simId, userId: 'owner1' }));
    });
    await expect(removeSimMember({ db, env, simId, userId: 'owner1' })).resolves.toEqual({
      empty: true
    });
    expect(seen).toEqual([null]);
    expect(names).toEqual([simId]);
  });
});
