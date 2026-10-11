import { z } from 'zod';

/** I12 datasetVersion pattern. The single definition; everything else re-exports it. */
export const DATASET_VERSION_RE = /^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|fixture-\d+)$/;

const DatasetVersion = z.string().regex(DATASET_VERSION_RE);
const RootRelativeUrl = z.string().startsWith('/data/');

export const ManifestSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  url: z.string().url(),
  retrievedAt: z.string(),
  license: z.string()
});

export const ManifestSchema = z.object({
  datasetVersion: DatasetVersion,
  builtAt: z.string(),
  sources: z.array(ManifestSourceSchema),
  chunks: z.array(
    z.object({
      cellId: z.string(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      url: RootRelativeUrl,
      parcelCount: z.number().int().nonnegative()
    })
  ),
  buildingsTiles: RootRelativeUrl,
  basemapTiles: RootRelativeUrl,
  glyphs: RootRelativeUrl,
  sprite: RootRelativeUrl.optional(),
  neighborhoods: RootRelativeUrl
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** The subset /attribution needs; tolerant of the rest of the manifest. */
export const ManifestSourcesSchema = ManifestSchema.pick({
  datasetVersion: true,
  builtAt: true,
  sources: true
});
export type ManifestSources = z.infer<typeof ManifestSourcesSchema>;

export function manifestUrl(version: string): string {
  return `/data/${version}/manifest.json`;
}
