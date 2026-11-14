// The single main↔worker protocol for M1 (I15). Owned by brush-tool's worker host.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BuildoutMode, TypologyId } from '$lib/generator';
import type { ChunkStatus, GeneratedUpdate, LotLimits, ParcelSummaryLike } from '$lib/map/types';
import type { BBox, Envelope, Plan, PlanOp } from '$lib/plan';
import type { Score } from '$lib/scoreboard';
import type { Lookups } from './levers/apply';
import type { LotOutlines } from './outlines';
import type { ProjectCard } from './scenario/types';

export type Rev = number; // strictly increasing per client, starting at 1
export type SimRequest =
  | { type: 'init'; rev: Rev; manifest: Manifest; mode: BuildoutMode }
  | { type: 'load'; rev: Rev; plan: Plan }
  | { type: 'preview'; rev: Rev; op: PlanOp }
  | { type: 'cancelPreview'; rev: Rev }
  | { type: 'commit'; rev: Rev; op: PlanOp }
  | { type: 'undo'; rev: Rev; opId: string }
  | { type: 'prefetch'; bbox: BBox }
  | { type: 'retryChunks' }
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId }
  // The eligible loaded lots the plan's ops cover, for `/`'s Paint tab rows (sim UX plan 5).
  | { type: 'opLots'; reqId: number; opIds: string[]; outlines: boolean };
export type DiffPhase = 'load' | 'preview' | 'cancel' | 'commit' | 'undo' | 'chunk';
export interface OpStats {
  opId: string;
  kind: 'paint' | 'erase';
  stories?: number /* paint only */;
  covered: number;
  ineligible: number;
  underwater: number;
  built: number;
  notBigger: number;
  removed: number;
  partial: boolean;
}
export type SimResponse =
  | { type: 'ready'; rev: Rev; datasetVersion: string; chunkCount: number }
  | {
      type: 'diff';
      rev: Rev;
      phase: DiffPhase;
      render: GeneratedUpdate;
      stats?: OpStats;
      complete: boolean;
      score: Score;
    }
  | { type: 'chunks'; status: Record<string, ChunkStatus>; pending: number; failed: string[] }
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null }
  | { type: 'opLots'; reqId: number; result: OpLotsResult | null }
  | {
      type: 'error';
      rev: Rev;
      code: 'manifest-invalid' | 'bad-request' | 'internal';
      message: string;
    };
export type DiffResponse = Extract<SimResponse, { type: 'diff' }>;
export type ChunksResponse = Extract<SimResponse, { type: 'chunks' }>;
export type ReadyResponse = Extract<SimResponse, { type: 'ready' }>;
export type ErrorResponse = Extract<SimResponse, { type: 'error' }>;
/**
 * The eligible loaded lots the ops cover (the union); `missing` counts the ops' cells not loaded
 * yet (the page asks again on a `chunks` message while it is above 0). `outline` is set when
 * asked for, for exactly those lots. The `result` is null with no worker state: before `init`,
 * after a crash or dispose, and outside editor mode.
 */
export interface OpLotsResult {
  lots: number;
  missing: number;
  outline: LotOutlines | null;
}
export interface ParcelSummary {
  parcelId: ParcelId;
  neighborhood: string;
  landUse: string;
  eligible: boolean;
  underwater?: true; // set only when the lot is wholly in the Bay
  existingUnits: number;
  envelope: Envelope | null; // committed-plus-preview display state
  generated: { typology: TypologyId; stories: number; units: number } | null;
  project?: ProjectCard; // T6; the editor never sets it
  /**
   * Map overlays plan 2 Task 7; `/sim` only. `allowed` repeats `envelope.maxStories` so that a
   * ParcelSummary stays assignable to ParcelSummaryLike (the editor hands it over unmapped).
   */
  limits?: LotLimits;
  /**
   * Timeline host only (S14): the stage tables of the frame in force on the requested day, for
   * that project.
   */
  lookups?: Lookups;
}

// I17 addendum: ParcelSummary must be assignable to map-view's ParcelSummaryLike.
type Assert<T extends true> = T;
export type ParcelSummaryIsLike = Assert<ParcelSummary extends ParcelSummaryLike ? true : false>;

// Step 0: the scenario protocol types (T5, T6, T8). Type-only cycle with ./scenario/types.
export type * from './scenario/types';
