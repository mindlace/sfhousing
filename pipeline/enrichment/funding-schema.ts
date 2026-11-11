/**
 * Schema of the hand-transcribed baseline funding `pipeline/enrichment/funding.json`
 * (finance-data spec 4.5): the Budget and Legislative Analyst's per-home and City-source figures,
 * the state and federal pool texts, the allocation records behind the federal pool's missing
 * ceiling, and the CDLAC/CTCAC award rows. Fixture builds read
 * `pipeline/test/fixtures/mini/enrichment/funding.json`. Pipeline only (zod).
 */
import { z } from 'zod';
import { BuildError } from '../lib/build-error';
import { AFFORDABLE } from '../../src/lib/sim/finance/prototypes';
import type { IsoDate } from './schema';

export interface Cite {
  label: string;
  url: string;
  page: string;
  retrieved: IsoDate;
  quote?: string;
}

export interface FundingFile {
  schema: 1;
  /** Exhibit F: average funding per home, tax-credit projects, 2024 */
  perHome: {
    total: number;
    city: number;
    federal: number;
    state: number;
    permanentLoans: number;
    other: number;
    tier: 1;
    cite: Cite;
  };
  /** Exhibit E: local MOHCD multifamily spending by source, FY2024-25 */
  city: {
    /** 'FYyyyy-yy', two consecutive years (July to June) */
    fiscalYear: string;
    total: number;
    tier: 1;
    cite: Cite;
    sources: {
      id: string;
      label: string;
      kind: 'goBond' | 'cop' | 'generalRevenue' | 'dedicatedTax';
      dollarsPerYear: number;
      debt: { rate: number; termYears: number; cite: Cite } | null;
      note: string;
      cite: Cite;
    }[];
  };
  state: { id: string; label: string; dollarsPerYear: number; tier: 2; method: string; cite: Cite };
  federal: {
    id: string;
    label: string;
    tier: 2;
    method: string;
    cite: Cite;
    /** the allocation records behind the pool's missing ceiling (finance-data spec 4.5) */
    uncapped: { rounds: number; window: [IsoDate, IsoDate]; cites: Cite[] };
  };
  /** awards whose homes give check.observedHomesPerYear */
  awards: {
    years: number[];
    rows: {
      year: number;
      application: string;
      project: string;
      credit: '4%' | '9%';
      newConstruction: boolean;
      homes: number;
      cite: Cite;
    }[];
  };
  /** pool ids of sources that have ended; never reused (empty today) */
  retiredIds: string[];
}

/** 31 = F12's 40 less the 9 characters of 'baseline-'. */
export const FUNDING_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

function isHttps(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

const FISCAL_YEAR_RE = /^FY(\d{4})-(\d{2})$/;

/** 'FY2024-25' (a July-to-June year) is consecutive: the second year is the first plus one. */
function isFiscalYear(s: string): boolean {
  const m = FISCAL_YEAR_RE.exec(s);
  return m !== null && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** The first and last day of a schema-checked fiscal year: 'FY2024-25' → 2024-07-01..2025-06-30. */
export function fiscalYearWindow(fiscalYear: string): [string, string] {
  if (!isFiscalYear(fiscalYear)) throw new BuildError(`not a fiscal year: ${fiscalYear}`);
  const first = Number(fiscalYear.slice(2, 6));
  return [`${first}-07-01`, `${first + 1}-06-30`];
}

const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
  .refine(isRealDate, 'must be a real calendar date');
const text = z.string().min(1);
const dollars = z.number().int().nonnegative();
const year = z.number().int();

const cite = z.strictObject({
  label: text,
  url: z.string().refine(isHttps, 'must be an https URL'),
  page: text,
  retrieved: isoDate,
  quote: text.optional()
});

const source = z.strictObject({
  id: text,
  label: text,
  kind: z.enum(['goBond', 'cop', 'generalRevenue', 'dedicatedTax']),
  dollarsPerYear: dollars,
  debt: z
    .strictObject({ rate: z.number().positive(), termYears: z.number().int().positive(), cite })
    .nullable(),
  note: text,
  cite
});

const award = z.strictObject({
  year,
  application: text,
  project: text,
  credit: z.enum(['4%', '9%']),
  newConstruction: z.boolean(),
  homes: dollars,
  cite
});

const ID_MESSAGE =
  'funding ids must be unique, at most 31 characters of a-z, 0-9 and -, and not start u-';

export const FundingSchema: z.ZodType<FundingFile> = z
  .strictObject({
    schema: z.literal(1),
    perHome: z
      .strictObject({
        total: dollars,
        city: dollars,
        federal: dollars,
        state: dollars,
        permanentLoans: dollars,
        other: dollars,
        tier: z.literal(1),
        cite
      })
      .refine(
        (p) => p.city + p.federal + p.state + p.permanentLoans + p.other === p.total,
        'perHome parts must sum to total'
      ),
    city: z
      .strictObject({
        fiscalYear: z
          .string()
          .refine(isFiscalYear, 'fiscalYear must be FYyyyy-yy, two consecutive years'),
        total: dollars,
        tier: z.literal(1),
        cite,
        sources: z.array(source).min(1, 'city.sources must list at least one source')
      })
      .refine(
        (c) => c.sources.reduce((a, s) => a + s.dollarsPerYear, 0) === c.total,
        'city sources must sum to total'
      ),
    state: z.strictObject({
      id: text,
      label: text,
      dollarsPerYear: dollars,
      tier: z.literal(2),
      method: text,
      cite
    }),
    federal: z.strictObject({
      id: text,
      label: text,
      tier: z.literal(2),
      method: text,
      cite,
      uncapped: z.strictObject({
        rounds: z.number(),
        window: z.tuple([isoDate, isoDate]),
        cites: z.array(cite)
      })
    }),
    awards: z.strictObject({ years: z.array(year), rows: z.array(award) }),
    retiredIds: z.array(text)
  })
  .superRefine((f, ctx) => {
    const ids: { id: string; path: (string | number)[] }[] = [
      ...f.city.sources.map((s, i) => ({ id: s.id, path: ['city', 'sources', i, 'id'] })),
      { id: f.state.id, path: ['state', 'id'] },
      { id: f.federal.id, path: ['federal', 'id'] }
    ];
    const seen = new Set<string>();
    for (const { id, path } of ids) {
      if (!FUNDING_ID_RE.test(id) || id.startsWith('u-') || seen.has(id)) {
        ctx.addIssue({ code: 'custom', path, message: ID_MESSAGE });
      }
      seen.add(id);
      if (f.retiredIds.includes(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['retiredIds'],
          message: `funding id ${id} is retired and cannot be reused`
        });
      }
    }
    f.city.sources.forEach((s, i) => {
      const wants = s.kind === 'goBond' || s.kind === 'cop';
      if (wants !== (s.debt !== null)) {
        ctx.addIssue({
          code: 'custom',
          path: ['city', 'sources', i, 'debt'],
          message: 'debt must be set exactly for goBond and cop'
        });
      }
    });
    const u = f.federal.uncapped;
    if (
      u.cites.length === 0 ||
      !Number.isInteger(u.rounds) ||
      u.rounds < 1 ||
      u.window[0] > u.window[1]
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['federal', 'uncapped'],
        message:
          'federal.uncapped needs at least one cite, a whole number of rounds and an ordered window'
      });
    }
    const ys = f.awards.years;
    if (ys.length === 0 || ys.some((y, i) => i > 0 && y <= ys[i - 1])) {
      ctx.addIssue({
        code: 'custom',
        path: ['awards', 'years'],
        message: 'awards.years must be non-empty, ascending and unique'
      });
    }
    f.awards.rows.forEach((r, i) => {
      if (!ys.includes(r.year)) {
        ctx.addIssue({
          code: 'custom',
          path: ['awards', 'rows', i, 'year'],
          message: "every award row's year must be in awards.years"
        });
      }
    });
  });

/** Zod parse, then the cross-check with F4's AFFORDABLE. Throws BuildError. */
export function parseFundingFile(json: unknown, path: string): FundingFile {
  const r = FundingSchema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.map((i) => {
      const zodPath = i.path
        .map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))
        .join('');
      return `${path}: $${zodPath}: ${i.message}`;
    });
    throw new BuildError(issues.join('; '));
  }
  const f = r.data;
  if (
    f.perHome.total !== AFFORDABLE.value.costPerHome ||
    f.perHome.permanentLoans + f.perHome.other !== AFFORDABLE.value.ownPerHome
  ) {
    throw new BuildError('funding.json perHome disagrees with AFFORDABLE (src/lib/sim/finance)');
  }
  return f;
}
