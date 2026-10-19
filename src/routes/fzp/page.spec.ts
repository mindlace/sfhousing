// The /fzp universal load (spec §4.1): manifest, calibration, scenario presence and the URL seed.
// Every failure is a flag, never a thrown 500.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestUrl, parseManifest } from '$lib/data/manifest';
import { parseCalibration } from '$lib/timelapse/model';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { load as rawLoad, type FzpPageData } from './+page';

const load = async (e: LoadEvent) => (await rawLoad(e)) as FzpPageData;

type LoadEvent = Parameters<typeof rawLoad>[0];
type FetchFn = (url: string) => Promise<Response>;

const CAL_URL = manifestJson.scenarios.fzp.calibration;

function event(fetchFn: FetchFn, search = ''): LoadEvent {
  return {
    fetch: fetchFn,
    url: new URL(`http://localhost/fzp${search}`),
    parent: async () => ({ datasetVersion: 'fixture-0', appRelease: 'dev' })
  } as unknown as LoadEvent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

describe('/fzp load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the manifest and the parsed calibration when the manifest has scenarios.fzp', async () => {
    const fetchFn = files();
    const result = await load(event(fetchFn));
    expect(result).toEqual({
      manifest: parseManifest(manifestJson),
      manifestError: false,
      calibration: parseCalibration(calibrationJson),
      calibrationError: false,
      noScenario: false,
      seed: null,
      seedInvalid: false
    });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([manifestUrl('fixture-0'), CAL_URL]);
  });

  it('reports noScenario without fetching a calibration when the manifest has no scenarios', async () => {
    const { scenarios: _omit, ...plain } = manifestJson;
    const fetchFn = files({ [manifestUrl('fixture-0')]: () => json(plain) });
    const result = await load(event(fetchFn));
    expect(result).toMatchObject({
      manifestError: false,
      calibration: null,
      calibrationError: false,
      noScenario: true
    });
    expect(result.manifest?.datasetVersion).toBe('fixture-0');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a manifest 404 as manifestError without throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = files({ [manifestUrl('fixture-0')]: () => json({}, 404) });
    const result = await load(event(fetchFn));
    expect(result).toEqual({
      manifest: null,
      manifestError: true,
      calibration: null,
      calibrationError: false,
      noScenario: false,
      seed: null,
      seedInvalid: false
    });
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('reports a calibration 404 as calibrationError', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await load(event(files({ [CAL_URL]: () => json({}, 404) })));
    expect(result).toMatchObject({
      manifestError: false,
      calibration: null,
      calibrationError: true,
      noScenario: false
    });
    expect(result.manifest).not.toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('reports calibration JSON that is not valid as calibrationError', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = () => new Response('{not json', { status: 200 });
    const result = await load(event(files({ [CAL_URL]: bad })));
    expect(result).toMatchObject({ calibration: null, calibrationError: true });
    const invalid = await load(event(files({ [CAL_URL]: () => json({ schema: 99 }) })));
    expect(invalid).toMatchObject({ calibration: null, calibrationError: true });
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('reports a network failure on either file as a flag', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(load(event(down))).resolves.toMatchObject({ manifestError: true });
    const calDown = files({
      [CAL_URL]: () => {
        throw new TypeError('Failed to fetch');
      }
    });
    await expect(load(event(calDown))).resolves.toMatchObject({
      manifestError: false,
      calibration: null,
      calibrationError: true
    });
  });

  it('parses ?seed=12', async () => {
    const result = await load(event(files(), '?seed=12&x=1'));
    expect(result).toMatchObject({ seed: 12, seedInvalid: false });
  });

  it('treats ?seed=junk as absent and asks for a clean-up', async () => {
    const result = await load(event(files(), '?seed=junk'));
    expect(result).toMatchObject({ seed: null, seedInvalid: true });
  });
});
