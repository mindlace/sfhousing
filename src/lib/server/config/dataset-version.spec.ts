import { describe, expect, it } from 'vitest';
import { devOverride, requireDatasetVersion, resolveDatasetVersion } from './dataset-version';

function failure(fn: () => unknown): { status: number; message: string } {
  try {
    fn();
  } catch (e) {
    const err = e as { status: number; body: { message: string } };
    return { status: err.status, message: err.body.message };
  }
  throw new Error('expected a throw');
}

describe('requireDatasetVersion', () => {
  it.each(['2026-10-10-3fa9c2d1', 'fixture-0', 'fixture-12'])('returns %s unchanged', (v) => {
    expect(requireDatasetVersion(v)).toBe(v);
  });

  it('throws 500 naming the variable when missing', () => {
    const f = failure(() => requireDatasetVersion(undefined));
    expect(f.status).toBe(500);
    expect(f.message).toContain('PUBLIC_DATASET_VERSION is not set');
  });

  it('throws 500 on the empty string', () => {
    expect(failure(() => requireDatasetVersion('')).status).toBe(500);
  });

  it.each(['test-v1', '2026-10-10-3FA9C2D1'])('throws 500 echoing malformed %s', (v) => {
    const f = failure(() => requireDatasetVersion(v));
    expect(f.status).toBe(500);
    expect(f.message).toContain(`"${v}"`);
    expect(f.message).toContain('PUBLIC_DATASET_VERSION');
  });

  it('truncates absurdly long values', () => {
    const f = failure(() => requireDatasetVersion('x'.repeat(500)));
    expect(f.message.length).toBeLessThan(300);
  });

  it('names the given source and not wrangler.jsonc', () => {
    const f = failure(() => requireDatasetVersion(undefined, 'built dataset version'));
    expect(f.message).toContain('built dataset version is not set');
    expect(f.message).not.toContain('wrangler.jsonc');
  });
});

describe('resolveDatasetVersion', () => {
  const built = '2026-10-10-3fa9c2d1';

  it('serves the built version outside development, ignoring the override', () =>
    expect(resolveDatasetVersion({ built, override: 'fixture-0', development: false })).toBe(
      built
    ));

  it('honours the override in development', () =>
    expect(resolveDatasetVersion({ built, override: 'fixture-0', development: true })).toBe(
      'fixture-0'
    ));

  it('falls back to the built version in development without an override', () =>
    expect(resolveDatasetVersion({ built, override: '', development: true })).toBe(built));

  it('throws 500 naming PUBLIC_DATASET_VERSION on a malformed override in development', () => {
    const f = failure(() => resolveDatasetVersion({ built, override: 'bogus', development: true }));
    expect(f.status).toBe(500);
    expect(f.message).toContain('PUBLIC_DATASET_VERSION');
  });

  it('throws 500 naming the built version when it is malformed', () => {
    const f = failure(() =>
      resolveDatasetVersion({ built: 'bogus', override: undefined, development: false })
    );
    expect(f.status).toBe(500);
    expect(f.message).toContain('built dataset version');
  });
});

describe('devOverride', () => {
  it.each([
    [undefined, undefined],
    [{}, undefined],
    [{ PUBLIC_DATASET_VERSION: 7 }, undefined],
    [{ PUBLIC_DATASET_VERSION: 'fixture-0' }, 'fixture-0']
  ])('reads %j', (env, want) => expect(devOverride(env)).toBe(want));
});
