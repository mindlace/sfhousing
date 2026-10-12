import { DATASET_VERSION_RE } from './dataset-version';
import { parseRoofIndex, roofUrlSchema, type RoofIndex } from './building-roofs';
import type { BuildingRoofsDescriptor } from './manifest';

/** Validate the complete supported closure before returning any URL to a reader. */
export function roofArtifactUrls(
  descriptor: BuildingRoofsDescriptor,
  index: RoofIndex | undefined
): string[] {
  const version = descriptor.indexUrl.split('/')[2];
  if (!version || !DATASET_VERSION_RE.test(version))
    throw new Error('invalid roof dataset version');
  const urls = [descriptor.indexUrl, descriptor.auditUrl, descriptor.reportUrl];
  for (const url of urls) {
    roofUrlSchema(version).parse(url);
    if (url.slice(`/data/${version}/`.length).length > 256) throw new Error('roof path too long');
  }
  if (descriptor.schemaVersion === 1 && index) {
    const parsed = parseRoofIndex(index, version);
    for (const c of parsed.chunks) urls.push(c.headerUrl, c.meshUrl);
  }
  for (const url of urls)
    if (url.slice(`/data/${version}/`.length).length > 256) throw new Error('roof path too long');
  if (new Set(urls).size !== urls.length) throw new Error('duplicate roof artifact URL');
  return urls;
}
