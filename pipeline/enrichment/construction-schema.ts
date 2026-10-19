/**
 * Schema of the hand-curated imagery verdicts `pipeline/enrichment/construction-verified.json`
 * (spec 4.6, rule `pr.stages.verified-construction`): a partner's check of an open history that
 * stopped at a stage, by street-level or aerial imagery. Fixture builds read
 * `pipeline/test/fixtures/mini/enrichment/construction-verified.json`. Pipeline only (zod).
 */
import { z } from 'zod';
import type { IsoDate } from './schema';

export interface ConstructionVerdict {
  /** A T4d history id, e.g. 'BP:8203602' or 'PRJ:2014.1246'. */
  id: string;
  /** complete: the building stands; dead: no building (Ruling C3); unknown: no change. */
  verdict: 'complete' | 'dead' | 'unknown';
  /** The day of the check; a `dead` exit is dated by it (no event day is known). */
  checked: IsoDate;
  /** Who or what checked, e.g. 'partner imagery check'. */
  source: string;
  /** Required for `complete`, not allowed otherwise, and not after `checked`. */
  completeDay?: IsoDate;
  note?: string;
}

export interface ConstructionVerifiedFile {
  schema: 1;
  /** Ids unique and in code-unit order. */
  projects: ConstructionVerdict[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'must be YYYY-MM-DD')
  .refine(isRealDate, 'must be a real calendar date');
const text = z.string().min(1);

const verdict = z
  .strictObject({
    id: text,
    verdict: z.enum(['complete', 'dead', 'unknown']),
    checked: isoDate,
    source: text,
    completeDay: isoDate.optional(),
    note: text.optional()
  })
  .superRefine((v, ctx) => {
    if (v.verdict === 'complete' && v.completeDay === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['completeDay'],
        message: "completeDay is required when verdict is 'complete'"
      });
    }
    if (v.verdict !== 'complete' && v.completeDay !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['completeDay'],
        message: "completeDay is only allowed when verdict is 'complete'"
      });
    }
    if (v.completeDay !== undefined && v.completeDay > v.checked) {
      ctx.addIssue({
        code: 'custom',
        path: ['completeDay'],
        message: 'completeDay is after checked'
      });
    }
  });

export const ConstructionVerifiedSchema: z.ZodType<ConstructionVerifiedFile> = z
  .strictObject({ schema: z.literal(1), projects: z.array(verdict) })
  .superRefine((f, ctx) => {
    f.projects.forEach((p, i) => {
      if (i === 0) return;
      const prev = f.projects[i - 1].id;
      if (p.id === prev) {
        ctx.addIssue({
          code: 'custom',
          path: ['projects', i, 'id'],
          message: `duplicate id ${p.id}`
        });
      } else if (p.id < prev) {
        ctx.addIssue({
          code: 'custom',
          path: ['projects', i, 'id'],
          message: `id ${p.id} is not sorted after ${prev}`
        });
      }
    });
  });

export class ConstructionVerifiedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstructionVerifiedFormatError';
  }
}

/** Validates a parsed `construction-verified.json`; throws listing every issue. */
export function parseConstructionVerified(json: unknown): ConstructionVerifiedFile {
  const r = ConstructionVerifiedSchema.safeParse(json);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
    return `$${path}: ${i.message}`;
  });
  throw new ConstructionVerifiedFormatError(`construction-verified.json: ${issues.join('; ')}`);
}
