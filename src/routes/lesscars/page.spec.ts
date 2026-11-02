// The /lesscars universal load: the layout's datasetVersion goes to loadLessCars; every failure is
// a page state, never a thrown 500.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { load as rawLoad } from './+page';
import type { LessCarsPageData } from '$lib/lesscars/load';

const ROOT = join(process.cwd(), 'e2e/fixtures/data');
type LoadEvent = Parameters<typeof rawLoad>[0];
const load = async (e: LoadEvent) => (await rawLoad(e)) as LessCarsPageData;

function fixtureFetch(drop?: 'lesscars') {
  return vi.fn(async (url: string): Promise<Response> => {
    const rel = url.replace(/^\/data\//, '');
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      return new Response('', { status: 404 });
    }
    const json = JSON.parse(text);
    if (drop && rel.endsWith('manifest.json')) delete json.scenarios.lesscars;
    return new Response(JSON.stringify(json), { status: 200 });
  });
}

const event = (fetchFn: ReturnType<typeof fixtureFetch>, version = 'fixture-0') =>
  ({ fetch: fetchFn, parent: async () => ({ datasetVersion: version }) }) as unknown as LoadEvent;

describe('/lesscars load', () => {
  it('load passes the layout datasetVersion to loadLessCars', async () => {
    const fetchFn = fixtureFetch();
    const out = await load(event(fetchFn));
    expect(out.state).toBe('ready');
    expect(fetchFn.mock.calls[0][0]).toContain('fixture-0');
  });

  it('a dataset without the scenario is no-scenario; a missing dataset is an error', async () => {
    expect((await load(event(fixtureFetch('lesscars')))).state).toBe('no-scenario');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await load(event(fixtureFetch(), 'no-such-version'))).state).toBe('error');
    vi.restoreAllMocks();
  });
});
