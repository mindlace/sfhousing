import { z } from 'zod';
import { DATASET_VERSION_RE } from './dataset-version';

export { DATASET_VERSION_RE } from './dataset-version';

const DatasetVersion = z.string().regex(DATASET_VERSION_RE);
const RootRelativeUrl = z
  .string()
  .startsWith('/data/')
  .refine(
    (u) =>
      u
        .slice('/data/'.length)
        .split('/')
        .every((seg) => seg !== '' && seg !== '.' && seg !== '..'),
    'URL path segments must not be empty, "." or ".."'
  );

export const CELL_ID_RE = /^-?\d+_-?\d+$/;
const IsoDate = z.iso.datetime({ offset: true });

export const ManifestSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  url: z.url({ protocol: /^https?$/ }),
  retrievedAt: z.union([IsoDate, z.iso.date()]),
  license: z.string()
});

const ChunkSchema = z.object({
  cellId: z.string().regex(CELL_ID_RE),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(
      ([w, s, e, n]) => [w, s, e, n].every(Number.isFinite) && w <= e && s <= n,
      'bbox must be [w,s,e,n]'
    ),
  url: RootRelativeUrl,
  parcelCount: z.number().int().nonnegative()
});

// Unrefined base: Zod 4 forbids .pick on a refined object.
const ManifestBaseSchema = z.object({
  datasetVersion: DatasetVersion,
  builtAt: IsoDate,
  sources: z.array(ManifestSourceSchema),
  chunks: z.array(ChunkSchema),
  buildingsTiles: RootRelativeUrl,
  basemapTiles: RootRelativeUrl,
  glyphs: RootRelativeUrl,
  sprite: RootRelativeUrl.optional(),
  neighborhoods: RootRelativeUrl,
  /** Transit seed network (transit spec T1). Optional: older datasets have none. */
  transit: RootRelativeUrl.optional()
});

export const ManifestSchema = ManifestBaseSchema.superRefine((m, ctx) => {
  const prefix = `/data/${m.datasetVersion}/`;
  const urls: [string, string | undefined][] = [
    ['buildingsTiles', m.buildingsTiles],
    ['basemapTiles', m.basemapTiles],
    ['glyphs', m.glyphs],
    ['sprite', m.sprite],
    ['neighborhoods', m.neighborhoods],
    ['transit', m.transit],
    ...m.chunks.map((c, i): [string, string] => [`chunks.${i}.url`, c.url])
  ];
  for (const [path, u] of urls) {
    if (u !== undefined && !u.startsWith(prefix)) {
      ctx.addIssue({
        code: 'custom',
        path: path.split('.'),
        message: `url must start with ${prefix}`
      });
    }
  }
  const seen = new Set<string>();
  m.chunks.forEach((c, i) => {
    if (seen.has(c.cellId)) {
      ctx.addIssue({ code: 'custom', path: ['chunks', i, 'cellId'], message: 'duplicate cellId' });
    }
    seen.add(c.cellId);
  });
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** The subset /attribution needs; tolerant of the rest of the manifest. */
export const ManifestSourcesSchema = ManifestBaseSchema.pick({
  datasetVersion: true,
  builtAt: true,
  sources: true
});
export type ManifestSources = z.infer<typeof ManifestSourcesSchema>;

export class ManifestError extends Error {
  constructor(public issues: string[]) {
    super(`invalid manifest: ${issues.join('; ')}`);
    this.name = 'ManifestError';
  }
}

export function parseManifest(json: unknown): Manifest {
  const r = ManifestSchema.safeParse(json);
  if (!r.success) {
    throw new ManifestError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}

export function manifestUrl(version: string): string {
  return `/data/${version}/manifest.json`;
}
