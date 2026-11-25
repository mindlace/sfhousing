/**
 * Schema of `pipeline/enrichment/ami.json`: San Francisco's area median income (100% AMI) by year
 * and household size 1..8, as MOHCD publishes it (derived from HUD's unadjusted AMI for the HUD
 * Metro FMR Area that contains San Francisco). The affordable tiers' income bands
 * (AMI_TIER_BOUNDS, src/lib/sim/finance/tiers.ts) are shares of these dollars. Findings in
 * docs/dev/cars-data.md. Pipeline only (zod).
 */
import path from 'node:path';
import { z } from 'zod';
import { BuildError } from '../lib/build-error';
import { citeSchema, type Cite } from './parking-schema';

export interface AmiFile {
  /** SF AMI dollars by year and household size 1..8 (100% AMI). */
  years: { year: number; bySize: number[] }[];
  sources: Cite[];
}

export const AMI_JSON = path.join(import.meta.dirname, 'ami.json');

const year = z.strictObject({
  year: z.number().int().min(1990).max(2100),
  bySize: z
    .array(z.number().int().positive())
    .length(8, 'bySize: household sizes 1..8')
    .refine(
      (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]),
      'bySize: income must rise with household size'
    )
});

const AMI_FILE = z
  .strictObject({
    years: z.array(year).min(1),
    sources: z.array(citeSchema).min(1, 'sources: at least one')
  })
  .superRefine((f, ctx) => {
    f.years.forEach((y, i) => {
      if (i > 0 && y.year <= f.years[i - 1].year) {
        ctx.addIssue({
          code: 'custom',
          path: ['years', i, 'year'],
          message: 'year: years must rise, each once'
        });
      }
    });
  });

/** Strict objects (no extra keys). Throws BuildError(`ami: $.path: message; ...`). */
export function parseAmiFile(v: unknown): AmiFile {
  const r = AMI_FILE.safeParse(v);
  if (!r.success) {
    const issues = r.error.issues.map((i) => {
      const at = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
      return `$${at}: ${i.message}`;
    });
    throw new BuildError(`ami: ${issues.join('; ')}`);
  }
  return r.data;
}
