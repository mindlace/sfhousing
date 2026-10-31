// The /s/[id] universal load (plan 5, Task 6): the policy renders on its own dataset version (I16)
// and falls back to the current one only when that manifest is gone; the URL seed still works.
import { describe, expect, it, vi } from 'vitest';
import { manifestUrl } from '$lib/data/manifest';
import { DEFAULT_POLICY, type SimDoc } from '$lib/sim-page/sim-doc';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { load as rawLoad } from './+page';

type LoadEvent = Parameters<typeof rawLoad>[0];
type FetchFn = (url: string) => Promise<Response>;
type Result = Exclude<Awaited<ReturnType<typeof rawLoad>>, void>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** fixture-0's manifest renamed to fixture-1 (every URL included). */
const manifest1 = JSON.parse(JSON.stringify(manifestJson).replaceAll('/fixture-0/', '/fixture-1/'));
manifest1.datasetVersion = 'fixture-1';

/** fixture-0, and fixture-1 when `own` is true (else its manifest is gone). */
function files(own: boolean) {
  return vi.fn<FetchFn>(async (url) => {
    if (url === manifestUrl('fixture-0')) return json(manifestJson);
    if (url === manifestUrl('fixture-1')) return own ? json(manifest1) : json({}, 404);
    if (url === manifestJson.scenarios.fzp.calibration) return json(calibrationJson);
    if (url === manifest1.scenarios.fzp.calibration) return json(calibrationJson);
    throw new Error(`unexpected fetch ${url}`);
  });
}

function event(
  fetchFn: FetchFn,
  version: string,
  notice: 'none' | 'remix' | 'gone' = 'none',
  search = ''
): LoadEvent {
  const doc: SimDoc = { schema: 1, kind: 'sim', datasetVersion: version, policy: DEFAULT_POLICY };
  return {
    fetch: fetchFn,
    url: new URL(`http://localhost/s/Abcdefg2${search}`),
    data: {
      id: 'Abcdefg2',
      doc,
      createdAt: '2026-10-30T00:00:00.000Z',
      currentDatasetVersion: 'fixture-0',
      datasetNotice: notice
    }
  } as unknown as LoadEvent;
}

const load = async (e: LoadEvent) => (await rawLoad(e)) as Result;

describe('/s/[id] load', () => {
  it("renders on the policy's own dataset when its manifest exists", async () => {
    const r = await load(event(files(true), 'fixture-1', 'remix', '?seed=9'));
    expect(r).toMatchObject({
      datasetVersion: 'fixture-1',
      fellBack: false,
      manifestError: false,
      calibrationError: false,
      noScenario: false,
      seed: 9,
      seedInvalid: false,
      start: null,
      id: 'Abcdefg2'
    });
    expect(r.manifest?.datasetVersion).toBe('fixture-1');
    expect(r.calibration).not.toBeNull();
  });

  it('falls back to the current dataset when the policy version is gone', async () => {
    const r = await load(event(files(false), 'fixture-1', 'gone'));
    expect(r).toMatchObject({ datasetVersion: 'fixture-0', fellBack: true, seed: null });
    expect(r.doc.datasetVersion).toBe('fixture-1');
  });

  it('a manifest failure is a flag, never a thrown error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await load(event(down, 'fixture-0'));
    expect(r).toMatchObject({ manifest: null, manifestError: true, datasetVersion: 'fixture-0' });
  });
});
