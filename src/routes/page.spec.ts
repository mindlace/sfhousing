import { isHttpError } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestUrl, parseManifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import { load } from './+page';

type LoadEvent = Parameters<typeof load>[0];

function event(datasetVersion: string, fetchFn: (url: string) => Promise<Response>): LoadEvent {
  return {
    fetch: fetchFn,
    parent: async () => ({ datasetVersion, appRelease: 'dev' })
  } as unknown as LoadEvent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('/ load (I16)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty plan on the current version and its manifest', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe(manifestUrl('fixture-0'));
      return json(manifestJson);
    });
    const result = await load(event('fixture-0', fetchFn));
    expect(result).toEqual({
      plan: emptyPlan('fixture-0'),
      manifest: parseManifest(manifestJson),
      fellBack: false,
      manifestError: false
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a manifest failure as manifestError without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await load(event('fixture-0', async () => json({ error: 'boom' }, 500)));
    expect(result).toEqual({
      plan: emptyPlan('fixture-0'),
      manifest: null,
      fellBack: false,
      manifestError: true
    });
    expect(err).toHaveBeenCalled();
  });

  it('throws a 500 HttpError on an invalid dataset version from the layout', async () => {
    const fetchFn = vi.fn(async () => json(manifestJson));
    let thrown: unknown = null;
    try {
      await load(event('not a version', fetchFn));
    } catch (e) {
      thrown = e;
    }
    expect(isHttpError(thrown, 500)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
