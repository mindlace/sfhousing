/**
 * Schema of the hand-curated DA multi-phase enrichment file `pipeline/enrichment/multiphase.json`
 * (spec 4.10.1). Fixture builds read `pipeline/test/fixtures/mini/enrichment/multiphase.json`.
 * Pipeline only (zod).
 */
import { z } from 'zod';

/** 'YYYY-MM-DD'. */
export type IsoDate = string;

export interface Fact {
  url: string;
  retrieved: IsoDate;
  /** page, table or exhibit */
  locator: string;
}

export interface MultiphasePhase {
  /** the DA's own phase name, e.g. 'CP Major Phase 2, Sub-Phase 1' */
  name: string;
  /** gross units in the published schedule */
  units: number;
  /** block-lots named for the phase (resolved per spec 4.2 Parcels) */
  blklots: string[];
  /** from the schedule of performance, if it gives one */
  plannedPermitFiled: IsoDate | null;
  status: 'remaining' | 'built' | 'separate';
  /** required when status = 'separate' */
  separateRef?: { dataset: string; id: string; key?: string };
  facts: { units: Fact; blklots: Fact; plannedPermitFiled?: Fact };
}

export interface MultiphaseEntry {
  /** 6jgi-cpb4 case_no, e.g. '2007.0946PRX' */
  caseNo: string;
  /** e.g. 'Candlestick Point / Hunters Point Shipyard Phase 2' */
  label: string;
  /** the DA phasing exhibit */
  schedule: { label: string; url: string; retrieved: IsoDate } | null;
  /** required, non-empty when schedule is null */
  searched: { url: string; retrieved: IsoDate }[];
  /** empty when schedule is null */
  phases: MultiphasePhase[];
}

export interface MultiphaseFile {
  schema: 1;
  projects: MultiphaseEntry[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in 'YYYY-MM-DD' form. */
function isRealDate(s: string): boolean {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
  .refine(isRealDate, 'must be a real calendar date');
const url = z.url({ protocol: /^https?$/ });
const text = z.string().min(1);

const fact = z.strictObject({ url, retrieved: isoDate, locator: text });

const phase = z
  .strictObject({
    name: text,
    units: z.number().int().min(1),
    blklots: z.array(text),
    plannedPermitFiled: isoDate.nullable(),
    status: z.enum(['remaining', 'built', 'separate']),
    separateRef: z.strictObject({ dataset: text, id: text, key: text.optional() }).optional(),
    facts: z.strictObject({
      units: fact,
      blklots: fact,
      plannedPermitFiled: fact.optional()
    })
  })
  .superRefine((p, ctx) => {
    if (p.status === 'separate' && p.separateRef === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['separateRef'],
        message: "separateRef is required when status is 'separate'"
      });
    }
    if (p.status !== 'separate' && p.separateRef !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['separateRef'],
        message: "separateRef is only allowed when status is 'separate'"
      });
    }
  });

const entry = z
  .strictObject({
    caseNo: text,
    label: text,
    schedule: z.strictObject({ label: text, url, retrieved: isoDate }).nullable(),
    searched: z.array(z.strictObject({ url, retrieved: isoDate })),
    phases: z.array(phase)
  })
  .superRefine((e, ctx) => {
    if (e.schedule === null && e.searched.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['searched'],
        message: 'searched must be non-empty when schedule is null'
      });
    }
    if (e.schedule === null && e.phases.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'phases must be empty when schedule is null'
      });
    }
  });

export const MultiphaseFileSchema: z.ZodType<MultiphaseFile> = z
  .strictObject({ schema: z.literal(1), projects: z.array(entry) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.projects.forEach((p, i) => {
      if (seen.has(p.caseNo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['projects', i, 'caseNo'],
          message: `duplicate caseNo ${p.caseNo}`
        });
      }
      seen.add(p.caseNo);
    });
  });

export class MultiphaseFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultiphaseFormatError';
  }
}

/** Validates a parsed `multiphase.json`; throws `MultiphaseFormatError` listing every issue. */
export function parseMultiphase(json: unknown): MultiphaseFile {
  const r = MultiphaseFileSchema.safeParse(json);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
    return `$${path}: ${i.message}`;
  });
  throw new MultiphaseFormatError(`multiphase.json: ${issues.join('; ')}`);
}
