// The /s/[id] universal load (plan 5, Task 6): the policy renders on its own dataset version (I16)
// and falls back to the current one only when that manifest is gone. With the calibration loaded
// the load opens the shared text (timeline-ui Task 15, R-4): upgraded, reconciled, with notices; a
// text that will not open is the policy's 500. `?seed=` is not read.
import { describe, expect, it, vi } from 'vitest';
import { manifestUrl } from '$lib/data/manifest';
import { month, painted4Text, paintedText } from '$lib/server/test/sim-docs';
import { copyFor } from '$lib/sharing/copy';
import { SIM_SERVER_CODEC4, type SharedSim } from '$lib/timeline/server-codec';
import type { SimNotice4 } from '$lib/timeline/session4';
import type { SimDoc4 } from '$lib/timeline/sim-doc4';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { load as rawLoad } from './+page';

type LoadEvent = Parameters<typeof rawLoad>[0];
type FetchFn = (url: string) => Promise<Response>;
type Result = Exclude<Awaited<ReturnType<typeof rawLoad>>, void> & {
  opened: { doc: SimDoc4; notices: SimNotice4[] } | null;
};

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

/** The server's document for `text` (what +page.server.ts hands on). */
function shared(text: string): SharedSim {
  const r = SIM_SERVER_CODEC4.load(text);
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

function event(
  fetchFn: FetchFn,
  version: string,
  o: {
    notice?: 'none' | 'remix' | 'gone';
    search?: string;
    doc?: SharedSim;
    upgradedFrom?: number;
  } = {}
): LoadEvent {
  return {
    fetch: fetchFn,
    url: new URL(`http://localhost/s/Abcdefg2${o.search ?? ''}`),
    data: {
      id: 'Abcdefg2',
      doc: o.doc ?? shared(painted4Text({ datasetVersion: version })),
      createdAt: '2026-10-30T00:00:00.000Z',
      currentDatasetVersion: 'fixture-0',
      datasetNotice: o.notice ?? 'none',
      ...(o.upgradedFrom === undefined ? {} : { upgradedFrom: o.upgradedFrom })
    }
  } as unknown as LoadEvent;
}

const load = async (e: LoadEvent) => (await rawLoad(e)) as Result;

describe('/s/[id] load', () => {
  it("renders on the policy's own dataset when its manifest exists; ?seed= is not read", async () => {
    const r = await load(event(files(true), 'fixture-1', { notice: 'remix', search: '?seed=9' }));
    expect(r).toMatchObject({
      datasetVersion: 'fixture-1',
      fellBack: false,
      manifestError: false,
      calibrationError: false,
      noScenario: false,
      id: 'Abcdefg2'
    });
    expect(r).not.toHaveProperty('seed');
    expect(r).not.toHaveProperty('seedInvalid');
    expect(r.manifest?.datasetVersion).toBe('fixture-1');
    expect(r.calibration).not.toBeNull();
  });

  it('falls back to the current dataset when the policy version is gone', async () => {
    const r = await load(event(files(false), 'fixture-1', { notice: 'gone' }));
    expect(r).toMatchObject({ datasetVersion: 'fixture-0', fellBack: true });
    expect(r.doc.datasetVersion).toBe('fixture-1');
  });

  it('a manifest failure is a flag, never a thrown error; the text waits for the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await load(event(down, 'fixture-0'));
    expect(r).toMatchObject({ manifest: null, manifestError: true, datasetVersion: 'fixture-0' });
    // No calibration: the page opens the text after a Retry's reload.
    expect(r.opened).toBeNull();
    expect(r.doc.text).toBe(painted4Text());
  });

  it('opens a schema 4 text on the calibration', async () => {
    const r = await load(event(files(true), 'fixture-0'));
    expect(r.opened?.doc.policy.kinds.zoning).toHaveLength(1);
    expect(r.opened?.notices).toEqual([]);
  });

  it('a stored schema 3 row loads on the server as text and opens upgraded on the page', async () => {
    const r = await load(
      event(files(true), 'fixture-0', { doc: shared(paintedText()), upgradedFrom: 3 })
    );
    expect(r.opened?.doc.schema).toBe(4);
    expect(r.opened?.doc.policy.kinds.zoning.map((p) => p.where.tag)).toEqual(['painted']);
    expect(r.opened?.notices.map((n) => n.id)).toEqual(['upgraded']);
  });

  it('a stored schema 4 row from an earlier dataset loads unaligned and opens reconciled', async () => {
    const text = painted4Text({ datasetVersion: 'fixture-1' }, month(2) + 3);
    const r = await load(event(files(true), 'fixture-1', { notice: 'remix', doc: shared(text) }));
    expect(r.opened?.doc.policy.kinds.zoning[0].spans[0].from).not.toBe(month(2) + 3);
    expect(r.opened?.notices.map((n) => n.id)).toEqual(['dates-moved']);
  });

  it("a text that will not open is a 500 with the policy's unparsable copy", async () => {
    const doc = { ...shared(painted4Text()), text: '{"schema":4}' };
    await expect(load(event(files(true), 'fixture-0', { doc }))).rejects.toMatchObject({
      status: 500,
      body: { message: copyFor('sim').unparsable }
    });
  });
});
