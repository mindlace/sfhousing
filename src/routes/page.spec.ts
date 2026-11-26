import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestUrl, parseManifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import { parseCalibration } from '$lib/timelapse/model';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { load } from './+page';
import { load as simLoad } from './sim/+page';

type LoadEvent = Parameters<typeof load>[0];
type FetchFn = (url: string) => Promise<Response>;

const CAL_URL = manifestJson.scenarios.fzp.calibration;

function event(datasetVersion: string, fetchFn: FetchFn): LoadEvent {
  return {
    fetch: fetchFn,
    parent: async () => ({ datasetVersion, appRelease: 'dev' })
  } as unknown as LoadEvent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The fixture's manifest and calibration by URL; any other fetch throws. */
function files(over: Record<string, () => Response> = {}): ReturnType<typeof vi.fn<FetchFn>> {
  const table: Record<string, () => Response> = {
    [manifestUrl('fixture-0')]: () => json(manifestJson),
    [CAL_URL]: () => json(calibrationJson),
    ...over
  };
  return vi.fn<FetchFn>(async (url) => {
    const f = table[url];
    if (!f) throw new Error(`unexpected fetch ${url}`);
    return f();
  });
}

describe('/ load (one address)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty plan on the current version, the manifest and the calibration, each fetched once', async () => {
    const fetchFn = files();
    const result = await load(event('fixture-0', fetchFn));
    expect(result).toEqual({
      plan: emptyPlan('fixture-0'),
      manifest: parseManifest(manifestJson),
      manifestError: false,
      calibration: parseCalibration(calibrationJson),
      calibrationError: false,
      noScenario: false
    });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([manifestUrl('fixture-0'), CAL_URL]);
    expect('fellBack' in (result as object)).toBe(false);
  });

  it('a manifest failure gives manifestError and no calibration, and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await load(
      event('fixture-0', files({ [manifestUrl('fixture-0')]: () => json({}, 500) }))
    );
    expect(result).toEqual({
      plan: emptyPlan('fixture-0'),
      manifest: null,
      manifestError: true,
      calibration: null,
      calibrationError: false,
      noScenario: false
    });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('a calibration failure gives calibrationError with the plan and the manifest', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await load(event('fixture-0', files({ [CAL_URL]: () => json({}, 404) })));
    expect(result).toMatchObject({
      plan: emptyPlan('fixture-0'),
      manifestError: false,
      calibration: null,
      calibrationError: true
    });
    expect((result as { manifest: unknown }).manifest).not.toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('throws a 500 HttpError on an invalid dataset version from the layout', async () => {
    const fetchFn = files();
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

describe('/sim load', () => {
  it("/sim's load throws a 308 redirect to /, whatever the query", () => {
    for (const search of ['', '?seed=5&x=1']) {
      let thrown: unknown = null;
      try {
        simLoad({ url: new URL(`http://localhost/sim${search}`) } as Parameters<typeof simLoad>[0]);
      } catch (e) {
        thrown = e;
      }
      expect(isRedirect(thrown)).toBe(true);
      expect(thrown).toMatchObject({ status: 308, location: '/' });
    }
  });
});
