/**
 * Schema of the Controller market enrichment `pipeline/enrichment/market.json` (market-baseline
 * spec 4.5): the Controller's two coefficients, its cost index and two price-index period means.
 * Pipeline only (zod).
 */
import { z } from 'zod';
import { CalibrationError } from '../lib/fzp-cal/types';
import type { IsoDate } from './schema';

export interface MarketCoefficient {
  variable: string;
  value: number;
  se: number;
  locator: string;
}

export interface MarketPeriod {
  from: number;
  to: number;
  mean: number;
}

export interface MarketFile {
  schema: 1;
  source: { label: string; url: string; retrieved: IsoDate };
  lagYears: { value: number; locator: string };
  coefficients: { cost: MarketCoefficient; price: MarketCoefficient };
  /** keys '2005'..'2023', every year (the panel years 2007-2025 minus lagYears 2) */
  costIndex: { locator: string; values: Record<string, number> };
  priceIndex: { locator: string; means: [MarketPeriod, MarketPeriod] };
}

const COST_YEARS = Array.from({ length: 2023 - 2005 + 1 }, (_, i) => String(2005 + i));

const coefficient = z.strictObject({
  variable: z.string().min(1),
  value: z.number(),
  se: z.number().positive(),
  locator: z.string().min(1)
});

const period = z.strictObject({
  from: z.number().int(),
  to: z.number().int(),
  mean: z.number()
});

const marketFile = z.strictObject({
  schema: z.literal(1),
  source: z.strictObject({
    label: z.string().min(1),
    url: z.url(),
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }),
  lagYears: z.strictObject({ value: z.number().int().nonnegative(), locator: z.string().min(1) }),
  coefficients: z.strictObject({ cost: coefficient, price: coefficient }),
  costIndex: z.strictObject({
    locator: z.string().min(1),
    values: z.strictObject(Object.fromEntries(COST_YEARS.map((y) => [y, z.number()])))
  }),
  priceIndex: z.strictObject({ locator: z.string().min(1), means: z.tuple([period, period]) })
});

/** Strict objects (no extra keys). Throws CalibrationError(`market: ${path}: ${zod message}`). */
export function parseMarketFile(json: unknown, path: string): MarketFile {
  const r = marketFile.safeParse(json);
  if (!r.success) throw new CalibrationError(`market: ${path}: ${r.error.message}`);
  return r.data;
}
