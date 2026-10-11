import type { PageServerLoad } from './$types';
import { ManifestSourcesSchema, type ManifestSources } from '$lib/data/manifest';
import { dataKey } from '$lib/server/data/key';

export const load: PageServerLoad = async ({ platform, parent }) => {
  const { datasetVersion } = await parent();
  return { datasetVersion, manifest: await readSources(platform, datasetVersion) };
};

async function readSources(
  platform: App.Platform | undefined,
  version: string
): Promise<ManifestSources | null> {
  const key = dataKey(version, 'manifest.json');
  const bucket = platform?.env?.BUCKET;
  if (!key || !bucket) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const parsed = ManifestSourcesSchema.safeParse(JSON.parse(await obj.text()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
