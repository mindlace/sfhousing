/**
 * Schema of the parking enrichment `pipeline/enrichment/parking.json` (car-ownership spec, parking
 * in new buildings): the cost of one parking space by type, from real cited San Francisco sources
 * only, and the ratio of spaces built to spaces used. The findings behind the file are in
 * docs/dev/cars-data.md. Pipeline only (zod).
 *
 * The live file never carries an invented cost: every cost source is an SF source (`sf: true`) and
 * a cost has no tier field. A fixture parser for an invented cost can reuse `parkingFileSchema`
 * with its own cost schema (spec ruling P3).
 */
import path from 'node:path';
import { z } from 'zod';
import { BuildError } from '../lib/build-error';

export interface Cite {
  label: string;
  url: string;
  page: string;
  accessed: string;
}

export interface SfCost {
  /** dollars per space */
  value: number;
  /** the dollars' year, as the source states it; never escalated in this file */
  dollarsYear: number;
  /** at least one */
  sources: (Cite & { sf: true })[];
  method: string;
}

export interface ParkingFile {
  /** null: no SF source found; the parking-to-odds link is off. */
  costPerSpace: { surface: SfCost | null; podium: SfCost | null; belowGrade: SfCost | null } | null;
  /** Spaces built per space used; tier 0-2 from SF per-project counts, 3 from literature. */
  supplyOverUse: { value: number; tier: 0 | 1 | 2 | 3; sources: Cite[]; method: string };
  /** What was searched, always; must be non-empty when costPerSpace is null. */
  searched: string[];
}

export const PARKING_JSON = path.join(import.meta.dirname, 'parking.json');

function isRealDate(s: string): boolean {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

const text = z.string().trim().min(1);

export const citeSchema = z.strictObject({
  label: text,
  url: z.url({ protocol: /^https$/ }),
  page: text,
  accessed: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .refine(isRealDate, 'must be a real calendar date')
});

const sfCite = citeSchema.extend({
  sf: z.literal(true, { error: 'sf: every cost source must be an SF source (sf: true)' })
});

const sfCost = z.strictObject({
  value: z.number().positive(),
  dollarsYear: z.number().int().min(1990).max(2100),
  sources: z.array(sfCite).min(1, 'sources: a cost needs at least one SF source'),
  method: text
});

/** The file's shape around a cost schema: the live file passes `sfCost`. */
export function parkingFileSchema(cost: z.ZodType) {
  return z
    .strictObject({
      costPerSpace: z
        .strictObject({
          surface: cost.nullable(),
          podium: cost.nullable(),
          belowGrade: cost.nullable()
        })
        .nullable(),
      supplyOverUse: z.strictObject({
        value: z.number().min(1, 'supplyOverUse: spaces built per space used is at least 1'),
        tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        sources: z.array(citeSchema).min(1),
        method: text
      }),
      searched: z.array(text)
    })
    .superRefine((f, ctx) => {
      if (f.costPerSpace === null && f.searched.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['searched'],
          message: 'searched: list what was searched when costPerSpace is null'
        });
      }
      const c = f.costPerSpace;
      if (c !== null && c.surface === null && c.podium === null && c.belowGrade === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['costPerSpace'],
          message: 'costPerSpace: null, not an object of nulls, when no type has a cost'
        });
      }
    });
}

const PARKING_FILE = parkingFileSchema(sfCost);

/** Strict objects (no extra keys). Throws BuildError(`parking: $.path: message; ...`). */
export function parseParkingFile(v: unknown): ParkingFile {
  const r = PARKING_FILE.safeParse(v);
  if (!r.success) {
    const issues = r.error.issues.map((i) => {
      const at = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
      return `$${at}: ${i.message}`;
    });
    throw new BuildError(`parking: ${issues.join('; ')}`);
  }
  return r.data as ParkingFile;
}
