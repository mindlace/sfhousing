import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';

export type Change =
  | {
      op: 'add';
      key: string;
      shape: string;
      fields: Record<string, unknown>;
      after?: string | null;
    }
  | { op: 'end'; key: string; to: Day }
  | { op: 'move'; key: string; after: string | null }
  | { op: 'set'; key: string; field: string; value: string | number | boolean | null }
  | { op: 'delete'; key: string };
export type CommitKind = 'edit' | 'restore' | 'system';
export interface Restores {
  position: number;
  as: 'undo' | 'redo' | 'jump';
}
/** What the author sends (R18's append). */
export interface CommitDraft {
  id: string;
  parent: number;
  kind: CommitKind;
  label: string;
  restores: Restores | null;
  datasetVersion: string;
  shapes: number;
  build: string;
  source: string;
  changes: Change[];
}
/** A stored commit: the sim object adds seq, actor, at and hash. */
export interface Commit extends CommitDraft {
  seq: number;
  actor: string;
  at: number;
  hash: string;
}
/** What folding a commit needs. */
export type FoldInput = Pick<CommitDraft, 'changes' | 'shapes' | 'datasetVersion'>;
export interface RulesetContent {
  name: string;
  policy: SimPolicy4;
}
export interface Ruleset extends RulesetContent {
  datasetVersion: string | null;
}

export class LogFormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'LogFormatError';
    this.path = path;
  }
}

export type LogErrorCode = 'invalid-change' | 'invalid-ruleset' | 'future-shapes';
export class LogError extends Error {
  readonly code: LogErrorCode;
  readonly index: number | null;
  constructor(code: LogErrorCode, message: string, index: number | null = null) {
    super(message);
    this.name = 'LogError';
    this.code = code;
    this.index = index;
  }
}

export const LABEL_MAX = 200;
export const BUILD_MAX = 64;
export const KEY_MAX = 256;
export const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
export const SOURCE_MAX = 64;
