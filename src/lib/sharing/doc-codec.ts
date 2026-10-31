import { emptyPlan, parsePlan, rebasePlan, serializePlan, type Plan, type Result } from '$lib/plan';
import { planPath } from './api';
import { withTitle } from './title';

export type DocKind = 'plan' | 'sim';

/**
 * What plan sharing needs to know about a document: where it lives (storage key, API, page
 * path) and how to read, write and describe it. Autosave, publish and remix are generic over it.
 */
export interface DocCodec<D> {
  readonly kind: DocKind;
  readonly api: '/api/plans' | '/api/policies';
  /** The shared page for a published id: '/p/<id>' | '/s/<id>'. */
  path(id: string): string;
  /** 'sfhousing:plan:v1' | 'sfhousing:sim:v1' */
  readonly storageKey: string;
  corruptKey(iso: string): string;
  /** Strict: what publish accepts. */
  parse(text: string): Result<D>;
  /**
   * Lenient: stored and autosaved documents. A schema newer than this build must still fail
   * with the 'future-schema' code (storage.ts detects a future document by it).
   */
  load(text: string): Result<D>;
  /** Canonical text. */
  serialize(d: D): string;
  /** What Publish sends (identity for plans). */
  publishable(d: D): D;
  schema(d: D): number;
  datasetVersion(d: D): string;
  rebase(d: D, version: string): D;
  empty(version: string): D;
  isEmpty(d: D): boolean;
  opCount(d: D): number;
  title(d: D): string | undefined;
  withTitle(d: D, t: string | undefined): D;
}

export const PLAN_CODEC: DocCodec<Plan> = {
  kind: 'plan',
  api: '/api/plans',
  path: planPath,
  storageKey: 'sfhousing:plan:v1',
  corruptKey: (iso) => `sfhousing:plan:corrupt:${iso}`,
  parse: parsePlan,
  load: parsePlan,
  serialize: serializePlan,
  publishable: (p) => p,
  schema: (p) => p.schema,
  datasetVersion: (p) => p.datasetVersion,
  rebase: rebasePlan,
  empty: emptyPlan,
  isEmpty: (p) => p.ops.length === 0,
  opCount: (p) => p.ops.length,
  title: (p) => p.title,
  withTitle
};
