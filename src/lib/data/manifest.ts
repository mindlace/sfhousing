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
  transit: RootRelativeUrl.optional(),
  /** Scenario data for the FZP timelapse (scenario-data spec §4.9). Optional: older datasets have none. */
  scenarios: z
    .object({
      fzp: z.object({
        parcels: RootRelativeUrl,
        projects: RootRelativeUrl,
        calibration: RootRelativeUrl,
        /** Per-lot policy inputs (sfh-policy/2). Optional: datasets built before it lack it. */
        policy: RootRelativeUrl.optional(),
        /** Older datasets' per-lot gross table. Accepted so they still validate; nothing reads it. */
        gross: RootRelativeUrl.optional(),
        /** Per-lot building options (sfh-options/1, scenarios/fzp/options.bin). Optional: older datasets lack it. */
        options: RootRelativeUrl.optional(),
        /** Car zones and start households (sfh-cars/1). Optional: datasets without Census data lack it. */
        cars: RootRelativeUrl.optional(),
        /** Car zones as GeoJSON (block groups, property `z`). Present exactly when `cars` is. */
        carZones: RootRelativeUrl.optional(),
        /** Older datasets' lot-to-street frontage. Accepted so they still validate; nothing reads it. */
        frontage: RootRelativeUrl.optional()
      })
    })
    .optional(),
  /**
   * Derived at parse, never read from the file: true exactly when the raw manifest has a
   * `scenarios.lesscars` object, so its basemap holds a `roads_lc` source layer.
   */
  splitRoads: z.literal(true).optional()
});

/**
 * Sets `splitRoads` from the raw JSON (Zod strips `scenarios.lesscars`, so it must run first). A
 * raw `splitRoads` key is dropped; only a `scenarios.lesscars` object sets the mark.
 */
function markSplitRoads(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const { splitRoads: _ignored, ...rest } = raw as Record<string, unknown>;
  const scenarios = rest.scenarios;
  const lesscars =
    typeof scenarios === 'object' && scenarios !== null
      ? (scenarios as Record<string, unknown>).lesscars
      : undefined;
  const older = typeof lesscars === 'object' && lesscars !== null && !Array.isArray(lesscars);
  return older ? { ...rest, splitRoads: true } : rest;
}

export const ManifestSchema = z.preprocess(
  markSplitRoads,
  ManifestBaseSchema.superRefine((m, ctx) => {
    const prefix = `/data/${m.datasetVersion}/`;
    const reported = new Set<string>();
    for (const f of manifestFiles(m)) {
      if (!f.url.startsWith(prefix) && !reported.has(f.key)) {
        reported.add(f.key);
        ctx.addIssue({
          code: 'custom',
          path: f.key.split('.'),
          message: `url must start with ${prefix}`
        });
      }
    }
    const seen = new Set<string>();
    m.chunks.forEach((c, i) => {
      if (seen.has(c.cellId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['chunks', i, 'cellId'],
          message: 'duplicate cellId'
        });
      }
      seen.add(c.cellId);
    });
  })
);
export type Manifest = z.infer<typeof ManifestSchema>;

/** The subset /attribution needs; tolerant of the rest of the manifest. */
export const ManifestSourcesSchema = ManifestBaseSchema.pick({
  datasetVersion: true,
  builtAt: true,
  sources: true,
  scenarios: true
});
export type ManifestSources = z.infer<typeof ManifestSourcesSchema>;

export interface ManifestFile {
  key: string;
  url: string;
  optional: boolean;
}
export interface GlyphSet {
  stacks: readonly string[];
  ranges: readonly string[];
}

/** Every 256-codepoint glyph range: '0-255' … '65280-65535'. */
export const GLYPH_RANGES: readonly string[] = Array.from(
  { length: 256 },
  (_, i) => `${i * 256}-${i * 256 + 255}`
);
export const SPRITE_SUFFIXES = ['.json', '.png', '@2x.json', '@2x.png'] as const;

/** Every file `m` names, in schema order. Without `glyphs` the glyph entry is the template. */
export function manifestFiles(m: Manifest, glyphs?: GlyphSet): ManifestFile[] {
  const out: ManifestFile[] = [];
  const add = (key: string, url: string | undefined, optional = false): void => {
    if (url !== undefined) out.push({ key, url, optional });
  };
  add('buildingsTiles', m.buildingsTiles);
  add('basemapTiles', m.basemapTiles);
  if (glyphs) {
    for (const stack of glyphs.stacks) {
      for (const range of glyphs.ranges) {
        add('glyphs', m.glyphs.replace('{fontstack}', stack).replace('{range}', range));
      }
    }
  } else {
    add('glyphs', m.glyphs);
  }
  if (m.sprite !== undefined) {
    for (const suffix of SPRITE_SUFFIXES) add('sprite', m.sprite + suffix, true);
  }
  add('neighborhoods', m.neighborhoods);
  add('transit', m.transit);
  const fzp = m.scenarios?.fzp;
  add('scenarios.fzp.parcels', fzp?.parcels);
  add('scenarios.fzp.projects', fzp?.projects);
  add('scenarios.fzp.calibration', fzp?.calibration);
  add('scenarios.fzp.policy', fzp?.policy);
  add('scenarios.fzp.gross', fzp?.gross);
  add('scenarios.fzp.options', fzp?.options);
  add('scenarios.fzp.cars', fzp?.cars);
  add('scenarios.fzp.carZones', fzp?.carZones);
  add('scenarios.fzp.frontage', fzp?.frontage);
  m.chunks.forEach((c, i) => add(`chunks.${i}.url`, c.url));
  return out;
}

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
