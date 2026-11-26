/**
 * Schema of `pipeline/enrichment/cpi.json`: the BLS Consumer Price Index for All Urban Consumers
 * (CPI-U), San Francisco-Oakland-Hayward, all items, not seasonally adjusted, annual averages
 * (series CUURS49BSA0, period M13). The car model brings each cited parking cost per space to the
 * finance prototypes' nominal dollars with it (pipeline/lib/cars/rates.ts `parkingOf`). Pipeline
 * only (zod).
 */
import path from 'node:path';
import { z } from 'zod';
import { BuildError } from '../lib/build-error';
import { citeSchema, type Cite } from './parking-schema';

export interface CpiFile {
  /** BLS series id */
  seriesId: string;
  /** Annual average index (1982-84 = 100) by year, as published. */
  annual: Record<string, number>;
  sources: Cite[];
  method: string;
}

export const CPI_JSON = path.join(import.meta.dirname, 'cpi.json');

const CPI_FILE = z.strictObject({
  seriesId: z.string().regex(/^CU[A-Z0-9]+$/, 'seriesId: a BLS CPI series id'),
  annual: z
    .record(z.string().regex(/^\d{4}$/, 'annual: keys are years'), z.number().positive())
    .refine((a) => Object.keys(a).length > 0, 'annual: at least one year'),
  sources: z.array(citeSchema).min(1, 'sources: at least one'),
  method: z.string().trim().min(1)
});

/** Strict objects (no extra keys). Throws BuildError(`cpi: $.path: message; ...`). */
export function parseCpiFile(v: unknown): CpiFile {
  const r = CPI_FILE.safeParse(v);
  if (!r.success) {
    const issues = r.error.issues.map((i) => {
      const at = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
      return `$${at}: ${i.message}`;
    });
    throw new BuildError(`cpi: ${issues.join('; ')}`);
  }
  return r.data;
}
