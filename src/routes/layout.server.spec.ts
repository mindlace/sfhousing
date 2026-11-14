import { describe, expect, it, vi } from 'vitest';
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));
const userHasPasskey = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/user-store/passkey', () => ({ userHasPasskey }));
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));

import { load } from './+layout.server';

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    return (e as { status: number }).status;
  }
  throw new Error('expected load to throw');
}

describe('root layout load', () => {
  it('serves the built version', async () => {
    const result = await load({} as never);
    expect(result).toEqual({
      datasetVersion: __SFH_DATASET_VERSION__,
      appRelease: 'dev',
      user: null
    });
    expect(__SFH_DATASET_VERSION__).toMatch(DATASET_VERSION_RE);
  });

  it('ignores the override outside development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'production', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({
      datasetVersion: __SFH_DATASET_VERSION__,
      appRelease: 'dev',
      user: null
    });
  });

  it('honours the override when ENVIRONMENT is development', async () => {
    const result = await load({
      platform: { env: { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'fixture-0' } }
    } as never);
    expect(result).toEqual({ datasetVersion: 'fixture-0', appRelease: 'dev', user: null });
  });

  it('passes the signed-in user through from locals', async () => {
    const user = { id: 'ident-1', email: 'alice@example.com', handle: 'alice' };
    const result = await load({ locals: { user } } as never);
    expect(result).toEqual({ datasetVersion: __SFH_DATASET_VERSION__, appRelease: 'dev', user });
  });

  it('serves user: null to a signed-out visitor', async () => {
    const result = await load({ locals: { user: null } } as never);
    expect(result).toMatchObject({ user: null });
  });

  describe('known-device refresh', () => {
    const cookiesFor = (known = false) => {
      const set = vi.fn();
      return { set, get: (n: string) => (known && n === 'sfh_known' ? '1' : undefined) };
    };

    async function run(opts: { pseudonymous: boolean; passkey: boolean; known?: boolean }) {
      const cookies = cookiesFor(opts.known);
      userHasPasskey.mockResolvedValue(opts.passkey);
      await load({
        platform: { env: {} },
        locals: {
          user: { id: 'ident-1', pseudonymous: opts.pseudonymous },
          session: { id: 's1', userId: 'live-1' }
        },
        cookies
      } as never);
      return cookies.set;
    }

    it('marks the device known for a registered user', async () => {
      const set = await run({ pseudonymous: false, passkey: false });
      expect(set).toHaveBeenCalledWith('sfh_known', '1', expect.anything());
    });

    it('marks the device known for a pseudonymous user with a passkey', async () => {
      const set = await run({ pseudonymous: true, passkey: true });
      expect(set).toHaveBeenCalledWith('sfh_known', '1', expect.anything());
    });

    it('leaves a pseudonymous user without a passkey unmarked', async () => {
      const set = await run({ pseudonymous: true, passkey: false });
      expect(set).not.toHaveBeenCalled();
    });

    it('does not re-set an existing marker', async () => {
      const set = await run({ pseudonymous: false, passkey: false, known: true });
      expect(set).not.toHaveBeenCalled();
    });

    it('never reads the passkey table when signed out', async () => {
      userHasPasskey.mockClear();
      await load({ locals: { user: null }, cookies: cookiesFor() } as never);
      expect(userHasPasskey).not.toHaveBeenCalled();
    });
  });

  it('throws 500 on a malformed override in development', () => {
    expect(
      status(() =>
        load({
          platform: { env: { ENVIRONMENT: 'development', PUBLIC_DATASET_VERSION: 'bogus' } }
        } as never)
      )
    ).toBe(500);
  });
});
